import { Effect, Redacted } from "effect"
import { BackendError, decodeRegistration, decodeStatus, type Handoff } from "./contract"
import { loopbackEndpoint, statusRequest } from "./transport"

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
    const controllers = new Set<AbortController>()

    const close = Effect.sync(() => {
      closed = true
      for (const controller of controllers) controller.abort()
      controllers.clear()
    })

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
    })).pipe(Effect.tapError(() => close))

    const status = yield* check()
    yield* Effect.addFinalizer(() => close)
    return {
      backendID: context.backendID,
      processID: context.registration.id,
      initialStatus: status,
      status: () => check(),
      heartbeat: (connected: boolean) => check(connected),
      close,
    }
  })
}
