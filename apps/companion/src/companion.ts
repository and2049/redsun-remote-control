import { Effect } from "effect"
import type { Authentication } from "./auth/service"
import { serve } from "./server"
import { validateServe } from "./command"
import { dataDirectory, importBackend, removeBackend, storeHandoff } from "./storage/backend"
import { recoverOwner } from "./storage/owner"
import { makeAuthentication } from "./auth/service"
import { makeAuthenticationHttp } from "./auth/http"
import { handleRequest } from "./http"
import { localCommand } from "./local"
import { probeBackend } from "./backend/probe"
import { operational } from "./operational"

export type Local = Authentication["local"]

export type ServeOptions = {
  readonly origin: string
  readonly port: number
  readonly backend?: boolean
  readonly directory?: string
}

const attempt = <A>(evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: (error) => (error instanceof Error ? error : new Error("Invalid companion configuration")) })

const directory = (override?: string) => attempt(() => override ?? dataDirectory())

export const importHandoffFile = (source: string, override?: string) =>
  directory(override).pipe(Effect.flatMap((target) => importBackend(source, target)))

export const importHandoff = (handoff: unknown, override?: string) =>
  directory(override).pipe(Effect.flatMap((target) => storeHandoff(handoff, target)))

export const removeHandoff = (override?: string) => directory(override).pipe(Effect.flatMap(removeBackend))

export const checkBackend = (override?: string) => directory(override).pipe(Effect.flatMap(probeBackend))

export const recoverBrowser = (override?: string) => directory(override).pipe(Effect.flatMap(recoverOwner))

export function serveCompanion(options: ServeOptions) {
  return Effect.gen(function* () {
    const { origin, port } = yield* attempt(() => validateServe(options.origin, options.port))
    const target = yield* directory(options.directory)
    const auth = yield* makeAuthentication(target, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    const remote = options.backend ? yield* operational(target, origin, auth) : undefined
    yield* serve(port, (request) => {
      const pathname = new URL(request.url).pathname
      if (pathname === "/health") return handleRequest(request)
      if (pathname.startsWith("/auth/") || !remote) return http.handle(request)
      return remote.handle(request)
    }, options.backend ? 6 * 1024 * 1024 : 65536)
    return { command: (line: string) => localCommand(auth, line), local: auth.local, backend: () => remote?.snapshot() }
  })
}
