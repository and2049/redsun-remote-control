import { Effect } from "effect"
import { handleRequest } from "./http"

export function serve(port: number, handler: (request: Request) => Response | Promise<Response> = handleRequest) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port, fetch: handler, maxRequestBodySize: 65536, idleTimeout: 10, development: false })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}
