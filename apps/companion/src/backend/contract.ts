import path from "node:path"
import { Redacted, Schema } from "effect"

export class BackendError extends Error {
  constructor(readonly reason: "invalid-contract" | "invalid-endpoint" | "unavailable" | "refused" | "identity-mismatch" | "closed") {
    super(`Backend attachment failed: ${reason}`)
    this.name = "BackendError"
  }
}

const Nonempty = Schema.String.check(Schema.isMinLength(1))
const HandoffSchema = Schema.Struct({
  version: Schema.Literal(1),
  backendID: Nonempty,
  registration: Nonempty,
  credentialID: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  token: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
})

const RegistrationSchema = Schema.Struct({
  id: Nonempty,
  version: Nonempty,
  url: Nonempty,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
})

const StatusSchema = Schema.Struct({
  supported: Schema.Boolean,
  enabled: Schema.Boolean,
  enrolled: Schema.Boolean,
  backendID: Schema.optional(Nonempty),
  processID: Nonempty,
  version: Schema.Literal(1),
  leaseSeconds: Schema.Literal(30),
  state: Schema.Literals(["disabled", "unavailable", "ready", "connected"]),
})

export type Handoff = typeof HandoffSchema.Type
export type Registration = typeof RegistrationSchema.Type
export type Status = typeof StatusSchema.Type

function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value)
  } catch {
    throw new BackendError("invalid-contract")
  }
}

export function decodeHandoff(value: unknown): Redacted.Redacted<Handoff> {
  const handoff = decode(HandoffSchema, value)
  if (!path.isAbsolute(handoff.registration)) throw new BackendError("invalid-contract")
  return Redacted.make(handoff)
}

export function decodeRegistration(value: unknown): Registration {
  return decode(RegistrationSchema, value)
}

export function decodeStatus(value: unknown): Status {
  return decode(StatusSchema, value)
}
