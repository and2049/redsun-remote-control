import { request } from "node:http"
import { Effect, Redacted, Schema } from "effect"
import { BackendError, decodeStatus, type Status } from "./contract"
import { loopbackEndpoint } from "./transport"

const Event = Schema.Struct({
  id: Schema.String,
  created: Schema.optional(Schema.Finite),
  type: Schema.Literals(["server.connected", "remote.sync", "remote.status"]),
  data: Schema.Unknown,
})

export function eventParser(onEvent: (status?: Status) => void) {
  let buffer = ""
  let lines: string[] = []
  let size = 0
  return (chunk: string) => {
    buffer += chunk
    while (true) {
      const index = buffer.indexOf("\n")
      if (index < 0) break
      const line = buffer.slice(0, index).replace(/\r$/, "")
      buffer = buffer.slice(index + 1)
      size += line.length
      if (size > 16384) throw new BackendError("invalid-contract")
      if (!line) {
        if (lines.length) {
          try {
            const value: unknown = JSON.parse(lines.join("\n"))
            const event = Schema.decodeUnknownSync(Event, { onExcessProperty: "error" })(value)
            if (event.type !== "remote.status" && (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(event.data) || Object.keys(event.data).length)) {
              throw new BackendError("invalid-contract")
            }
            onEvent(event.type === "remote.status" ? decodeStatus(event.data) : undefined)
          } catch (error) { throw error instanceof BackendError ? error : new BackendError("invalid-contract") }
        }
        lines = []
        size = 0
      } else if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""))
      else if (!line.startsWith(":")) throw new BackendError("invalid-contract")
    }
    if (buffer.length + size > 16384) throw new BackendError("invalid-contract")
  }
}

export function watchEvents(
  endpoint: URL, authorization: Redacted.Redacted<string>, lifetime: AbortSignal,
  timeoutMs: number, onEvent: (status?: Status) => void,
) {
  return Effect.tryPromise({
    try: (signal) => new Promise<never>((_, reject) => {
      const url = loopbackEndpoint(endpoint.href)
      url.pathname = "/api/event"
      const req = request(url, { agent: false, signal: AbortSignal.any([signal, lifetime]), headers: {
        Authorization: Redacted.value(authorization), Accept: "text/event-stream",
      } })
      const fail = (reason: BackendError["reason"]) => { clearTimeout(timer); reject(new BackendError(reason)); req.destroy() }
      const timer = setTimeout(() => fail("unavailable"), timeoutMs)
      req.on("error", () => fail("unavailable"))
      req.on("response", (response) => {
        if (response.statusCode !== 200) { fail(response.statusCode === 401 || response.statusCode === 403 ? "refused" : "unavailable"); return }
        if (response.headers["content-type"]?.split(";")[0]?.trim() !== "text/event-stream" || response.headers["content-encoding"]) {
          fail("invalid-contract"); return
        }
        clearTimeout(timer)
        const parse = eventParser(onEvent)
        const decoder = new TextDecoder("utf-8", { fatal: true })
        response.on("data", (chunk: Buffer) => {
          try { parse(decoder.decode(chunk, { stream: true })) }
          catch (error) { fail(error instanceof BackendError ? error.reason : "invalid-contract") }
        })
        response.on("end", () => fail("unavailable"))
        response.on("error", () => fail("unavailable"))
      })
      req.end()
    }),
    catch: (error) => error instanceof BackendError ? error : new BackendError("unavailable"),
  })
}
