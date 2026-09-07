import { Deferred, Effect, type Redacted } from "effect"
import { attach } from "./attachment"
import { BackendError, type Handoff, type Registration } from "./contract"
import { discover } from "./discovery"

export type BackendSnapshot =
  | { readonly state: "connecting" | "unavailable" | "closed" }
  | { readonly state: "stopped"; readonly reason: BackendError["reason"] }
  | { readonly state: "ready"; readonly backendID: string; readonly processID: string; readonly signal: AbortSignal }

export type SupervisorOptions = {
  readonly timeoutMs: number
  readonly heartbeatMs: number
  readonly retryMs: number
  readonly connected: () => boolean
  readonly invalidate: Effect.Effect<void>
  readonly onSync?: () => void
  readonly onStop?: (reason: BackendError["reason"]) => void
}

export function supervise(
  enrollment: Redacted.Redacted<Handoff>,
  options: SupervisorOptions,
  discovery: Effect.Effect<Registration, BackendError> = discover(enrollment),
) {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        for (const value of [options.timeoutMs, options.heartbeatMs, options.retryMs]) {
          if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new BackendError("invalid-contract")
        }
        if (options.heartbeatMs + options.timeoutMs >= 30_000) throw new BackendError("invalid-contract")
      },
      catch: () => new BackendError("invalid-contract"),
    })
    let snapshot: BackendSnapshot = { state: "connecting" }
    let active: AbortController | undefined
    let current: Effect.Success<ReturnType<typeof attach>> | undefined
    const invalidate = Effect.gen(function* () {
      active?.abort()
      active = undefined
      current = undefined
      yield* options.invalidate
    })
    const attempt = Effect.scoped(Effect.gen(function* () {
      const registration = yield* discovery
      const connection = yield* attach(enrollment, registration, { timeoutMs: options.timeoutMs })
      const heartbeat = Effect.suspend(() => connection.heartbeat(options.connected()))
      const subscribed = yield* Deferred.make<void>()
      const report = Effect.gen(function* () {
        if (options.onSync) yield* Deferred.await(subscribed).pipe(Effect.timeout(options.timeoutMs), Effect.mapError(() => new BackendError("unavailable")))
        yield* heartbeat
        active = new AbortController()
        current = connection
        snapshot = { state: "ready", backendID: connection.backendID, processID: connection.processID, signal: active.signal }
        options.onSync?.()
        while (true) { yield* Effect.sleep(options.heartbeatMs); yield* heartbeat }
      })
      const monitor = options.onSync ? Effect.all([report, connection.watch(() => {
        Effect.runSync(Deferred.succeed(subscribed, undefined))
        options.onSync?.()
      })], { concurrency: "unbounded" }) : report
      yield* monitor.pipe(Effect.mapError((error) => connection.failure() ?? error))
    }))
    const loop = Effect.gen(function* () {
      while (true) {
        const result = yield* attempt.pipe(Effect.result)
        const error = result._tag === "Failure" ? result.failure : new BackendError("closed")
        snapshot = error.reason === "unavailable" ? { state: "unavailable" } : { state: "stopped", reason: error.reason }
        yield* invalidate
        if (error.reason !== "unavailable") { options.onStop?.(error.reason); return }
        yield* Effect.sleep(options.retryMs)
        snapshot = { state: "connecting" }
      }
    })
    yield* Effect.addFinalizer(() => Effect.gen(function* () {
      snapshot = { state: "closed" }
      yield* invalidate
    }))
    yield* loop.pipe(Effect.ensuring(Effect.gen(function* () {
      if (snapshot.state !== "stopped") snapshot = { state: "closed" }
      yield* invalidate
    })), Effect.forkScoped)
    return {
      snapshot: (): BackendSnapshot => ({ ...snapshot }),
      request: (input: unknown, signal: AbortSignal, responseLimit: number) => Effect.suspend(() => {
        if (snapshot.state !== "ready" || !current || snapshot.signal.aborted) return Effect.fail(new BackendError("unavailable"))
        const connection = current
        return current.request(input, AbortSignal.any([signal, snapshot.signal]), responseLimit).pipe(
          Effect.tapError((error) => error instanceof BackendError && !signal.aborted && current === connection ? Effect.gen(function* () {
            snapshot = { state: "unavailable" }
            yield* invalidate
          }) : Effect.void),
        )
      }),
    }
  })
}
