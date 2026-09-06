import { Effect } from "effect"
import type { Authentication } from "./auth/service"
import { supervise } from "./backend/supervisor"
import { loadBackend } from "./storage/backend"
import { makeControl } from "./control"
import { diagnostic } from "./diagnostic"

export function operational(directory: string, origin: string, auth: Authentication) {
  return Effect.gen(function* () {
    const enrollment = yield* loadBackend(directory)
    const assets = yield* diagnostic(origin)
    let control: ReturnType<typeof makeControl> | undefined
    const backend = yield* supervise(enrollment, {
      timeoutMs: 5000, heartbeatMs: 10_000, retryMs: 3000,
      connected: () => control?.connected() ?? false,
      invalidate: auth.revoke.pipe(Effect.ignore),
      onSync: () => control?.refresh(),
    })
    control = makeControl(auth, backend, origin)
    const handler = control
    yield* Effect.addFinalizer(() => Effect.sync(() => handler.close()))
    return (request: Request) => new URL(request.url).pathname.startsWith("/control/") ? handler.handle(request) : assets(request)
  })
}
