import { createInterface } from "node:readline"
import { Effect, Stream } from "effect"
import { serve } from "./server"
import { parseCommand } from "./command"
import { checkBackend, importHandoffFile, recoverBrowser, serveCompanion } from "./companion"

export type MainOptions = { readonly signal: AbortSignal; readonly name?: string }

export async function main(args: readonly string[], options: MainOptions): Promise<number> {
  const name = options.name ?? "companion"
  const program = Effect.scoped(
    Effect.gen(function* () {
      const command = yield* Effect.try(() => parseCommand(args))
      if (command.kind === "help") {
        console.log(`Usage: ${name} [--help | import-backend <absolute-private-handoff-file>]`)
        console.log(`Authenticated mode: ${name} serve --origin <https-origin> --port <loopback-port>`)
        console.log("Phone diagnostic and scoped backend routes: append --backend (requires an imported handoff)")
        console.log(`Offline browser recovery: ${name} recover --confirm (refused while a companion owns the store)`)
        console.log(`Passive backend check: ${name} check-backend (protected discovery and scoped status only)`)
        console.log("No arguments: development health listener. Import preserves the source and never enables or starts redsun.")
        return
      }
      if (command.kind === "recover") {
        yield* recoverBrowser()
        console.log("Browser enrollment removed. Backend enrollment is unchanged.")
        return
      }
      if (command.kind === "check-backend") {
        yield* checkBackend()
        console.log("Backend identity and scoped access verified. No listener, heartbeat, or policy change was made.")
        return
      }
      if (command.kind === "import-backend") {
        yield* importHandoffFile(command.source)
        console.log("Backend handoff imported. Source preserved. No backend connection or policy change was made.")
        return
      }
      if (command.kind === "serve") {
        const companion = yield* serveCompanion(command)
        console.log(command.backend ? "Diagnostic listener ready on loopback. Backend readiness requires valid discovery, scoped SSE and heartbeat. No Tailscale setup was performed." : "Authentication listener ready on the configured loopback port. Backend routes and Tailscale setup remain unavailable.")
        console.log("Local commands: enroll | pending | approve <requestID> <fingerprint> | cancel | recover confirm")
        const input = yield* Effect.acquireRelease(
          Effect.sync(() => createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })),
          (input) => Effect.sync(() => input.close()),
        )
        yield* Stream.fromAsyncIterable(input, () => new Error("Local input failed")).pipe(
          Stream.runForEach((line) => companion.command(line).pipe(Effect.match({
            onFailure: () => console.error("Local command failed. No approval or recovery success is implied."),
            onSuccess: (message) => console.log(message),
          }))),
          Effect.forkScoped,
        )
        yield* Effect.never
        return
      }
      const server = yield* serve(0)
      console.log(`Foundation listener: ${server.url}health`)
      console.log("Loopback only. Login, remote access, and operational backend attachment are not wired.")
      yield* Effect.never
    }),
  )
  try {
    await Effect.runPromise(program, { signal: options.signal })
    return 0
  } catch {
    if (options.signal.aborted) return 0
    console.error("Companion command failed. Check arguments, private file permissions, and whether an import already exists. Use --help for usage.")
    return 1
  }
}
