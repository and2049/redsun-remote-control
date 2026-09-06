import { expect, test } from "bun:test"
import { Effect } from "effect"
import { makeControl } from "../src/control"
import { AuthenticationError } from "../src/auth/service"

const origin = "https://host.example.ts.net"
const token = "a".repeat(43)
const input = { method: "GET", path: "/api/session" }
function fixture() {
  const authorization = new AbortController()
  const generation = new AbortController()
  let calls = 0
  let activity: boolean | undefined
  const control = makeControl({ session: (value, active) => {
    activity = active
    return value === token && !authorization.signal.aborted ? Effect.succeed(authorization.signal) : Effect.fail(new AuthenticationError())
  } }, {
    snapshot: () => ({ state: "ready", backendID: "backend", processID: "process", signal: generation.signal }),
    request: () => Effect.sync(() => { calls += 1; return { status: 200, body: { data: [] } } }),
  }, origin, () => 0)
  const post = (path: string, body: unknown, extra: Record<string, string> = {}) => control.handle(new Request(origin + path, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: `__Host-redsun-session=${token}`, ...extra }, body: JSON.stringify(body),
  }))
  return { control, authorization, generation, post, calls: () => calls, activity: () => activity, [Symbol.dispose]: () => control.close() }
}

test("remote HTTP requires auth, exact origin and allowlisted operations before backend calls", async () => {
  using data = fixture()
  expect((await data.post("/control/request", input, { Origin: "https://attacker.example" })).status).toBe(403)
  expect((await data.post("/control/request", input, { Cookie: "" })).status).toBe(401)
  expect((await data.post("/control/request", { method: "GET", path: "/api/config" })).status).toBe(400)
  expect(data.calls()).toBe(0)
  const response = await data.post("/control/request", input)
  expect(await response.json()).toEqual({ data: [] })
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("access-control-allow-origin")).toBeNull()
  expect(data.activity()).toBe(true)
  await data.post("/control/request", input, { "X-Redsun-Activity": "background" })
  expect(data.activity()).toBe(false)
})

test.each(["authorization", "generation"] as const)("%s revocation closes browser streams and connection reports", async (kind) => {
  using data = fixture()
  const response = await data.post("/control/events", {})
  expect(response.status).toBe(200)
  expect(data.activity()).toBe(false)
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"backendID":"backend"')
  expect(data.control.connected()).toBe(true)
  data[kind].abort()
  expect((await reader.read()).done).toBe(true)
  expect(data.control.connected()).toBe(false)
  expect(data.calls()).toBe(0)
})

test("streams share bounded concurrency and browser cancellation releases a slot", async () => {
  using data = fixture()
  const responses: Response[] = []
  for (let i = 0; i < 8; i += 1) responses.push(await data.post("/control/events", {}))
  expect((await data.post("/control/request", input)).status).toBe(429)
  await responses[0]!.body!.cancel()
  expect((await data.post("/control/request", input)).status).toBe(200)
  expect(data.generation.signal.aborted).toBe(false)
})

test("authenticated request budget is bounded independent of proxy identities", async () => {
  using data = fixture()
  for (let i = 0; i < 60; i += 1) expect((await data.post("/control/request", input, { "X-Forwarded-For": String(i) })).status).toBe(200)
  expect((await data.post("/control/request", input)).status).toBe(429)
})
