import path from "node:path"

export const handoff = {
  version: 1,
  backendID: "backend-fixture",
  registration: path.resolve("fixture.remote"),
  credentialID: "a".repeat(32),
  token: "b".repeat(43),
} as const

export const status = {
  supported: true,
  enabled: true,
  enrolled: true,
  backendID: handoff.backendID,
  processID: "process-fixture",
  version: 1,
  leaseSeconds: 30,
  state: "unavailable",
} as const
