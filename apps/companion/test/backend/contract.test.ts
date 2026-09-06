import { expect, test } from "bun:test"
import { Redacted } from "effect"
import { decodeHandoff, decodeRegistration, decodeStatus } from "../../src/backend/contract"
import { loopbackEndpoint } from "../../src/backend/transport"

import { handoff, status } from "./fixture"

test("decodes a handoff into a redacted value", () => {
  const value = decodeHandoff(handoff)
  expect(Redacted.value(value)).toEqual(handoff)
  expect(String(value)).not.toContain(handoff.token)
  expect(JSON.stringify(value)).not.toContain(handoff.token)
})

test.each([
  { version: 2 }, { registration: "relative.remote" }, { credentialID: "invalid" },
  { token: "short" }, { backendID: "" }, { extra: true },
])("rejects invalid handoff fields without leaking secrets: %j", (override) => {
  expect(() => decodeHandoff({ ...handoff, ...override })).toThrow("invalid-contract")
  try {
    decodeHandoff({ ...handoff, ...override })
  } catch (error) {
    expect(String(error)).not.toContain(handoff.token)
  }
})

test("rejects unrestricted registration files and unknown status fields", () => {
  expect(() => decodeRegistration({ id: "id", version: "1", url: "http://localhost", pid: 1, password: "secret" })).toThrow()
  expect(() => decodeStatus({ ...status, secret: "unexpected" })).toThrow()
  expect(() => decodeStatus({ ...status, version: 2 })).toThrow()
  expect(() => decodeStatus({ ...status, leaseSeconds: 90 })).toThrow()
})

test.each(["http://127.0.0.1:1234", "http://127.0.0.2:1234/", "http://[::1]:1234"])(
  "accepts literal loopback: %s", (url) => expect(loopbackEndpoint(url).protocol).toBe("http:"),
)

test("resolves localhost without trusting DNS", () => {
  expect(loopbackEndpoint("http://localhost:1234").hostname).toBe("127.0.0.1")
})

test.each([
  "https://127.0.0.1", "http://0.0.0.0", "http://192.168.1.2", "http://100.64.0.1",
  "http://example.com", "http://localhost.example.com", "http://[::]", "http://[::ffff:127.0.0.1]",
  "http://user:password@127.0.0.1", "http://127.0.0.1/api", "http://127.0.0.1?",
  "http://127.0.0.1#", "file:///secret", "not a URL",
])("rejects nonlocal or decorated endpoints: %s", (url) => {
  expect(() => loopbackEndpoint(url)).toThrow("invalid-endpoint")
})
