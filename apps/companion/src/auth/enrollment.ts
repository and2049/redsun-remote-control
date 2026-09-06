import { createHash, randomBytes } from "node:crypto"
import type { RegistrationResponseJSON } from "@simplewebauthn/server"
import { Effect, Semaphore } from "effect"
import type { OwnerEnrollment } from "../storage/owner"
import { makePasskeys, type Passkey } from "./passkeys"

export class EnrollmentError extends Error {
  constructor() {
    super("Local enrollment operation failed")
    this.name = "EnrollmentError"
  }
}

type Request = {
  readonly binding: string
  ceremonyID?: string
  proof?: { readonly fingerprint: string; readonly passkey: Passkey }
}

type Window = {
  readonly expiresAt: number
  readonly userID: Uint8Array
  readonly requests: Map<string, Request>
}

export function makeEnrollment<E>(
  config: { readonly origin: string; readonly capacity: number },
  persist: (enrollment: OwnerEnrollment) => Effect.Effect<void, E>,
  now: () => number = () => performance.now(),
) {
  const { origin, capacity } = config
  return Effect.gen(function* () {
    const passkeys = yield* Effect.try({
      try: () => makePasskeys({ origin, challengeCapacity: capacity, challengeLifetimeMs: 300_000 }, now),
      catch: () => new EnrollmentError(),
    })
    const lock = yield* Semaphore.make(1)
    let window: Window | undefined
    let closed = false
    let enrolled = false

    const invalidate = Effect.gen(function* () {
      window = undefined
      yield* passkeys.invalidate
    })

    function current(): Window {
      if (closed || !window || window.expiresAt <= now()) throw new EnrollmentError()
      return window
    }

    const local = <A, Error>(effect: Effect.Effect<A, Error>) => effect.pipe(
      lock.withPermits(1), Effect.uninterruptible, Effect.mapError(() => new EnrollmentError()),
    )

    yield* Effect.addFinalizer(() => Effect.gen(function* () {
      closed = true
      yield* invalidate
    }).pipe(lock.withPermits(1), Effect.uninterruptible))

    return {
      open: local(Effect.gen(function* () {
        if (closed || enrolled) return yield* Effect.fail(new EnrollmentError())
        yield* invalidate
        window = { expiresAt: now() + 300_000, userID: randomBytes(32), requests: new Map() }
        return { lifetimeMs: 300_000 }
      })),

      cancel: local(invalidate),

      resetLocal: local(Effect.gen(function* () {
        yield* invalidate
        enrolled = false
      })),

      options(binding: string) {
        return Effect.gen(function* () {
          const state = yield* Effect.try(() => {
            const state = current()
            if (!binding || state.requests.size >= capacity) throw new EnrollmentError()
            return state
          })
          const id = randomBytes(32).toString("base64url")
          const request: Request = { binding }
          state.requests.set(id, request)
          const ceremony = yield* passkeys.registrationOptions(binding, state.userID).pipe(
            Effect.onExit((exit) => Effect.sync(() => {
              if (exit._tag === "Failure") state.requests.delete(id)
            })),
          )
          yield* Effect.try(() => { if (current() !== state) throw new EnrollmentError() })
          request.ceremonyID = ceremony.ceremonyID
          return { requestID: id, options: ceremony.options }
        }).pipe(Effect.mapError(() => new EnrollmentError()))
      },

      verify(binding: string, id: string, response: RegistrationResponseJSON) {
        return Effect.gen(function* () {
          const { state, request, ceremonyID } = yield* Effect.try(() => {
            const state = current()
            const request = state.requests.get(id)
            if (!request || request.binding !== binding || !request.ceremonyID) throw new EnrollmentError()
            const ceremonyID = request.ceremonyID
            delete request.ceremonyID
            return { state, request, ceremonyID }
          })
          const passkey = yield* passkeys.verifyRegistration(binding, ceremonyID, response).pipe(
            Effect.onExit((exit) => Effect.sync(() => {
              if (exit._tag === "Failure") state.requests.delete(id)
            })),
          )
          yield* Effect.try(() => { if (current() !== state) throw new EnrollmentError() })
          const fingerprint = createHash("sha256").update(JSON.stringify([
            origin, id, binding, passkey.userID, passkey.credential.id,
            Buffer.from(passkey.credential.publicKey).toString("base64url"),
          ])).digest("hex").slice(0, 32)
          request.proof = { fingerprint, passkey }
          return { requestID: id, fingerprint }
        }).pipe(Effect.mapError(() => new EnrollmentError()))
      },

      pending: local(Effect.try(() => [...current().requests.entries()].flatMap(([requestID, request]) =>
        request.proof ? [{ requestID, fingerprint: request.proof.fingerprint }] : [],
      ))),

      approve(id: string, fingerprint: string) {
        return local(Effect.gen(function* () {
          const proof = yield* Effect.try(() => {
            const proof = current().requests.get(id)?.proof
            if (!proof || proof.fingerprint !== fingerprint) throw new EnrollmentError()
            return proof
          })
          yield* invalidate
          yield* persist({ origin, fingerprint: proof.fingerprint, passkey: proof.passkey })
          enrolled = true
        }))
      },
    }
  })
}
