import { Effect } from "effect"
import type { Authentication } from "./auth/service"
import { cookie, emptyBody, headers, HttpError, json, sameOrigin } from "./auth/http"
import { BackendError } from "./backend/contract"
import { operation, OperationError } from "./backend/operations"
import type { supervise } from "./backend/supervisor"

type Backend = Effect.Success<ReturnType<typeof supervise>>

export function makeControl(auth: Pick<Authentication, "session">, backend: Backend, origin: string, now = () => performance.now()) {
  let available = 60
  let refill = now()
  let active = 0
  let closed = false
  let revision = 0
  const connections = new Set<() => void>()
  const lifetime = new AbortController()

  async function handle(request: Request): Promise<Response> {
    let admitted = false
    try {
      const path = new URL(request.url).pathname
      if (path !== "/control/request" && path !== "/control/events") throw new HttpError(404)
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } })
      sameOrigin(request, origin)
      if (closed) throw new HttpError(503)
      const token = cookie(request, "__Host-redsun-session")
      const authorization = await Effect.runPromise(auth.session(token, path !== "/control/events" && request.headers.get("x-redsun-activity") !== "background"))
      const time = now()
      available = Math.min(60, available + Math.max(0, time - refill) / 500)
      refill = time
      if (available < 1 || active >= 8) throw new HttpError(429)
      available -= 1
      active += 1
      admitted = true
      const body = await json(request, 6 * 1024 * 1024)
      if (authorization.aborted || request.signal.aborted || closed) throw new HttpError(401)
      const snapshot = backend.snapshot()
      if (snapshot.state !== "ready" || snapshot.signal.aborted) throw new HttpError(503)
      const signal = AbortSignal.any([authorization, request.signal, snapshot.signal, lifetime.signal])
      if (path === "/control/events") {
        emptyBody(body)
        let cleanup: (() => void) | undefined
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let sent = -1
            let ticks = 0
            const send = () => {
              if (sent === revision && ++ticks < 20) return
              ticks = 0
              if ((controller.desiredSize ?? 0) <= 0) { cleanup?.(); return }
              sent = revision
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ backendID: snapshot.backendID, revision })}\n\n`))
            }
            const timer = setInterval(send, 250)
            const close = () => {
              if (!connections.delete(close)) return
              clearInterval(timer)
              signal.removeEventListener("abort", close)
              active -= 1
              try { controller.close() } catch {}
            }
            cleanup = close
            connections.add(close)
            signal.addEventListener("abort", close, { once: true })
            if (signal.aborted) close()
            else send()
          },
          cancel() { cleanup?.() },
        })
        admitted = false
        return new Response(stream, { headers: { ...headers, "Content-Type": "text/event-stream" } })
      }
      const input = operation(body)
      const result = await Effect.runPromise(backend.request(input, signal, 16 * 1024 * 1024))
      if (signal.aborted) throw new HttpError(401)
      return result.status === 204 ? new Response(null, { status: 204, headers }) : Response.json(result.body, { headers })
    } catch (error) {
      const status = error instanceof HttpError || error instanceof OperationError ? error.status : error instanceof BackendError ? 503 : 401
      return new Response(null, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "1" } : {}) } })
    } finally { if (admitted) active -= 1 }
  }
  return {
    handle,
    connected: () => connections.size > 0,
    refresh: () => { revision += 1 },
    close: () => { closed = true; lifetime.abort(); for (const close of connections) close() },
  }
}
