import { expect, test } from "bun:test"
import { Effect } from "effect"
import { applyServe, inspectTailscale, serveCommand, type Runner } from "../src/tailscale"

const status = (certificate: boolean) => JSON.stringify({ Self: { DNSName: "host.tailnet.ts.net." }, CertDomains: certificate ? ["host.tailnet.ts.net"] : null })
const mapped = JSON.stringify({ Web: { "host.tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:43123" } } } } })
const foreign = JSON.stringify({ Web: { "host.tailnet.ts.net:443": { Handlers: { "/api": { Proxy: "http://127.0.0.1:9000" } } } } })

function fake(certificate: boolean, serve: () => string) {
  const calls: string[][] = []
  const runner: Runner = async (args) => {
    calls.push([...args])
    if (args[0] === "status") return status(certificate)
    if (args[0] === "serve" && args[1] === "status") return serve()
    if (args[0] === "serve") return ""
    throw new Error("unexpected")
  }
  return { runner, calls }
}

test("inspects the tailnet host, certificate and mapping without changing anything", async () => {
  const { runner, calls } = fake(true, () => "No serve config")
  expect(await Effect.runPromise(inspectTailscale(43123, runner))).toEqual({ host: "host.tailnet.ts.net", origin: "https://host.tailnet.ts.net", certificate: true, mapping: "missing" })
  expect(calls).toEqual([["status", "--json"], ["serve", "status", "--json"]])
  await expect(Effect.runPromise(inspectTailscale(43123, async () => "{}"))).rejects.toThrow()
  await expect(Effect.runPromise(inspectTailscale(0, runner))).rejects.toThrow("Invalid companion port")
})

test("applies the serve mapping once and reports the resulting state", async () => {
  let applied = false
  const { runner, calls } = fake(true, () => (applied ? mapped : "No serve config"))
  const original = runner
  const tracking: Runner = (args) => { if (args[0] === "serve" && args[1] === "--bg") applied = true; return original(args) }
  expect((await Effect.runPromise(applyServe(43123, tracking))).mapping).toBe("ready")
  expect(calls.filter((call) => call[1] === "--bg")).toEqual([["serve", "--bg", "--https=443", "http://127.0.0.1:43123"]])
  expect((await Effect.runPromise(applyServe(43123, tracking))).mapping).toBe("ready")
  expect(calls.filter((call) => call[1] === "--bg")).toHaveLength(1)
  expect(serveCommand(43123)).toBe("tailscale serve --bg --https=443 http://127.0.0.1:43123")
})

test("refuses to map over unrelated serve configuration or without certificates", async () => {
  const conflict = fake(true, () => foreign)
  await expect(Effect.runPromise(applyServe(43123, conflict.runner))).rejects.toThrow("unrelated mapping")
  const uncertified = fake(false, () => "No serve config")
  await expect(Effect.runPromise(applyServe(43123, uncertified.runner))).rejects.toThrow("HTTPS certificates")
  expect([...conflict.calls, ...uncertified.calls].some((call) => call[1] === "--bg")).toBe(false)
})
