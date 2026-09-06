import path from "node:path"
import { Effect, Schema } from "effect"
import type { Passkey } from "../auth/passkeys"
import { createPrivateFile, readPrivateFile, StorageError } from "./private-file"

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

export function createOwner(directory: string, enrollment: OwnerEnrollment) {
  return Effect.gen(function* () {
    const bytes = yield* Effect.try({
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
    yield* createPrivateFile(path.join(directory, "owner.json"), bytes)
  })
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
