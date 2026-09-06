import { expect, test } from "bun:test"
import { Challenges } from "../../src/auth/challenges"

test("challenges are browser-bound and single-use", () => {
  const store = new Challenges<string>(100, 2)
  const id = store.issue("browser-a", "challenge")
  expect(id).toMatch(/^[\w-]{43}$/)
  expect(() => store.take(id, "browser-b")).toThrow("Invalid challenge")
  expect(store.take(id, "browser-a")).toBe("challenge")
  expect(() => store.take(id, "browser-a")).toThrow("Invalid challenge")
})

test("expiry includes the deadline and frees bounded capacity", () => {
  let now = 0
  const store = new Challenges<string>(100, 1, () => now)
  const id = store.issue("browser", "first")
  expect(() => store.issue("browser", "second")).toThrow("capacity")
  now = 100
  expect(() => store.take(id, "browser")).toThrow("Invalid challenge")
  store.issue("browser", "second")
  now = 200
  expect(() => store.issue("browser", "third")).not.toThrow()
})

test("clear invalidates outstanding challenges", () => {
  const store = new Challenges<string>(100, 1)
  const id = store.issue("browser", "challenge")
  store.clear()
  expect(() => store.take(id, "browser")).toThrow()
})

test.each([0, -1, 0.5, NaN, Infinity])("rejects invalid limits: %s", (value) => {
  expect(() => new Challenges(value, 1)).toThrow()
  expect(() => new Challenges(1, value)).toThrow()
})

test("rejects a missing browser binding", () => {
  expect(() => new Challenges(100, 1).issue("", "challenge")).toThrow("binding")
})
