import { Effect, Runtime, Schema as S } from "effect";
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  type Interaction,
  ChannelType,
} from "discord.js";
import IORedis from "ioredis";
import { Worker, Queue } from "bullmq";
import {
  DEPLOYMENT_QUEUE,
  BUILD_QUEUE,
  DeploymentJobSchema,
  type DeploymentJob,
  type BuildJob,
  deployments,
} from "@github-app/core";
import { DatabaseService, RedisService } from "../services";
import { DiscordError } from "../errors";
import { eq } from "drizzle-orm";

// --- Discord Bot Worker ---

export const createDiscordWorker = Effect.gen(function* () {
  const { db } = yield* DatabaseService;
  const redis = yield* RedisService;
  const runtime = yield* Effect.runtime<DatabaseService | RedisService>();
  const runFork = Runtime.runFork(runtime);
  const runPromise = Runtime.runPromise(runtime);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  const buildQueue = new Queue(BUILD_QUEUE, { connection: redis.connection });
  const deploymentQueue = new Queue(DEPLOYMENT_QUEUE, {
    connection: redis.connection,
  });

  // --- Handlers ---

  const processDeploymentJob = (data: DeploymentJob, jobId: string) =>
    Effect.gen(function* () {
      yield* Effect.log(`📩 Discord Worker received deployment request for ${data.repo}@${data.branch} [${data.commitSha.substring(0, 7)}]`);
      const channelId = process.env.DISCORD_CHANNEL_ID;
      if (!channelId) return;

      const channel = yield* Effect.tryPromise({
        try: () => client.channels.fetch(channelId),
        catch: (err) => new DiscordError({ message: `Failed to fetch channel: ${err}`, operation: "channel_fetch" }),
      });

      if (!channel || channel.type !== ChannelType.GuildText) return;

      const embed = new EmbedBuilder()
        .setTitle("🚀 New Deployment Request")
        .setColor(0x00ae86)
        .addFields(
          { name: "Repo", value: data.repo, inline: true },
          { name: "Branch", value: data.branch, inline: true },
          {
            name: "Commit",
            value: data.commitSha.substring(0, 7),
            inline: true,
          },
          { name: "Author", value: data.author },
          { name: "Message", value: data.message }
        );

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`deploy_yes_${jobId}`)
          .setLabel("✅ Deploy")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`deploy_no_${jobId}`)
          .setLabel("❌ Cancel")
          .setStyle(ButtonStyle.Danger)
      );

      yield* Effect.tryPromise({
        try: () => channel.send({ embeds: [embed], components: [row] }),
        catch: (err) => new DiscordError({ message: `Failed to send message: ${err}`, operation: "message_send" }),
      });
    });

  const handleInteraction = (interaction: Interaction) =>
    Effect.gen(function* () {
      if (!interaction.isButton()) return;

      const [prefix, result, jobId] = interaction.customId.split("_");
      if (prefix !== "deploy" || !jobId) return;

      // Defer the interaction immediately to avoid token expiration
      yield* Effect.tryPromise({
        try: () => interaction.deferUpdate(),
        catch: (err) => new DiscordError({ message: `Failed to defer interaction: ${err}`, operation: "interaction" }),
      });

      const originalJob = yield* Effect.tryPromise({
        try: () => deploymentQueue.getJob(jobId),
        catch: (err) => new DiscordError({ message: `Failed to get job: ${err}`, operation: "interaction" }),
      });

      if (!originalJob) {
        yield* Effect.tryPromise({
          try: () => interaction.editReply({
            content: "Error: Could not find original job data.",
          }),
          catch: (cause) => new DiscordError({ message: "Failed to send error reply", operation: "interaction", cause }),
        }).pipe(
          Effect.catchAll((err) => Effect.logError(`Failed to send Discord error reply: ${err.message}`))
        );
        return;
      }

      const data = DeploymentJobSchema.parse(originalJob.data);

      if (result === "yes") {
        yield* Effect.tryPromise({
          try: () => interaction.editReply({
            content: "⌛ **Approved.** Forwarding to Orchestrator...",
            components: [],
          }),
          catch: (err) => new DiscordError({ message: `Failed to update interaction: ${err}`, operation: "interaction" }),
        });

        const buildData: BuildJob = {
          ...data,
          approvedBy: interaction.user.id,
          discordMessageId: interaction.message.id,
          discordChannelId: interaction.channelId,
        };

        // Persist IDs to DB so they survive the GitHub Actions callback flow
        yield* Effect.tryPromise({
          try: () =>
            db
              .update(deployments)
              .set({
                discordMessageId: buildData.discordMessageId,
                discordChannelId: buildData.discordChannelId,
              })
              .where(eq(deployments.id, data.deploymentId)),
          catch: (err) =>
            new DiscordError({
              message: `Failed to save Discord IDs to DB: ${err}`,
              operation: "interaction",
            }),
        });

        yield* Effect.tryPromise({
          try: () => buildQueue.add(`build-${data.deploymentId}`, buildData),
          catch: (err) => new DiscordError({ message: `Failed to add to build queue: ${err}`, operation: "interaction" }),
        });

        yield* Effect.log(`User ${interaction.user.tag} approved build for ${data.repo}`);
      } else {
        yield* Effect.tryPromise({
          try: () => interaction.editReply({
            content: "❌ **Cancelled.** This deployment will not proceed.",
            components: [],
          }),
          catch: (err) => new DiscordError({ message: `Failed to update interaction: ${err}`, operation: "interaction" }),
        });
      }
    });

  const handleStatusUpdate = (channel: string, message: string) =>
    Effect.gen(function* () {
      if (channel !== "deployment-updates") return;
      yield* Effect.log(`📡 [DISCORD] Received update: ${message}`);

      const DeploymentUpdate = S.Struct({
        deploymentId: S.String,
        repo: S.String,
        branch: S.String,
        commitSha: S.String,
        status: S.String,
        url: S.optional(S.String),
        discordMessageId: S.optional(S.String),
        discordChannelId: S.optional(S.String),
        buildTime: S.optional(S.Number),
        framework: S.optional(S.String),
      });

      const data = yield* S.decodeUnknown(S.parseJson(DeploymentUpdate))(message).pipe(
        Effect.mapError((err) => new DiscordError({ message: `Failed to parse status message: ${err}`, operation: "interaction" }))
      );

      let { discordMessageId, discordChannelId } = data;

      // Fallback: If IDs are missing in the broadcast, fetch from DB
      if (!discordMessageId || !discordChannelId) {
        const [record] = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                mid: deployments.discordMessageId,
                cid: deployments.discordChannelId,
              })
              .from(deployments)
              .where(eq(deployments.id, data.deploymentId))
              .limit(1),
          catch: () => [],
        });

        if (record?.mid && record?.cid) {
          discordMessageId = record.mid;
          discordChannelId = record.cid;
        }
      }

      if (!discordMessageId || !discordChannelId) return;

      const discordChannel = yield* Effect.tryPromise({
        try: () => client.channels.fetch(discordChannelId),
        catch: (err) => new DiscordError({ message: `Failed to fetch channel: ${err}`, operation: "channel_fetch" }),
      });

      if (!discordChannel || discordChannel.type !== ChannelType.GuildText) return;

      const originalMessage = yield* Effect.tryPromise({
        try: () => discordChannel.messages.fetch(discordMessageId),
        catch: (err) => new DiscordError({ message: `Failed to fetch message: ${err}`, operation: "message_send" }),
      });

      if (!originalMessage) return;

      if (data.status === "building") {
        yield* Effect.tryPromise({
          try: () => originalMessage.edit({ content: `🔨 **Building...** Offloading to build farm.` }),
          catch: (cause) => new DiscordError({ message: "Failed to edit building message", operation: "message_send", cause }),
        }).pipe(
          Effect.catchAll((err) => Effect.logError(`Failed to update Discord status: ${err.message}`))
        );
        return;
      }

      if (data.status === "running") {
        yield* Effect.tryPromise({
          try: () => originalMessage.edit({ content: `✅ **Deployed.** Orchestration complete.` }),
          catch: (cause) => new DiscordError({ message: "Failed to edit status message", operation: "message_send", cause }),
        }).pipe(
          Effect.catchAll((err) => Effect.logError(`Failed to update Discord status: ${err.message}`))
        );

        // Only send the embed if we actually have a URL.
        // This prevents double-sending if multiple 'running' updates arrive.
        if (data.url) {
          const embed = new EmbedBuilder()
            .setTitle("✨ Deployment Successful")
            .setColor(0x00ff00)
            .setURL(data.url)
            .addFields(
              { name: "Repo", value: data.repo || "Unknown", inline: true },
              { name: "Branch", value: data.branch || "Unknown", inline: true },
              { name: "Framework", value: data.framework || "Unknown", inline: true },
              { name: "Build Time", value: `${data.buildTime || 0}s`, inline: true },
              { name: "Commit", value: data.commitSha.substring(0, 7), inline: true },
              { name: "Preview URL", value: data.url }
            )
            .setTimestamp();

          yield* Effect.tryPromise({
            try: () => discordChannel.send({ embeds: [embed] }),
            catch: (cause) => new DiscordError({ message: "Failed to send success embed", operation: "message_send", cause }),
          }).pipe(
            Effect.catchAll((err) => Effect.logError(`Failed to send Discord success embed: ${err.message}`))
          );
        }
      } else if (data.status === "failed") {
        yield* Effect.tryPromise({
          try: () => originalMessage.edit({ content: `❌ **Failed.** Orchestration encountered an error.` }),
          catch: (cause) => new DiscordError({ message: "Failed to edit failure message", operation: "message_send", cause }),
        }).pipe(
          Effect.catchAll((err) => Effect.logError(`Failed to update Discord failure status: ${err.message}`))
        );

        const embed = new EmbedBuilder()
          .setTitle("💥 Deployment Failed")
          .setColor(0xff0000)
          .setDescription(`The build for commit \`${data.commitSha.substring(0, 7)}\` failed. Check dashboard logs for details.`)
          .setTimestamp();

        yield* Effect.tryPromise({
          try: () => discordChannel.send({ embeds: [embed] }),
          catch: (cause) => new DiscordError({ message: "Failed to send success embed", operation: "message_send", cause }),
        }).pipe(
          Effect.catchAll((err) => Effect.logError(`Failed to send Discord success embed: ${err.message}`))
        );
      }
    });

  // --- Worker Setup ---

  const worker = new Worker(
    DEPLOYMENT_QUEUE,
    (job) => {
      const data = DeploymentJobSchema.parse(job.data);
      if (!job.id) throw new Error("Job ID is missing");
      return runPromise(processDeploymentJob(data, job.id));
    },
    { connection: redis.connection }
  );

  // --- Interaction Handler ---
  client.on("interactionCreate", (interaction) => {
    runFork(handleInteraction(interaction).pipe(
      Effect.catchAll((err) => Effect.log(`❌ Discord interaction error: ${err}`))
    ));
  });

  // --- Redis Subscriber ---
  const sub = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");

  yield* Effect.tryPromise({
    try: () => sub.subscribe("deployment-updates"),
    catch: (err) => new DiscordError({ message: `Redis subscribe failed: ${err}`, operation: "login" }),
  });

  sub.on("message", (channel, message) => {
    runFork(handleStatusUpdate(channel, message).pipe(
      Effect.catchAll((err) => Effect.log(`❌ Discord status update error: ${err}`))
    ));
  });

  client.on(Events.ClientReady, () =>
    console.log(`🤖 Discord Bot logged in as ${client.user?.tag}`)
  );

  // Login
  const token = process.env.DISCORD_BOT_TOKEN;
  if (token) {
    yield* Effect.tryPromise({
      try: () => client.login(token),
      catch: (err) => new DiscordError({ message: `Discord login failed: ${err}`, operation: "login" }),
    });
    yield* Effect.log("✅ Discord bot worker started (Idiomatic Effect-TS)");
  } else {
    yield* Effect.log("⚠️ DISCORD_BOT_TOKEN not set, skipping Discord bot");
  }

  // Cleanup on shutdown
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => worker.close()).pipe(
      Effect.zipRight(
        Effect.sync(() => {
          sub.disconnect();
          client.destroy();
        })
      ),
      Effect.tap(() => Effect.log("🛑 Discord bot worker shut down gracefully"))
    )
  );

  return { worker, client };
});
