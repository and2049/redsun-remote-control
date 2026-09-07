import { expect, test } from "bun:test"
import { operation } from "../../src/backend/operations"
import { eventParser } from "../../src/backend/events"
import { status } from "./fixture"

test.each([
  { method: "GET", path: "/api/session", query: { cursor: "opaque", limit: "20" } },
  { method: "GET", path: "/api/location", query: { "location[directory]": "C:\\work" } },
  { method: "GET", path: "/api/remote/theme" },
  { method: "POST", path: "/api/session", body: { id: "ses_example", location: { directory: "C:\\work" } } },
  { method: "POST", path: "/api/session/ses_example/prompt", body: { id: "msg_example", text: "hello", delivery: "queue", files: [{ uri: "data:text/plain;base64,YQ==" }] } },
  { method: "POST", path: "/api/session/ses_example/permission/per_example/reply", body: { reply: "once" } },
  { method: "POST", path: "/api/session/ses_example/form/frm_example/reply", body: { answer: { a: "yes", b: 1, c: true, d: ["x"] } } },
  { method: "POST", path: "/api/session/ses_example/interrupt", body: {}, query: { continue: "false" } },
])("accepts scoped request contracts", (input) => { expect(operation(input)).toEqual(input) })

test.each([
  { method: "GET", path: "/api/remote" },
  { method: "GET", path: "/api/event" },
  { method: "GET", path: "/api/config" },
  { method: "GET", path: "/api/remote/theme", query: { "location[directory]": "C:\\work" } },
  { method: "POST", path: "/api/remote/heartbeat", body: { connected: true } },
  { method: "DELETE", path: "/api/session/ses_example" },
  { method: "GET", path: "http://127.0.0.1/api/session" },
  { method: "GET", path: "/api/session/ses_example/../config" },
  { method: "GET", path: "/api/session/ses_example%2fmessage" },
  { method: "GET", path: "/api/session", query: { token: "secret" } },
  { method: "GET", path: "/api/session", body: {} },
  { method: "POST", path: "/api/session", body: { metadata: {} } },
  { method: "POST", path: "/api/session", body: { model: { id: "m", providerID: "p", headers: {} } } },
  { method: "POST", path: "/api/session/ses_example/prompt", body: { text: "missing id" } },
  { method: "POST", path: "/api/session/ses_example/prompt", body: { id: "msg_example", text: "x", resume: false } },
  { method: "POST", path: "/api/session/ses_example/prompt", body: { id: "msg_example", text: "x", files: [{ uri: "file:///secret" }] } },
  { method: "POST", path: "/api/session/ses_example/prompt", body: { id: "msg_example", text: "x", files: Array.from({ length: 5 }, () => ({ uri: "data:text/plain;base64,YQ==" })) } },
  { method: "POST", path: "/api/session/ses_example/interrupt", body: { extra: true } },
  { method: "POST", path: "/api/session/ses_example/form/global/reply", body: { answer: {} } },
])("rejects routes and fields outside the scoped capability table", (input) => { expect(() => operation(input)).toThrow("Remote operation failed") })

test("SSE parser accepts fragmented CRLF frames and comments, forwarding only validated hints", () => {
  const seen: unknown[] = []
  const parse = eventParser((value) => seen.push(value))
  const frames = `: heartbeat\r\n\r\ndata: ${JSON.stringify({ id: "evt_a", type: "server.connected", data: {} })}\r\n\r\ndata: ${JSON.stringify({ id: "evt_b", created: 1, type: "remote.status", data: status })}\n\n`
  for (const character of frames) parse(character)
  expect(seen).toEqual([undefined, status])
})

test.each([
  `data: ${JSON.stringify({ id: "a", type: "session.text.delta", data: { text: "secret" } })}\n\n`,
  `data: ${JSON.stringify({ id: "a", type: "remote.sync", data: { secret: true } })}\n\n`,
  `data: ${JSON.stringify({ id: "a", type: "remote.status", data: { ...status, version: 2 } })}\n\n`,
  "data: malformed\n\n", "x".repeat(16385), "event: unexpected\n\n",
])("SSE parser fails closed on malformed, oversized or unscoped events", (frame) => {
  expect(() => eventParser(() => { throw new Error("Must not receive payload") })(frame)).toThrow("invalid-contract")
})
