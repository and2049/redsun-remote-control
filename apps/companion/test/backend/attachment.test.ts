import { expect, test } from "bun:test"
import { Effect } from "effect"
import { attach } from "../../src/backend/attachment"
import { decodeHandoff } from "../../src/backend/contract"
import { handoff, status } from "./fixture"

function fixture(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  return {
    server,
    registration: { id: status.processID, version: "test", url: server.url.origin, pid: process.pid },
    [Symbol.asyncDispose]: () => server.stop(true),
  }
}

test("attaches passively with scoped auth and validates each heartbeat", async () => {
  const requests: string[] = []
  await using backend = fixture(async (request) => {
    expect(request.headers.get("Authorization")).toBe(`Bearer rc1.${handoff.credentialID}.${handoff.token}`)
    requests.push(`${request.method} ${new URL(request.url).pathname}`)
    if (request.method === "POST") {
      expect(await request.json()).toEqual({ connected: false })
      return Response.json({ ...status, state: "ready" })
    }
    return Response.json(status)
  })
  const attachment = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const connection = yield* attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 })
    expect(connection.backendID).toBe(handoff.backendID)
    expect(connection.initialStatus.state).toBe("unavailable")
    expect((yield* connection.heartbeat(false)).state).toBe("ready")
    return connection
  })))
  await expect(Effect.runPromise(attachment.status())).rejects.toThrow("closed")
  expect(requests).toEqual(["GET /api/remote", "POST /api/remote/heartbeat"])
})

test.each([
  { backendID: "other-backend" }, { processID: "other-process" }, { version: 2 },
  { supported: false }, { enabled: false }, { enrolled: false }, { state: "disabled" },
])("refuses incompatible or unauthorized status: %j", async (override) => {
  await using backend = fixture(() => Response.json({ ...status, ...override }))
  await expect(Effect.runPromise(Effect.scoped(
    attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 }),
  ))).rejects.toThrow("Backend attachment failed")
})

test("does not follow redirects or leak credentials to their destination", async () => {
  let received = false
  await using destination = fixture(() => {
    received = true
    return Response.json(status)
  })
  await using backend = fixture(() => Response.redirect(destination.server.url))
  await expect(Effect.runPromise(Effect.scoped(
    attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 }),
  ))).rejects.toThrow("unavailable")
  expect(received).toBe(false)
})

test.each([401, 403, 404, 500, 503])("does not retry HTTP %s or expose its error body", async (code) => {
  let count = 0
  await using backend = fixture(() => {
    count += 1
    return new Response("private backend detail", { status: code })
  })
  const result = await Effect.runPromise(Effect.scoped(
    attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 }),
  ).pipe(Effect.flip))
  expect(result.reason).toBe(code === 401 ? "refused" : "unavailable")
  expect(String(result)).not.toContain("private backend detail")
  expect(count).toBe(1)
})

test("a status failure invalidates the handle until explicit rediscovery", async () => {
  let valid = true
  let count = 0
  await using backend = fixture(() => {
    count += 1
    return valid ? Response.json(status) : new Response(null, { status: 401 })
  })
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const connection = yield* attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 })
    valid = false
    expect((yield* connection.heartbeat(false).pipe(Effect.flip)).reason).toBe("refused")
    valid = true
    expect((yield* connection.status().pipe(Effect.flip)).reason).toBe("closed")
    const replacement = yield* attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 })
    expect(replacement.backendID).toBe(handoff.backendID)
  })))
  expect(count).toBe(3)
})

test.each(["not-json", "x".repeat(16 * 1024 + 1)])("rejects invalid or oversized JSON", async (body) => {
  await using backend = fixture(() => new Response(body, { headers: { "Content-Type": "application/json" } }))
  await expect(Effect.runPromise(Effect.scoped(
    attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 }),
  ))).rejects.toThrow("invalid-contract")
})

test("times out a response that stalls after headers", async () => {
  await using backend = fixture(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{")) },
  }), { headers: { "Content-Type": "application/json" } }))
  await expect(Effect.runPromise(Effect.scoped(
    attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 50 }),
  ))).rejects.toThrow("unavailable")
})

test("explicit close aborts an in-flight status request", async () => {
  let count = 0
  let arrived: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => { arrived = resolve })
  await using backend = fixture(() => {
    count += 1
    if (count === 1) return Response.json(status)
    arrived?.()
    return new Promise<Response>(() => {})
  })
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const connection = yield* attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 5000 })
    const pending = Effect.runPromise(connection.status()).then(() => "unexpected", () => "rejected")
    yield* Effect.promise(() => waiting)
    yield* connection.close
    expect(yield* Effect.promise(() => pending)).toBe("rejected")
  })))
})

test("process replacement requires renewed discovery and durable identity validation", async () => {
  let processID: string = status.processID
  await using backend = fixture(() => Response.json({ ...status, processID }))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const connection = yield* attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 })
    processID = "replacement-process"
    expect((yield* connection.status().pipe(Effect.flip)).reason).toBe("identity-mismatch")
    const replacement = yield* attach(decodeHandoff(handoff), { ...backend.registration, id: processID }, { timeoutMs: 1000 })
    expect(replacement.backendID).toBe(handoff.backendID)
    expect(replacement.processID).toBe(processID)
  })))
})

test("does not send scoped credentials through environment-configured proxies", async () => {
  let proxyRequests = 0
  await using proxy = fixture(() => {
    proxyRequests += 1
    return new Response(null, { status: 502 })
  })
  await using backend = fixture(() => Response.json(status))
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"]
  const previous = keys.map((key) => [key, process.env[key]] as const)
  try {
    for (const key of keys) process.env[key] = key.toLowerCase() === "no_proxy" ? "" : proxy.server.url.origin
    await Effect.runPromise(Effect.scoped(attach(decodeHandoff(handoff), backend.registration, { timeoutMs: 1000 })))
    expect(proxyRequests).toBe(0)
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
