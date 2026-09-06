import { Effect } from "effect"
import { serve } from "./server"

const controller = new AbortController()
const stop = () => controller.abort()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

const program = Effect.scoped(
  Effect.gen(function* () {
    const server = yield* serve(0)
    console.log(`Foundation listener: ${server.url}health`)
    console.log("Loopback only. Authentication, remote access, and backend attachment are not implemented.")
    yield* Effect.never
  }),
)

try {
  await Effect.runPromise(program, { signal: controller.signal })
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error)
    process.exitCode = 1
  }
} finally {
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
