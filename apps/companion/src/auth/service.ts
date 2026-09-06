import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server"
import { Effect, Semaphore } from "effect"
import { makeOwnerStore } from "../storage/owner"
import { makeEnrollment } from "./enrollment"
import { makePasskeys } from "./passkeys"
import { makeSessions } from "./sessions"

export class AuthenticationError extends Error {
  constructor() { super("Authentication failed"); this.name = "AuthenticationError" }
}

export function makeAuthentication(directory: string, origin: string) {
  return Effect.gen(function* () {
    const store = yield* makeOwnerStore(directory, origin)
    yield* store.read
    const sessions = yield* makeSessions(64)
    const passkeys = yield* Effect.try({
      try: () => makePasskeys({ origin, challengeCapacity: 128, challengeLifetimeMs: 300_000 }),
      catch: () => new AuthenticationError(),
    })
    let persistenceFailed = false
    const enrollment = yield* makeEnrollment({ origin, capacity: 32 }, (record) => store.enroll(record).pipe(
      Effect.tapError(() => Effect.sync(() => { persistenceFailed = true })),
    ))
    const lock = yield* Semaphore.make(1)
    let generation = 0
    let blocked = false
    let disabled = false
    const invalidate = Effect.gen(function* () {
      generation += 1
      sessions.clear()
      yield* passkeys.invalidate
    })
    const check = Effect.try({
      try: () => { if (blocked || disabled || store.signal.aborted) throw new AuthenticationError() },
      catch: () => new AuthenticationError(),
    })
    const safe = <A, E>(operation: Effect.Effect<A, E>) => operation.pipe(Effect.mapError(() => new AuthenticationError()))
    const serialized = <A, E>(operation: Effect.Effect<A, E>) => safe(operation.pipe(lock.withPermits(1), Effect.uninterruptible))
    const failClosed = Effect.gen(function* () {
      blocked = true
      yield* invalidate
      yield* enrollment.cancel
    })
    const read = store.read.pipe(Effect.tapError(() => failClosed))
    const lost = () => { blocked = true; Effect.runSync(invalidate) }
    store.signal.addEventListener("abort", lost, { once: true })
    yield* Effect.addFinalizer(() => Effect.gen(function* () {
      blocked = true
      yield* invalidate
      store.signal.removeEventListener("abort", lost)
    }))

    return {
      local: {
        open: serialized(Effect.gen(function* () {
          yield* check
          if (yield* read) return yield* Effect.fail(new AuthenticationError())
          return yield* enrollment.open
        })),
        pending: safe(enrollment.pending),
        cancel: safe(enrollment.cancel),
        approve: (id: string, fingerprint: string) => serialized(Effect.gen(function* () {
          yield* check
          yield* enrollment.approve(id, fingerprint).pipe(Effect.tapError(() => persistenceFailed ? failClosed : Effect.void))
        })),
        recover: safe(Effect.gen(function* () {
          blocked = true
          yield* invalidate
          yield* serialized(Effect.gen(function* () {
            yield* enrollment.cancel
            yield* store.reset
            yield* enrollment.resetLocal
            persistenceFailed = false
            blocked = false
          }))
        })),
      },
      registrationOptions: (binding: string) => safe(check.pipe(Effect.andThen(enrollment.options(binding)))),
      registration: (binding: string, id: string, response: RegistrationResponseJSON) => safe(
        check.pipe(Effect.andThen(enrollment.verify(binding, id, response))),
      ),
      loginOptions: (binding: string) => serialized(Effect.gen(function* () {
        yield* check
        const owner = yield* read
        if (!owner) return yield* Effect.fail(new AuthenticationError())
        return yield* passkeys.authenticationOptions(binding, owner.passkey)
      })),
      login: (binding: string, id: string, response: AuthenticationResponseJSON) => serialized(Effect.gen(function* () {
        yield* check
        const version = generation
        const owner = yield* read
        if (!owner) return yield* Effect.fail(new AuthenticationError())
        const passkey = yield* passkeys.verifyAuthentication(binding, id, response, owner.passkey)
        if (version !== generation) return yield* Effect.fail(new AuthenticationError())
        yield* store.update(owner, passkey).pipe(Effect.tapError(() => failClosed))
        yield* check
        if (version !== generation) return yield* Effect.fail(new AuthenticationError())
        return yield* Effect.try({ try: () => sessions.issue(), catch: () => new AuthenticationError() })
      })),
      session: (token: string, activity = true) => check.pipe(Effect.andThen(Effect.try({
        try: () => {
          const signal = sessions.authenticate(token, activity)
          if (!signal) throw new AuthenticationError()
          return signal
        },
        catch: () => new AuthenticationError(),
      }))),
      logout: (token: string) => Effect.sync(() => sessions.revoke(token)),
      revoke: safe(invalidate.pipe(Effect.andThen(enrollment.cancel))),
      disable: safe(Effect.gen(function* () {
        disabled = true
        yield* failClosed
      })),
    }
  })
}

export type Authentication = Effect.Success<ReturnType<typeof makeAuthentication>>
