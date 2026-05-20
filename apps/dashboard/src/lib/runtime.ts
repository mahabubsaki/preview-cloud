import { Effect, ManagedRuntime, Layer } from "effect";
import { DashboardLayer } from "./services";

// A single, shared runtime for all Server Actions.
// The Layer is built once and reused across invocations.
const runtime = ManagedRuntime.make(DashboardLayer);

/**
 * Run an Effect inside a Next.js Server Action.
 * The runtime provides Database, Redis, and Queue services.
 */
export const runAction = <A, E>(
  effect: Effect.Effect<A, E, Layer.Layer.Success<typeof DashboardLayer>>
) => runtime.runPromise(effect);
