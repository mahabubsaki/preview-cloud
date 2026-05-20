import { Context, Effect, Layer } from "effect";
import { Webhooks } from "@octokit/webhooks";
import { WebhookError } from "../errors";

// --- Webhook Verification Service ---

export interface WebhookService {
  readonly verify: (payload: string, signature: string) => Effect.Effect<boolean>;
}

export const WebhookService = Context.GenericTag<WebhookService>("@github-app/server/WebhookService");

export const WebhookServiceLive = Layer.effect(
  WebhookService,
  Effect.gen(function* () {
    const secret = process.env.GITHUB_WEBHOOK_SECRET || "development_secret";
    const webhooks = new Webhooks({ secret });

    yield* Effect.log("✅ Webhook verification service initialized");

    return {
      verify: (payload: string, signature: string) =>
        Effect.tryPromise({
          try: () => webhooks.verify(payload, signature),
          catch: (_err) => new WebhookError({ message: "Webhook verification failed", reason: "invalid_signature" }),
        }).pipe(Effect.orDie),
    };
  })
);
