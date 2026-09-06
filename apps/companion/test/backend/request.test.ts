import { expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { attach } from "../../src/backend/attachment"
import { decodeHandoff } from "../../src/backend/contract"
import { remoteRequest } from "../../src/backend/request"
import { handoff, status } from "./fixture"

const authorization = Redacted.make(`Bearer rc1.${handoff.credentialID}.${handoff.token}`)
const lifetime = new AbortController().signal
const input = { method: "POST", path: "/api/session/ses_fixture/prompt", body: { id: "msg_retained", text: "hello" } }

test("remote mutations retain IDs, forward no browser headers and never retry uncertain responses", async () => {
  let calls = 0
  const backend = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    calls += 1
    expect(request.headers.get("authorization")).toBe(Redacted.value(authorization))
    expect(request.headers.get("cookie")).toBeNull()
    expect(await request.json()).toEqual(input.body)
    return new Response("sensitive backend failure", { status: 503 })
  } })
  try {
    const error = await Effect.runPromise(remoteRequest(backend.url, authorization, input, lifetime, 1000, 16384).pipe(Effect.flip))
    expect(String(error)).not.toContain("sensitive")
    expect(calls).toBe(1)
  } finally { await backend.stop(true) }
})

test("operation validation precedes network access and redirects are never visited", async () => {
  let calls = 0
  const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { calls += 1; return Response.json({ data: [] }) } })
  const redirect = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.redirect(target.url) })
  try {
    await expect(Effect.runPromise(remoteRequest(target.url, authorization, { method: "GET", path: "/api/config" }, lifetime, 1000, 1000))).rejects.toThrow("Remote operation failed")
    await expect(Effect.runPromise(remoteRequest(redirect.url, authorization, input, lifetime, 1000, 1000))).rejects.toThrow("unavailable")
    expect(calls).toBe(0)
  } finally { await redirect.stop(true); await target.stop(true) }
})

test.each([
  { body: "{}".repeat(100), headers: { "Content-Type": "application/json" } },
  { body: "{}", headers: { "Content-Type": "text/plain" } },
  { body: "{", headers: { "Content-Type": "application/json" } },
])("remote responses fail closed on invalid type, JSON or size", async (response) => {
  const backend = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(response.body, { headers: response.headers }) })
  try {
    await expect(Effect.runPromise(remoteRequest(backend.url, authorization, input, lifetime, 1000, 100))).rejects.toThrow("invalid-contract")
  } finally { await backend.stop(true) }
})

test("ordinary operation errors do not invalidate attachment but authorization failures do", async () => {
  let code = 404
  const backend = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/api/remote"
    ? Response.json(status) : new Response(null, { status: code }) })
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const connection = yield* attach(decodeHandoff(handoff), { id: status.processID, pid: process.pid, version: "fixture", url: backend.url.origin }, { timeoutMs: 1000 })
      const error = yield* connection.request(input, lifetime, 1000).pipe(Effect.flip)
      expect("status" in error && error.status).toBe(404)
      expect((yield* connection.status()).backendID).toBe(handoff.backendID)
      code = 401
      yield* connection.request(input, lifetime, 1000).pipe(Effect.flip)
      expect((yield* connection.status().pipe(Effect.flip)).reason).toBe("closed")
    })))
  } finally { await backend.stop(true) }
})
