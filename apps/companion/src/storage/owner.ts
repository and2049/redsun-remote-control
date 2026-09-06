import path from "node:path"
import { Effect, Schema, Semaphore } from "effect"
import type { Passkey } from "../auth/passkeys"
import { createPrivateFile, privateFileExists, readPrivateFile, StorageError } from "./private-file"
import { acquireStore } from "./lease"

const Base64 = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/), Schema.isMaxLength(8192))
const Owner = Schema.Struct({
  version: Schema.Literal(1),
  origin: Schema.String,
  fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  userID: Base64,
  credential: Schema.Struct({
    id: Base64,
    publicKey: Base64,
    counter: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(0xffffffff)),
    transports: Schema.optional(Schema.Array(Schema.Literals(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]))),
  }),
})

export type OwnerEnrollment = {
  readonly origin: string
  readonly fingerprint: string
  readonly passkey: Passkey
}

function decode(value: unknown): OwnerEnrollment {
  const record = Schema.decodeUnknownSync(Owner, { onExcessProperty: "error" })(value)
  const origin = new URL(record.origin)
  if (origin.protocol !== "https:" || origin.origin !== record.origin || origin.username || origin.password) throw new StorageError()
  for (const encoded of [record.userID, record.credential.id, record.credential.publicKey]) {
    if (Buffer.from(encoded, "base64url").toString("base64url") !== encoded) throw new StorageError()
  }
  if (Buffer.from(record.userID, "base64url").length > 64) throw new StorageError()
  return {
    origin: record.origin,
    fingerprint: record.fingerprint,
    passkey: {
      userID: record.userID,
      credential: {
        id: record.credential.id,
        publicKey: new Uint8Array(Buffer.from(record.credential.publicKey, "base64url")),
        counter: record.credential.counter,
        ...(record.credential.transports === undefined ? {} : { transports: [...record.credential.transports] }),
      },
    },
  }
}

function encode(enrollment: OwnerEnrollment) {
  return Effect.try({
    try: () => {
      const record = {
        version: 1,
        origin: enrollment.origin,
        fingerprint: enrollment.fingerprint,
        userID: enrollment.passkey.userID,
        credential: {
          ...enrollment.passkey.credential,
          publicKey: Buffer.from(enrollment.passkey.credential.publicKey).toString("base64url"),
        },
      }
      decode(record)
      return Buffer.from(JSON.stringify(record))
    },
    catch: () => new StorageError(),
  })
}

export function createOwner(directory: string, enrollment: OwnerEnrollment) {
  return encode(enrollment).pipe(Effect.flatMap((bytes) => createPrivateFile(path.join(directory, "owner.json"), bytes)))
}

export function makeOwnerStore(directory: string, origin: string) {
  return Effect.gen(function* () {
    const lease = yield* acquireStore(directory)
    const lock = yield* Semaphore.make(1)
    const file = path.join(directory, "owner.json")
    const mutate = (action: "create" | "replace" | "remove", content?: Uint8Array) => Effect.tryPromise({
      try: () => lease.mutate(action, content), catch: () => new StorageError(),
    })
    const check = Effect.try({
      try: () => { if (lease.signal.aborted) throw new StorageError() },
      catch: () => new StorageError(),
    })
    const exclusive = <A>(operation: Effect.Effect<A, StorageError>) => Effect.gen(function* () {
      yield* check
      const result = yield* operation
      yield* check
      return result
    }).pipe(lock.withPermits(1), Effect.uninterruptible)

    return {
      signal: lease.signal,
      read: exclusive(Effect.gen(function* () {
        if (!(yield* privateFileExists(file))) return undefined
        return yield* loadOwner(directory, origin)
      })),
      enroll: (record: OwnerEnrollment) => exclusive(Effect.gen(function* () {
        if (record.origin !== origin) return yield* Effect.fail(new StorageError())
        yield* mutate("create", yield* encode(record))
      })),
      update: (expected: OwnerEnrollment, passkey: Passkey) => exclusive(Effect.gen(function* () {
        const current = yield* loadOwner(directory, origin)
        const matches = expected.origin === origin && current.fingerprint === expected.fingerprint &&
          current.passkey.userID === passkey.userID && current.passkey.userID === expected.passkey.userID &&
          current.passkey.credential.id === passkey.credential.id && current.passkey.credential.id === expected.passkey.credential.id &&
          current.passkey.credential.counter === expected.passkey.credential.counter &&
          Buffer.from(current.passkey.credential.publicKey).equals(passkey.credential.publicKey) &&
          (passkey.credential.counter > current.passkey.credential.counter || (passkey.credential.counter === 0 && current.passkey.credential.counter === 0))
        if (!matches) return yield* Effect.fail(new StorageError())
        const next = {
          ...current,
          passkey: { ...current.passkey, credential: { ...current.passkey.credential, counter: passkey.credential.counter } },
        }
        const bytes = yield* encode(next)
        yield* mutate("replace", bytes)
        return next
      })),
      reset: exclusive(Effect.gen(function* () {
        if (yield* privateFileExists(file)) yield* mutate("remove")
      })),
    }
  })
}

export function recoverOwner(directory: string) {
  return Effect.scoped(Effect.gen(function* () {
    const lease = yield* acquireStore(directory)
    const file = path.join(directory, "owner.json")
    if (yield* privateFileExists(file)) yield* Effect.tryPromise({ try: () => lease.mutate("remove"), catch: () => new StorageError() })
  }))
}

export function loadOwner(directory: string, origin: string) {
  return readPrivateFile(path.join(directory, "owner.json")).pipe(Effect.flatMap((bytes) => Effect.try({
    try: () => {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      const record = decode(value)
      if (record.origin !== origin) throw new StorageError()
      return record
    },
    catch: () => new StorageError(),
  })))
}
