import { request } from "node:http"
import { Effect, Redacted } from "effect"
import { BackendError } from "./contract"
import { operation, OperationError } from "./operations"
import { loopbackEndpoint } from "./transport"

export function remoteRequest(
  endpoint: URL,
  authorization: Redacted.Redacted<string>,
  input: unknown,
  lifetime: AbortSignal,
  timeoutMs: number,
  responseLimit: number,
) {
  return Effect.tryPromise({
    try: (signal) => new Promise<{ readonly status: number; readonly body?: unknown }>((resolve, reject) => {
      if (!Number.isSafeInteger(responseLimit) || responseLimit <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
        throw new BackendError("invalid-contract")
      }
      const value = operation(input)
      const url = loopbackEndpoint(endpoint.href)
      url.pathname = value.path
      for (const [key, entry] of Object.entries(value.query ?? {})) url.searchParams.set(key, entry)
      const body = value.method === "GET" ? undefined : JSON.stringify(value.body)
      if (body !== undefined && Buffer.byteLength(body) > 6 * 1024 * 1024) throw new OperationError(413)
      const req = request(url, {
        method: value.method, agent: false, signal: AbortSignal.any([signal, lifetime]),
        headers: {
          Authorization: Redacted.value(authorization), Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }),
        },
      })
      const fail = (error: BackendError | OperationError) => { clearTimeout(timer); reject(error); req.destroy() }
      const timer = setTimeout(() => fail(new BackendError("unavailable")), timeoutMs)
      req.on("error", () => fail(new BackendError("unavailable")))
      req.on("response", (response) => {
        const code = response.statusCode ?? 0
        if (code === 401 || code === 403) { fail(new BackendError("refused")); return }
        if ([400, 404, 409].includes(code)) { fail(new OperationError(code)); return }
        if (code !== 200 && code !== 204) { fail(new BackendError("unavailable")); return }
        if (code === 204) { clearTimeout(timer); response.resume(); resolve({ status: 204 }); return }
        if (response.headers["content-type"]?.split(";")[0]?.trim() !== "application/json" || response.headers["content-encoding"]) {
          fail(new BackendError("invalid-contract")); return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > responseLimit) { fail(new BackendError("invalid-contract")); return }
          chunks.push(chunk)
        })
        response.on("error", () => fail(new BackendError("unavailable")))
        response.on("end", () => {
          clearTimeout(timer)
          try {
            const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
            resolve({ status: code, body })
          } catch { fail(new BackendError("invalid-contract")) }
        })
      })
      req.end(body)
    }),
    catch: (error) => error instanceof BackendError || error instanceof OperationError ? error : new BackendError("unavailable"),
  })
}
