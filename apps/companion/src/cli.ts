import { Effect } from "effect"
import { serve } from "./server"
import { parseCommand } from "./command"
import { dataDirectory, importBackend } from "./storage/backend"

const controller = new AbortController()
const stop = () => controller.abort()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

const program = Effect.scoped(
  Effect.gen(function* () {
    const command = yield* Effect.try(() => parseCommand(process.argv.slice(2)))
    if (command.kind === "help") {
      console.log("Usage: companion [--help | import-backend <absolute-private-handoff-file>]")
      console.log("No arguments: development health listener. Import preserves the source and never enables or starts redsun.")
      return
    }
    if (command.kind === "import-backend") {
      const directory = yield* Effect.try(() => dataDirectory())
      yield* importBackend(command.source, directory)
      console.log("Backend handoff imported. Source preserved. No backend connection or policy change was made.")
      return
    }
    const server = yield* serve(0)
    console.log(`Foundation listener: ${server.url}health`)
    console.log("Loopback only. Login, remote access, and operational backend attachment are not wired.")
    yield* Effect.never
  }),
)

try {
  await Effect.runPromise(program, { signal: controller.signal })
} catch {
  if (!controller.signal.aborted) {
    console.error("Companion command failed. Check arguments, private file permissions, and whether an import already exists. Use --help for usage.")
    process.exitCode = 1
  }
} finally {
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
