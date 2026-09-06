import { Effect, Redacted } from "effect"
import { readPrivateFile } from "../storage/private-file"
import { BackendError, decodeRegistration, type Handoff } from "./contract"
import { loopbackEndpoint } from "./transport"

export function discover(enrollment: Redacted.Redacted<Handoff>) {
  return Effect.gen(function* () {
    const bytes = yield* readPrivateFile(Redacted.value(enrollment).registration).pipe(
      Effect.mapError(() => new BackendError("unavailable")),
    )
    return yield* Effect.try({
      try: () => {
        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        const registration = decodeRegistration(value)
        loopbackEndpoint(registration.url)
        return registration
      },
      catch: (error) => error instanceof BackendError ? error : new BackendError("invalid-contract"),
    })
  })
}
