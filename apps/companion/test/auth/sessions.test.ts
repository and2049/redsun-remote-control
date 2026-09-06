import { expect, test } from "bun:test"
import { Effect } from "effect"
import { makeSessions, Sessions, sessionPolicy } from "../../src/auth/sessions"

test("uses approved session lifetimes", () => {
  expect(sessionPolicy).toEqual({ absoluteLifetimeMs: 86_400_000, idleLifetimeMs: 3_600_000 })
})

test("background authorization checks never extend idle expiry", () => {
  let now = 0
  const sessions = new Sessions(1, { absoluteLifetimeMs: 100, idleLifetimeMs: 40 }, () => now)
  try {
    const token = sessions.issue()
    const signal = sessions.authenticate(token, false)
    now = 39
    expect(sessions.authenticate(token, false)).toBe(signal)
    now = 40
    expect(sessions.authenticate(token, false)).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  } finally { sessions.close() }
})

test("issues independent opaque tokens and rejects unknown or malformed tokens", () => {
  const sessions = new Sessions(2)
  try {
    const first = sessions.issue()
    const second = sessions.issue()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
    expect(sessions.authenticate(first)?.aborted).toBe(false)
    for (const token of ["", "x", "a".repeat(43), "a".repeat(10000)]) {
      expect(sessions.authenticate(token)).toBeUndefined()
    }
    expect(() => sessions.issue()).toThrow("capacity")
  } finally { sessions.clear() }
})

test("activity extends idle expiry but never absolute expiry", () => {
  let now = 0
  const sessions = new Sessions(1, { absoluteLifetimeMs: 100, idleLifetimeMs: 40 }, () => now)
  try {
    const token = sessions.issue()
    const signal = sessions.authenticate(token)
    for (const time of [30, 60, 90, 99]) {
      now = time
      expect(sessions.authenticate(token)).toBe(signal)
    }
    now = 100
    expect(sessions.authenticate(token)).toBeUndefined()
    expect(signal?.aborted).toBe(true)
  } finally { sessions.clear() }
})

test("idle deadline expires inclusively and frees capacity", () => {
  let now = 0
  const sessions = new Sessions(1, { absoluteLifetimeMs: 100, idleLifetimeMs: 40 }, () => now)
  try {
    const token = sessions.issue()
    const signal = sessions.authenticate(token)
    now = 40
    const replacement = sessions.issue()
    expect(signal?.aborted).toBe(true)
    expect(sessions.authenticate(token)).toBeUndefined()
    expect(sessions.authenticate(replacement)?.aborted).toBe(false)
  } finally { sessions.clear() }
})

test("logout aborts only its session; global invalidation aborts all remaining sessions", () => {
  const sessions = new Sessions(2)
  const first = sessions.issue()
  const second = sessions.issue()
  const a = sessions.authenticate(first)
  const b = sessions.authenticate(second)
  sessions.revoke(first)
  expect(a?.aborted).toBe(true)
  expect(b?.aborted).toBe(false)
  expect(sessions.authenticate(first)).toBeUndefined()
  sessions.clear()
  expect(b?.aborted).toBe(true)
  expect(sessions.authenticate(second)).toBeUndefined()
  sessions.clear()
})

test("expires stream authorization without another request", async () => {
  const sessions = new Sessions(1, { absoluteLifetimeMs: 1000, idleLifetimeMs: 20 })
  try {
    const signal = sessions.authenticate(sessions.issue())
    expect(signal).toBeDefined()
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Session failed to expire")), 1000)
      signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve() }, { once: true })
    })
    expect(signal?.aborted).toBe(true)
  } finally { sessions.clear() }
})

test("new store cannot authenticate tokens from a previous process lifetime", () => {
  const old = new Sessions(1)
  const fresh = new Sessions(1)
  try { expect(fresh.authenticate(old.issue())).toBeUndefined() }
  finally { old.clear(); fresh.clear() }
})

test.each([0, -1, 1.5, NaN, Infinity])("rejects invalid capacity and lifetime: %s", (value) => {
  expect(() => new Sessions(value)).toThrow()
  expect(() => new Sessions(1, { absoluteLifetimeMs: value, idleLifetimeMs: 1 })).toThrow()
  expect(() => new Sessions(1, { absoluteLifetimeMs: 1, idleLifetimeMs: value })).toThrow()
})

test("policy mutations cannot extend a live store's configured lifetime", () => {
  let now = 0
  const policy = { absoluteLifetimeMs: 100, idleLifetimeMs: 40 }
  const sessions = new Sessions(1, policy, () => now)
  try {
    policy.idleLifetimeMs = 1000
    const token = sessions.issue()
    now = 40
    expect(sessions.authenticate(token)).toBeUndefined()
  } finally { sessions.clear() }
})

test("Effect scope release invalidates sessions and aborts stream signals", async () => {
  const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const sessions = yield* makeSessions(1)
    const token = sessions.issue()
    return { sessions, token, signal: sessions.authenticate(token) }
  })))
  expect(result.signal?.aborted).toBe(true)
  expect(result.sessions.authenticate(result.token)).toBeUndefined()
  expect(() => result.sessions.issue()).toThrow("closed")
})
