import { expect, test } from "bun:test"
import { createServer } from "node:http"
import { Effect } from "effect"
import { BackendError, decodeHandoff } from "../../src/backend/contract"
import { supervise, type BackendSnapshot } from "../../src/backend/supervisor"
import { handoff, status } from "./fixture"

function waitFor(read: () => BackendSnapshot, state: BackendSnapshot["state"]) {
  return Effect.gen(function* () {
    for (let i = 0; i < 200; i += 1) {
      const value = read()
      if (value.state === state) return value
      yield* Effect.sleep(5)
    }
    return yield* Effect.die(new Error(`Supervisor did not reach ${state}`))
  })
}

test.each([
  { events: false, code: 503, reason: "unavailable" },
  { events: true, code: 503, reason: "unavailable" },
  { events: false, code: 401, reason: "refused" },
  { events: true, code: 401, reason: "refused" },
  { events: true, code: 200, reason: "invalid-contract" },
])("operation failure retains its retry classification: %j", async ({ events, code, reason }) => {
  let discoveries = 0
  const server = createServer((request, response) => {
    if (request.url === "/api/event") {
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write(`data: ${JSON.stringify({ id: "evt_fixture", type: "server.connected", data: {} })}\n\n`)
      return
    }
    response.writeHead(request.url === "/api/session" ? code : 200, { "Content-Type": "application/json" })
    response.end(request.url === "/api/session" ? "invalid" : JSON.stringify(status))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Invalid fixture address")
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const supervisor = yield* supervise(decodeHandoff(handoff), {
        timeoutMs: 200, heartbeatMs: 20, retryMs: 20, connected: () => false,
        invalidate: Effect.void, ...(events ? { onSync: () => {} } : {}),
      }, Effect.sync(() => {
        discoveries += 1
        return { id: status.processID, version: "fixture", pid: process.pid, url: `http://127.0.0.1:${address.port}` }
      }))
      const ready = yield* waitFor(supervisor.snapshot, "ready")
      const error = yield* supervisor.request({ method: "GET", path: "/api/session" }, new AbortController().signal, 1024).pipe(Effect.flip)
      expect(error instanceof BackendError && error.reason).toBe(reason)
      expect(ready.state === "ready" && ready.signal.aborted).toBe(true)
      if (reason === "unavailable") {
        yield* waitFor(supervisor.snapshot, "ready")
        expect(discoveries).toBe(2)
      } else {
        expect(yield* waitFor(supervisor.snapshot, "stopped")).toEqual({ state: "stopped", reason })
        yield* Effect.sleep(60)
        expect(discoveries).toBe(1)
      }
    })))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("supervisor heartbeats, invalidates outages, rediscovers process identity, and closes its scope", async () => {
  let processID: string = status.processID
  let available = true
  let connected = false
  let discoveries = 0
  let invalidations = 0
  const reports: boolean[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (!available) return new Response(null, { status: 503 })
    if (request.method === "POST") {
      const body: unknown = await request.json()
      reports.push(typeof body === "object" && body !== null && "connected" in body && body.connected === true)
    }
    return Response.json({ ...status, processID })
  } })
  try {
    const supervisor = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const supervisor = yield* supervise(decodeHandoff(handoff), {
        timeoutMs: 100, heartbeatMs: 10, retryMs: 40, connected: () => connected,
        invalidate: Effect.sync(() => { invalidations += 1 }),
      }, Effect.sync(() => {
        discoveries += 1
        return { id: processID, version: "fixture", pid: process.pid, url: server.url.origin }
      }))
      const first = yield* waitFor(supervisor.snapshot, "ready")
      if (first.state !== "ready") throw new Error("Not ready")
      expect(reports[0]).toBe(false)
      connected = true
      yield* Effect.sleep(30)
      expect(reports).toContain(true)
      available = false
      yield* waitFor(supervisor.snapshot, "unavailable")
      expect(first.signal.aborted).toBe(true)
      expect(invalidations).toBeGreaterThan(0)
      processID = "replacement-process"
      available = true
      const next = yield* waitFor(supervisor.snapshot, "ready")
      expect(next.state === "ready" && next.processID).toBe(processID)
      expect(discoveries).toBeGreaterThan(1)
      return supervisor
    })))
    expect(supervisor.snapshot()).toEqual({ state: "closed" })
    const count = reports.length
    await Bun.sleep(40)
    expect(reports).toHaveLength(count)
  } finally { await server.stop(true) }
})

test.each(["refused", "identity-mismatch", "invalid-contract", "invalid-endpoint"] as const)(
  "supervisor stops without retries on %s", async (reason) => {
    let discoveries = 0
    const stops: string[] = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const supervisor = yield* supervise(decodeHandoff(handoff), {
        timeoutMs: 100, heartbeatMs: 10, retryMs: 10, connected: () => false, invalidate: Effect.void, onStop: (why) => stops.push(why),
      }, Effect.suspend(() => { discoveries += 1; return Effect.fail(new BackendError(reason)) }))
      expect(yield* waitFor(supervisor.snapshot, "stopped")).toEqual({ state: "stopped", reason })
      yield* Effect.sleep(30)
      expect(discoveries).toBe(1)
      expect(stops).toEqual([reason])
    })))
  },
)

test("backend disable aborts the ready generation and never silently resumes it", async () => {
  let enabled = true
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => enabled ? Response.json(status) : new Response(null, { status: 401 }) })
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const supervisor = yield* supervise(decodeHandoff(handoff), {
        timeoutMs: 100, heartbeatMs: 10, retryMs: 10, connected: () => false, invalidate: Effect.void,
      }, Effect.succeed({ id: status.processID, version: "fixture", pid: process.pid, url: server.url.origin }))
      const ready = yield* waitFor(supervisor.snapshot, "ready")
      enabled = false
      expect(yield* waitFor(supervisor.snapshot, "stopped")).toEqual({ state: "stopped", reason: "refused" })
      expect(ready.state === "ready" && ready.signal.aborted).toBe(true)
      enabled = true
      yield* Effect.sleep(30)
      expect(supervisor.snapshot().state).toBe("stopped")
    })))
  } finally { await server.stop(true) }
})

test("supervisor rejects timings that cannot renew the lease within thirty seconds", async () => {
  for (const heartbeatMs of [0, -1, 0.5, 29_000, NaN]) {
    await expect(Effect.runPromise(Effect.scoped(supervise(decodeHandoff(handoff), {
      timeoutMs: 1000, heartbeatMs, retryMs: 100, connected: () => false, invalidate: Effect.void,
    })))).rejects.toThrow("invalid-contract")
  }
})

test("scope shutdown aborts a pending heartbeat and its ready generation", async () => {
  let heartbeatCount = 0
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  const server = createServer((request, response) => {
    if (request.method === "POST") {
      heartbeatCount += 1
      if (heartbeatCount > 1) {
        release?.()
        response.writeHead(200, { "Content-Type": "application/json" })
        response.write("{")
        return
      }
    }
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify(status))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Invalid fixture address")
  try {
    const ready = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const supervisor = yield* supervise(decodeHandoff(handoff), {
        timeoutMs: 20_000, heartbeatMs: 10, retryMs: 100, connected: () => false, invalidate: Effect.void,
      }, Effect.succeed({ id: status.processID, version: "fixture", pid: process.pid, url: `http://127.0.0.1:${address.port}` }))
      const ready = yield* waitFor(supervisor.snapshot, "ready")
      yield* Effect.promise(() => pending)
      return ready
    })))
    expect(ready.state === "ready" && ready.signal.aborted).toBe(true)
    expect(heartbeatCount).toBe(2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 3000)

test("a changed identity on a live heartbeat stops instead of adopting another backend", async () => {
  let changed = false
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({
    ...status, backendID: changed ? "different-backend" : status.backendID,
  }) })
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const supervisor = yield* supervise(decodeHandoff(handoff), {
        timeoutMs: 100, heartbeatMs: 10, retryMs: 10, connected: () => false, invalidate: Effect.void,
      }, Effect.succeed({ id: status.processID, version: "fixture", pid: process.pid, url: server.url.origin }))
      const ready = yield* waitFor(supervisor.snapshot, "ready")
      changed = true
      expect(yield* waitFor(supervisor.snapshot, "stopped")).toEqual({ state: "stopped", reason: "identity-mismatch" })
      expect(ready.state === "ready" && ready.signal.aborted).toBe(true)
    })))
  } finally { await server.stop(true) }
})
