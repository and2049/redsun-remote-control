import { Effect } from "effect"
import { handleRequest } from "./http"

export function serve(port: number) {
  return Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port, fetch: handleRequest })),
    (server) => Effect.promise(() => server.stop(true)),
  )
}
