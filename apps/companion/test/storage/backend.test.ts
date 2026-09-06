import { expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Redacted } from "effect"
import { dataDirectory, importBackend, loadBackend } from "../../src/storage/backend"
import { createPrivateFile, ensurePrivateDirectory, readPrivateFile } from "../../src/storage/private-file"
import { handoff } from "../backend/fixture"

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/import-" : "redsun-import-"))
  const sourceDirectory = path.join(root, "source")
  await Effect.runPromise(ensurePrivateDirectory(sourceDirectory))
  const source = path.join(sourceDirectory, "handoff.json")
  const directory = path.join(root, "companion")
  return { root, source, directory, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

test("imports a protected handoff without overwriting or deleting its source", async () => {
  await using data = await fixture()
  const bytes = Buffer.from(JSON.stringify(handoff))
  await Effect.runPromise(createPrivateFile(data.source, bytes))
  expect(await Effect.runPromise(importBackend(data.source, data.directory))).toEqual({ backendID: handoff.backendID })
  expect(Redacted.value(await Effect.runPromise(loadBackend(data.directory)))).toEqual(handoff)
  expect(await Effect.runPromise(readPrivateFile(data.source))).toEqual(bytes)
  await expect(Effect.runPromise(importBackend(data.source, data.directory))).rejects.toThrow("Protected local storage")
  expect(await readdir(data.directory)).toEqual(["backend.json"])
}, 15000)

test.each(["not-json", JSON.stringify({ ...handoff, version: 2 }), JSON.stringify({ ...handoff, password: "synthetic" })])(
  "invalid handoffs fail before destination creation", async (text) => {
    await using data = await fixture()
    await Effect.runPromise(createPrivateFile(data.source, Buffer.from(text)))
    await expect(Effect.runPromise(importBackend(data.source, data.directory))).rejects.toThrow("Protected local storage")
    expect(await readdir(data.root)).toEqual(["source"])
  }, 15000,
)

test("resolves only absolute per-user data locations on supported hosts", () => {
  expect(dataDirectory("win32", { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" }, "unused")).toBe("C:\\Users\\fixture\\AppData\\Local\\redsun-remote-control")
  expect(dataDirectory("linux", {}, "/home/fixture")).toBe("/home/fixture/.local/share/redsun-remote-control")
  expect(dataDirectory("linux", { XDG_DATA_HOME: "/private/data" }, "/home/fixture")).toBe("/private/data/redsun-remote-control")
  expect(() => dataDirectory("linux", { XDG_DATA_HOME: "relative" }, "/home/fixture")).toThrow()
  expect(() => dataDirectory("win32", {}, "unused")).toThrow()
  expect(() => dataDirectory("win32", { LOCALAPPDATA: "\\\\server\\share" }, "unused")).toThrow()
  expect(() => dataDirectory("win32", { LOCALAPPDATA: "\\root-relative" }, "unused")).toThrow()
  expect(() => dataDirectory("darwin", {}, "/home/fixture")).toThrow()
})

test("CLI import exits without starting a listener and never prints credential data", async () => {
  await using data = await fixture()
  await Effect.runPromise(createPrivateFile(data.source, Buffer.from(JSON.stringify(handoff))))
  const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url))
  const run = async () => {
    const child = Bun.spawn([process.execPath, "run", cli, "import-backend", data.source], {
      env: { ...process.env, LOCALAPPDATA: data.root, XDG_DATA_HOME: data.root },
      stdout: "pipe", stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    expect(stdout + stderr).not.toContain(handoff.token)
    expect(stdout + stderr).not.toContain(data.source)
    expect(stdout + stderr).not.toContain("Foundation listener")
    return { code, stdout, stderr }
  }
  const result = await run()
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("Source preserved")
  expect((await run()).code).toBe(1)
  const directory = path.join(data.root, "redsun-remote-control")
  expect(Redacted.value(await Effect.runPromise(loadBackend(directory)))).toEqual(handoff)
}, 15000)
