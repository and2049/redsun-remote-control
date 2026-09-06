import { Effect } from "effect"
import { loadBackend } from "../storage/backend"
import { attach } from "./attachment"
import { discover } from "./discovery"

export function probeBackend(directory: string) {
  return Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* loadBackend(directory)
    const registration = yield* discover(enrollment)
    yield* attach(enrollment, registration, { timeoutMs: 5000 })
  }))
}
