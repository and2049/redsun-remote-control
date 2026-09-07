import { expect, test } from "bun:test"
import { containsPrompt, creatingKey, directoryName, modelLabel, newID, pendingPromptKey, readPending, relativeTime, sessionTitle } from "../src/state"
import type { Session } from "../src/types"

function session(id: string, updated: number, overrides: Partial<Session> = {}): Session {
  return { id, time: { created: updated, updated }, location: { directory: "C:\\projects\\app" }, ...overrides }
}

test("generated IDs carry the redsun prefix and no dashes", () => {
  expect(newID("ses")).toMatch(/^ses_[a-f0-9]{32}$/)
  expect(newID("msg")).toMatch(/^msg_[a-f0-9]{32}$/)
})

test("retention keys are scoped to backend and session and validate their inputs", () => {
  expect(pendingPromptKey("host-a", "ses_a")).not.toBe(pendingPromptKey("host-b", "ses_a"))
  expect(pendingPromptKey("host-a", "ses_a")).not.toBe(pendingPromptKey("host-a", "ses_b"))
  expect(() => pendingPromptKey("", "ses_a")).toThrow()
  expect(() => pendingPromptKey("host", "../session")).toThrow()
  expect(() => creatingKey("")).toThrow()
  expect(creatingKey("host/a")).toContain("host%2Fa")
})

test("prompt reconciliation requires the exact ID in a loaded page", () => {
  expect(containsPrompt("msg_a", [[{ id: "msg_a" }], []])).toBe(true)
  expect(containsPrompt("msg_a", [[{ id: "msg_b", text: "msg_a" }], null, {}])).toBe(false)
})

test("retained prompts are decoded defensively", () => {
  const storage = new Map<string, string>()
  const read = (key: string) => readPending({ getItem: (name) => storage.get(name) ?? null }, key)
  expect(read("missing")).toBeUndefined()
  storage.set("broken", "{")
  expect(read("broken")).toBeUndefined()
  storage.set("partial", JSON.stringify({ id: "msg_a" }))
  expect(read("partial")).toBeUndefined()
  storage.set("ok", JSON.stringify({ id: "msg_a", text: "hi" }))
  expect(read("ok")).toEqual({ id: "msg_a", text: "hi" })
})

test("session titles fall back to the directory name and then the ID", () => {
  expect(sessionTitle(session("ses_a", 0, { title: " Fix bug " }))).toBe("Fix bug")
  expect(sessionTitle(session("ses_a", 0))).toBe("app")
  expect(sessionTitle(session("ses_a", 0, { location: { directory: "/" } }))).toBe("ses_a")
  expect(directoryName("/home/user/project/")).toBe("project")
})

test("relative time is compact", () => {
  const now = 1_000_000_000_000
  expect(relativeTime(now - 5_000, now)).toBe("now")
  expect(relativeTime(now - 5 * 60_000, now)).toBe("5m")
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h")
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d")
})

test("model labels include the variant", () => {
  expect(modelLabel(undefined)).toBe("Default model")
  expect(modelLabel({ id: "gpt", providerID: "openai" })).toBe("gpt")
  expect(modelLabel({ id: "gpt", providerID: "openai", variant: "fast" })).toBe("gpt fast")
})
