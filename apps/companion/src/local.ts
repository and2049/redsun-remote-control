import { Effect } from "effect"
import type { Authentication } from "./auth/service"

export function localCommand(auth: Authentication, line: string) {
  return Effect.gen(function* () {
    const args = line.trim().split(/\s+/)
    if (args.length === 1 && args[0] === "enroll") {
      yield* auth.local.open
      return "Enrollment open for five minutes. Verify the browser fingerprint before approving."
    }
    if (args.length === 1 && args[0] === "pending") return JSON.stringify(yield* auth.local.pending)
    if (args.length === 1 && args[0] === "cancel") {
      yield* auth.local.cancel
      return "Enrollment window cancelled. Existing enrollment is unchanged."
    }
    if (args.length === 3 && args[0] === "approve" && args[1] && args[2]) {
      yield* auth.local.approve(args[1], args[2])
      return "Owner enrollment persisted. The browser must log in separately."
    }
    if (args.length === 2 && args[0] === "recover" && args[1] === "confirm") {
      yield* auth.local.recover
      return "Browser enrollment removed and sessions revoked. Backend enrollment is unchanged."
    }
    return yield* Effect.fail(new Error("Local command rejected"))
  })
}
