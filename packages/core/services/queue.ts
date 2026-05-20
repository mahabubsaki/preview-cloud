import { Context, Effect, Layer, Data } from "effect";
import { Queue } from "bullmq";
import { 
  BUILD_QUEUE, 
  DEPLOYMENT_QUEUE,
  DELETE_QUEUE, 
  NOTIFY_QUEUE,
  type BuildJob,
  type DeploymentJob, 
  type DeleteJob,
  type NotifyJob
} from "../index";
import { RedisService } from "./redis";

export class QueueError extends Data.TaggedError("QueueError")<{
  readonly message: string;
  readonly queue?: string;
}> {}

export interface QueueService {
  readonly addBuild: (name: string, data: BuildJob) => Effect.Effect<void>;
  readonly addDeployment: (name: string, data: DeploymentJob) => Effect.Effect<void>;
  readonly addDelete: (name: string, data: DeleteJob) => Effect.Effect<void>;
  readonly addNotify: (name: string, data: NotifyJob) => Effect.Effect<void>;
}

export const QueueService = Context.GenericTag<QueueService>("@github-app/core/QueueService");

export const QueueServiceLive = Layer.effect(
  QueueService,
  Effect.gen(function* () {
    const redis = yield* RedisService;
    const conn = redis.connection;

    const buildQueue = new Queue<BuildJob>(BUILD_QUEUE, { connection: conn });
    const deployQueue = new Queue<DeploymentJob>(DEPLOYMENT_QUEUE, { connection: conn });
    const deleteQueue = new Queue<DeleteJob>(DELETE_QUEUE, { connection: conn });
    const notifyQueue = new Queue<NotifyJob>(NOTIFY_QUEUE, { connection: conn });

    const service: QueueService = {
      addBuild: (name: string, data: BuildJob) => Effect.tryPromise({
        try: () => buildQueue.add(name, data, { jobId: name }),
        catch: (err) => new QueueError({ message: String(err), queue: "build" })
      }).pipe(Effect.asVoid, Effect.orDie),
      addDeployment: (name: string, data: DeploymentJob) => Effect.tryPromise({
        try: () => deployQueue.add(name, data, { jobId: name }),
        catch: (err) => new QueueError({ message: String(err), queue: "deployment" })
      }).pipe(Effect.asVoid, Effect.orDie),
      addDelete: (name: string, data: DeleteJob) => Effect.tryPromise({
        try: () => deleteQueue.add(name, data, { jobId: name }),
        catch: (err) => new QueueError({ message: String(err), queue: "delete" })
      }).pipe(Effect.asVoid, Effect.orDie),
      addNotify: (name: string, data: NotifyJob) => Effect.tryPromise({
        try: () => notifyQueue.add(name, data, { jobId: name }),
        catch: (err) => new QueueError({ message: String(err), queue: "notify" })
      }).pipe(Effect.asVoid, Effect.orDie),
    };

    return service;
  })
);
