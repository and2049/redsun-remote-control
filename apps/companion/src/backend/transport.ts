import { request } from "node:http"
import { Effect, Redacted } from "effect"
import { BackendError } from "./contract"

export function loopbackEndpoint(value: string): URL {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "http:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || value.includes("?") || value.includes("#")
    ) throw new BackendError("invalid-endpoint")
    if (url.hostname === "localhost") url.hostname = "127.0.0.1"
    if (url.hostname !== "[::1]" && !/^127\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      throw new BackendError("invalid-endpoint")
    }
    return url
  } catch {
    throw new BackendError("invalid-endpoint")
  }
}

export function statusRequest(
  endpoint: URL,
  authorization: Redacted.Redacted<string>,
  timeoutMs: number,
  lifetime: AbortSignal,
  connected?: boolean,
) {
  return Effect.tryPromise({
    try: (signal) => new Promise<unknown>((resolve, reject) => {
      const url = loopbackEndpoint(endpoint.href)
      url.pathname = connected === undefined ? "/api/remote" : "/api/remote/heartbeat"
      const body = connected === undefined ? undefined : JSON.stringify({ connected })
      const req = request(url, {
        method: body === undefined ? "GET" : "POST",
        agent: false,
        signal: AbortSignal.any([signal, lifetime]),
        headers: {
          Authorization: Redacted.value(authorization),
          Accept: "application/json",
          ...(body === undefined ? {} : {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          }),
        },
      })
      const timer = setTimeout(() => req.destroy(new BackendError("unavailable")), timeoutMs)
      const fail = (reason: "unavailable" | "refused" | "invalid-contract") => {
        clearTimeout(timer)
        reject(new BackendError(reason))
        req.destroy()
      }
      req.on("error", () => fail("unavailable"))
      req.on("response", (response) => {
        if (response.statusCode !== 200) {
          fail(response.statusCode === 401 ? "refused" : "unavailable")
          return
        }
        if (response.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
          fail("invalid-contract")
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > 16 * 1024) {
            fail("invalid-contract")
            return
          }
          chunks.push(chunk)
        })
        response.on("error", () => fail("unavailable"))
        response.on("end", () => {
          clearTimeout(timer)
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
            resolve(value)
          } catch {
            fail("invalid-contract")
          }
        })
      })
      req.end(body)
    }),
    catch: (error) => error instanceof BackendError ? error : new BackendError("unavailable"),
  })
}
