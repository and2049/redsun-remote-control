import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Redacted } from "effect"
import { importHandoff, serveCompanion } from "../src/companion"
import { main } from "../src/main"
import { loadBackend } from "../src/storage/backend"
import { handoff } from "./backend/fixture"

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/embed-" : "redsun-embed-"))
  return { root, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

function capture(stream: "log" | "error", run: () => Promise<number>) {
  const lines: string[] = []
  const original = console[stream]
  console[stream] = (line: unknown) => { lines.push(String(line)) }
  return run().finally(() => { console[stream] = original }).then((code) => ({ code, lines }))
}

test("in-process handoff import validates, persists once and never overwrites", async () => {
  await using data = await fixture()
  const directory = path.join(data.root, "companion")
  expect(await Effect.runPromise(importHandoff(handoff, directory))).toEqual({ backendID: handoff.backendID })
  expect(Redacted.value(await Effect.runPromise(loadBackend(directory)))).toEqual(handoff)
  await expect(Effect.runPromise(importHandoff({ ...handoff, token: "replacement" }, directory))).rejects.toThrow("Protected local storage")
  expect(Redacted.value(await Effect.runPromise(loadBackend(directory)))).toEqual(handoff)
  await expect(Effect.runPromise(importHandoff({ ...handoff, version: 2 }, path.join(data.root, "other")))).rejects.toThrow("Protected local storage")
  expect(await readdir(data.root)).toEqual(["companion"])
}, 15000)

test("programmatic serve rejects invalid configuration before touching storage", async () => {
  await using data = await fixture()
  for (const options of [
    { origin: "http://host.example", port: 43123 },
    { origin: "https://host.example/path", port: 43123 },
    { origin: "https://host.example", port: 0 },
    { origin: "https://host.example", port: 1.5 },
  ]) {
    const directory = path.join(data.root, "companion")
    await expect(Effect.runPromise(Effect.scoped(serveCompanion({ ...options, directory })))).rejects.toThrow("Usage")
  }
  expect(await readdir(data.root)).toEqual([])
})

test("embedded main reports usage under the host command name and fails closed on bad arguments", async () => {
  const signal = new AbortController().signal
  const help = await capture("log", () => main(["--help"], { signal, name: "redsun remote companion" }))
  expect(help.code).toBe(0)
  expect(help.lines[0]).toStartWith("Usage: redsun remote companion ")
  expect(help.lines.join("\n")).toContain("redsun remote companion serve --origin")
  const failure = await capture("error", () => main(["serve", "--origin", "http://host.example", "--port", "1"], { signal }))
  expect(failure.code).toBe(1)
  expect(failure.lines).toEqual(["Companion command failed. Check arguments, private file permissions, and whether an import already exists. Use --help for usage."])
})
