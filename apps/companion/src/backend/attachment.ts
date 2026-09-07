import { Effect, Redacted } from "effect"
import { BackendError, decodeRegistration, decodeStatus, type Handoff } from "./contract"
import { loopbackEndpoint, statusRequest } from "./transport"
import { remoteRequest } from "./request"
import { watchEvents } from "./events"

export function attach(
  enrollment: Redacted.Redacted<Handoff>,
  discovery: unknown,
  options: { readonly timeoutMs: number },
) {
  return Effect.gen(function* () {
    const context = yield* Effect.try({
      try: () => {
        if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) {
          throw new BackendError("invalid-contract")
        }
        const registration = decodeRegistration(discovery)
        const handoff = Redacted.value(enrollment)
        return {
          registration,
          backendID: handoff.backendID,
          endpoint: loopbackEndpoint(registration.url),
          authorization: Redacted.make(`Bearer rc1.${handoff.credentialID}.${handoff.token}`),
        }
      },
      catch: (error) => error instanceof BackendError ? error : new BackendError("invalid-contract"),
    })
    let closed = false
    let failure: BackendError | undefined
    const lifetime = new AbortController()
    const controllers = new Set<AbortController>()

    const close = Effect.sync(() => {
      closed = true
      lifetime.abort()
      for (const controller of controllers) controller.abort()
      controllers.clear()
    })
    const fail = (error: BackendError) => Effect.sync(() => {
      failure ??= error
    }).pipe(Effect.andThen(close))

    const check = (connected?: boolean) => Effect.scoped(Effect.gen(function* () {
      if (closed) return yield* Effect.fail(new BackendError("closed"))
      const controller = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const controller = new AbortController()
          controllers.add(controller)
          return controller
        }),
        (controller) => Effect.sync(() => {
          controllers.delete(controller)
          controller.abort()
        }),
      )
      const response = yield* statusRequest(context.endpoint, context.authorization, options.timeoutMs, controller.signal, connected)
      const status = yield* Effect.try({
        try: () => decodeStatus(response),
        catch: () => new BackendError("invalid-contract"),
      })
      if (status.backendID !== context.backendID || status.processID !== context.registration.id) {
        return yield* Effect.fail(new BackendError("identity-mismatch"))
      }
      if (!status.supported || !status.enabled || !status.enrolled || status.state === "disabled") {
        return yield* Effect.fail(new BackendError("refused"))
      }
      if (closed) return yield* Effect.fail(new BackendError("closed"))
      return status
    })).pipe(Effect.tapError(fail))

    const status = yield* check()
    yield* Effect.addFinalizer(() => close)
    return {
      backendID: context.backendID,
      processID: context.registration.id,
      initialStatus: status,
      failure: () => failure,
      status: () => check(),
      heartbeat: (connected: boolean) => check(connected),
      request: (input: unknown, signal: AbortSignal, responseLimit: number) => Effect.suspend(() => {
        if (closed) return Effect.fail(new BackendError("closed"))
        return remoteRequest(context.endpoint, context.authorization, input, AbortSignal.any([lifetime.signal, signal]), options.timeoutMs, responseLimit).pipe(
          Effect.tapError((error) => error instanceof BackendError && !signal.aborted ? fail(error) : Effect.void),
        )
      }),
      watch: (onSync: () => void) => watchEvents(context.endpoint, context.authorization, lifetime.signal, options.timeoutMs, (status) => {
        if (status && (status.backendID !== context.backendID || status.processID !== context.registration.id)) throw new BackendError("identity-mismatch")
        if (status && (!status.supported || !status.enabled || !status.enrolled || status.state === "disabled")) throw new BackendError("refused")
        onSync()
      }).pipe(Effect.tapError(fail)),
      close,
    }
  })
}
