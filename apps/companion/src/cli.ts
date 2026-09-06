import { createInterface } from "node:readline"
import { Effect, Stream } from "effect"
import { serve } from "./server"
import { parseCommand } from "./command"
import { dataDirectory, importBackend } from "./storage/backend"
import { recoverOwner } from "./storage/owner"
import { makeAuthentication } from "./auth/service"
import { makeAuthenticationHttp } from "./auth/http"
import { handleRequest } from "./http"
import { localCommand } from "./local"
import { probeBackend } from "./backend/probe"
import { operational } from "./operational"

const controller = new AbortController()
const stop = () => controller.abort()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)

const program = Effect.scoped(
  Effect.gen(function* () {
    const command = yield* Effect.try(() => parseCommand(process.argv.slice(2)))
    if (command.kind === "help") {
      console.log("Usage: companion [--help | import-backend <absolute-private-handoff-file>]")
      console.log("Authenticated mode: companion serve --origin <https-origin> --port <loopback-port>")
      console.log("Phone diagnostic and scoped backend routes: append --backend (requires an imported handoff)")
      console.log("Offline browser recovery: companion recover --confirm (refused while a companion owns the store)")
      console.log("Passive backend check: companion check-backend (protected discovery and scoped status only)")
      console.log("No arguments: development health listener. Import preserves the source and never enables or starts redsun.")
      return
    }
    if (command.kind === "recover") {
      const directory = yield* Effect.try(() => dataDirectory())
      yield* recoverOwner(directory)
      console.log("Browser enrollment removed. Backend enrollment is unchanged.")
      return
    }
    if (command.kind === "check-backend") {
      const directory = yield* Effect.try(() => dataDirectory())
      yield* probeBackend(directory)
      console.log("Backend identity and scoped access verified. No listener, heartbeat, or policy change was made.")
      return
    }
    if (command.kind === "serve") {
      const directory = yield* Effect.try(() => dataDirectory())
      const auth = yield* makeAuthentication(directory, command.origin)
      const http = yield* makeAuthenticationHttp(auth, command.origin)
      const remote = command.backend ? yield* operational(directory, command.origin, auth) : undefined
      yield* serve(command.port, (request) => {
        const pathname = new URL(request.url).pathname
        if (pathname === "/health") return handleRequest(request)
        if (pathname.startsWith("/auth/") || !remote) return http.handle(request)
        return remote(request)
      }, command.backend ? 6 * 1024 * 1024 : 65536)
      console.log(command.backend ? "Diagnostic listener ready on loopback. Backend readiness requires valid discovery, scoped SSE and heartbeat. No Tailscale setup was performed." : "Authentication listener ready on the configured loopback port. Backend routes and Tailscale setup remain unavailable.")
      console.log("Local commands: enroll | pending | approve <requestID> <fingerprint> | cancel | recover confirm")
      const input = yield* Effect.acquireRelease(
        Effect.sync(() => createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })),
        (input) => Effect.sync(() => input.close()),
      )
      yield* Stream.fromAsyncIterable(input, () => new Error("Local input failed")).pipe(
        Stream.runForEach((line) => localCommand(auth, line).pipe(Effect.match({
          onFailure: () => console.error("Local command failed. No approval or recovery success is implied."),
          onSuccess: (message) => console.log(message),
        }))),
        Effect.forkScoped,
      )
      yield* Effect.never
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
