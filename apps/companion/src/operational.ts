import { Effect } from "effect"
import type { Authentication } from "./auth/service"
import { supervise } from "./backend/supervisor"
import { loadBackend } from "./storage/backend"
import { makeControl } from "./control"
import { diagnostic } from "./diagnostic"
import { web } from "./web"

export function operational(directory: string, origin: string, auth: Authentication) {
  return Effect.gen(function* () {
    const enrollment = yield* loadBackend(directory)
    const diagnosticAssets = yield* diagnostic(origin)
    const webAssets = yield* web(origin)
    let control: ReturnType<typeof makeControl> | undefined
    const backend = yield* supervise(enrollment, {
      timeoutMs: 5000, heartbeatMs: 10_000, retryMs: 3000,
      connected: () => control?.connected() ?? false,
      invalidate: auth.revoke.pipe(Effect.ignore),
      onSync: () => control?.refresh(),
      onStop: (reason) => console.error(`Backend supervision stopped: ${reason}. Correct the problem locally and restart the companion.`),
    })
    control = makeControl(auth, backend, origin)
    const handler = control
    yield* Effect.addFinalizer(() => Effect.sync(() => handler.close()))
    return (request: Request) => {
      const path = new URL(request.url).pathname
      if (path.startsWith("/control/")) return handler.handle(request)
      if (path === "/diagnostic" || path === "/diagnostic.js") return diagnosticAssets(request)
      return webAssets(request)
    }
  })
}
