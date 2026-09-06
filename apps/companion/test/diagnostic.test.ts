import { expect, test } from "bun:test"
import { Effect } from "effect"
import { diagnostic } from "../src/diagnostic"
import { containsPrompt, pendingPromptKey } from "../src/diagnostic-state"

test("pending prompt state is scoped to backend and session and reconciliation requires the exact ID", () => {
  expect(pendingPromptKey("host-a", "ses_a")).not.toBe(pendingPromptKey("host-b", "ses_a"))
  expect(pendingPromptKey("host-a", "ses_a")).not.toBe(pendingPromptKey("host-a", "ses_b"))
  expect(() => pendingPromptKey("", "ses_a")).toThrow()
  expect(() => pendingPromptKey("host", "../session")).toThrow()
  expect(containsPrompt("msg_a", [[{ id: "msg_a" }], []])).toBe(true)
  expect(containsPrompt("msg_a", [[], [{ id: "msg_a" }]])).toBe(true)
  expect(containsPrompt("msg_a", [[{ id: "msg_b", text: "msg_a" }], null, {}])).toBe(false)
})

test("diagnostic assets build without dependencies and enforce host, method and CSP boundaries", async () => {
  const origin = "https://host.example.ts.net"
  const handle = await Effect.runPromise(diagnostic(origin))
  const page = handle(new Request(origin))
  expect(page.status).toBe(200)
  expect(page.headers.get("content-security-policy")).toContain("script-src 'self'")
  expect(page.headers.get("content-security-policy")).not.toContain("unsafe-inline")
  const script = handle(new Request(origin + "/diagnostic.js"))
  expect(script.status).toBe(200)
  expect(await script.text()).toContain("parseCreationOptionsFromJSON")
  expect(handle(new Request("https://attacker.example/")).status).toBe(403)
  expect(handle(new Request(origin, { method: "POST" })).status).toBe(405)
  expect(handle(new Request(origin + "/private.json")).status).toBe(404)
})
