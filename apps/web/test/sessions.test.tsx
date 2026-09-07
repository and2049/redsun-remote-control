import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { matchesSearch, sessionMeta, Sessions } from "../src/views/Sessions"
import type { Session } from "../src/types"

const now = 1_000_000_000_000
const sessions: Session[] = [
  { id: "ses_a", title: "Fix login", agent: "build", time: { created: now, updated: now - 60_000 }, location: { directory: "C:\\projects\\app" } },
  { id: "ses_b", time: { created: now, updated: now - 2 * 86_400_000 }, location: { directory: "/home/user/redsun" } },
]

test("session rows show a running dot and a time-first subline", () => {
  const html = renderToStaticMarkup(<Sessions sessions={sessions} active={{ ses_a: { type: "running" } }} selected="ses_a" connection={{ state: "connected", message: "Connected" }} onSelect={() => {}} onNew={() => {}} onMenu={() => {}} />)
  expect(html).toContain('class="dot running"')
  expect(html).toContain("Fix login")
  expect(html).toContain("redsun")
  expect(html).toContain('class="badge connected"')
  expect(html).toContain("New session")
  expect(html).toContain("Sessions")
  expect(sessionMeta(sessions[0]!, now)).toBe("1m · app · build")
  expect(sessionMeta(sessions[1]!, now)).toBe("2d · redsun")
})

test("search matches title, directory and agent case-insensitively", () => {
  expect(matchesSearch(sessions[0]!, "")).toBe(true)
  expect(matchesSearch(sessions[0]!, "LOGIN")).toBe(true)
  expect(matchesSearch(sessions[0]!, "projects")).toBe(true)
  expect(matchesSearch(sessions[0]!, "build")).toBe(true)
  expect(matchesSearch(sessions[1]!, "login")).toBe(false)
})
