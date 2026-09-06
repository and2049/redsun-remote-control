import { expect, test } from "bun:test"
import { approveCommands, certificateReady, parseOptions, remoteStatus, serveState, tailnetHost } from "../script/phone-test-lib"

const status = { Self: { DNSName: "host.example.ts.net." }, CertDomains: ["host.example.ts.net"] }

test("tailnet host strips the trailing dot and requires a MagicDNS name", () => {
  expect(tailnetHost(status)).toBe("host.example.ts.net")
  expect(() => tailnetHost({ Self: { DNSName: "" } })).toThrow()
  expect(() => tailnetHost({ Self: { DNSName: "host" } })).toThrow()
  expect(() => tailnetHost({})).toThrow()
})

test("certificate readiness requires the host in CertDomains", () => {
  expect(certificateReady(status, "host.example.ts.net")).toBe(true)
  expect(certificateReady({ ...status, CertDomains: null }, "host.example.ts.net")).toBe(false)
  expect(certificateReady({ Self: status.Self }, "host.example.ts.net")).toBe(false)
})

test("serve state distinguishes missing, ready and conflicting mappings", () => {
  const host = "host.example.ts.net"
  const ready = { TCP: { "443": { HTTPS: true } }, Web: { [`${host}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:43123" } } } } }
  expect(serveState(undefined, host, 43123)).toBe("missing")
  expect(serveState({}, host, 43123)).toBe("missing")
  expect(serveState(ready, host, 43123)).toBe("ready")
  expect(serveState(ready, host, 43124)).toBe("conflict")
  expect(serveState({ Web: { [`${host}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:43123" }, "/other": { Proxy: "http://127.0.0.1:1" } } } } }, host, 43123)).toBe("conflict")
  expect(serveState({ Web: { [`${host}:8443`]: { Handlers: {} } } }, host, 43123)).toBe("conflict")
  expect(serveState({ TCP: { "10000": {} } }, host, 43123)).toBe("conflict")
})

test("remote status decodes only the policy fields it needs", () => {
  expect(remoteStatus('{"supported":true,"enabled":false,"enrolled":true,"version":1}')).toEqual({ supported: true, enabled: false, enrolled: true })
  expect(() => remoteStatus('{"supported":true}')).toThrow()
})

test("approve commands come only from non-empty pending lists", () => {
  expect(approveCommands("Enrollment open for five minutes.")).toBeUndefined()
  expect(approveCommands("[]")).toEqual([])
  expect(approveCommands("[not json")).toBeUndefined()
  expect(approveCommands('[{"requestID":"req","fingerprint":"abcd"}]')).toEqual(["approve req abcd"])
})

test("options accept only the two documented flags", () => {
  const defaults = { redsun: "C:/redsun", port: 43123 }
  expect(parseOptions([], defaults)).toEqual(defaults)
  expect(parseOptions(["--port", "50000", "--redsun", "/src/redsun"], defaults)).toEqual({ redsun: "/src/redsun", port: 50000 })
  expect(() => parseOptions(["--port", "0"], defaults)).toThrow()
  expect(() => parseOptions(["--origin", "https://x"], defaults)).toThrow()
  expect(() => parseOptions(["--redsun"], defaults)).toThrow()
})
