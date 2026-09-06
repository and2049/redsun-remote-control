import { expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { createPrivateFile, ensurePrivateDirectory, readPrivateFile } from "../../src/storage/private-file"

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/storage-" : "redsun-storage-"))
  const directory = path.join(root, "private")
  await Effect.runPromise(ensurePrivateDirectory(directory))
  return {
    root, directory,
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

test("creates protected files, reads bounded bytes, and refuses overwrite", async () => {
  await using data = await fixture()
  const file = path.join(data.directory, "credential.json")
  const content = Buffer.from('{"synthetic":"fixture"}')
  await Effect.runPromise(createPrivateFile(file, content))
  expect(await Effect.runPromise(readPrivateFile(file))).toEqual(content)
  await expect(Effect.runPromise(createPrivateFile(file, Buffer.from("replacement")))).rejects.toThrow("Protected local storage")
  expect(await readFile(file)).toEqual(content)
  expect(await readdir(data.directory)).toEqual(["credential.json"])
}, 15000)

test("does not repair or read files with nonprivate permissions", async () => {
  await using data = await fixture()
  const file = path.join(data.directory, "shared")
  await Effect.runPromise(createPrivateFile(file, Buffer.from("synthetic")))
  if (process.platform === "win32") {
    const child = Bun.spawn(["icacls.exe", file, "/grant", "*S-1-1-0:(R)"], { stdout: "ignore", stderr: "ignore" })
    expect(await child.exited).toBe(0)
  } else await chmod(file, 0o644)
  await expect(Effect.runPromise(readPrivateFile(file))).rejects.toThrow("Protected local storage")
}, 15000)

test("rejects oversized reads and writes without leaving temporary files", async () => {
  await using data = await fixture()
  const file = path.join(data.directory, "large")
  await expect(Effect.runPromise(createPrivateFile(file, Buffer.alloc(16385)))).rejects.toThrow()
  expect(await readdir(data.directory)).toEqual([])
  await Effect.runPromise(createPrivateFile(file, Buffer.alloc(16384)))
  expect((await Effect.runPromise(readPrivateFile(file))).length).toBe(16384)
  await writeFile(file, Buffer.alloc(16385))
  await expect(Effect.runPromise(readPrivateFile(file))).rejects.toThrow()
}, 15000)

test("rejects a linked directory in the path", async () => {
  await using data = await fixture()
  const file = path.join(data.directory, "credential")
  await Effect.runPromise(createPrivateFile(file, Buffer.from("synthetic")))
  const alias = path.join(data.root, "alias")
  await symlink(data.directory, alias, process.platform === "win32" ? "junction" : "dir")
  await expect(Effect.runPromise(readPrivateFile(path.join(alias, "credential")))).rejects.toThrow()
  await expect(Effect.runPromise(createPrivateFile(path.join(alias, "new"), Buffer.from("synthetic")))).rejects.toThrow()
}, 15000)

test("relative paths and missing files fail with fixed safe errors", async () => {
  await expect(Effect.runPromise(readPrivateFile("relative-secret"))).rejects.toThrow("Protected local storage operation failed")
  await expect(Effect.runPromise(ensurePrivateDirectory("relative-directory"))).rejects.toThrow()
})

test("concurrent creates admit only one complete value", async () => {
  await using data = await fixture()
  const file = path.join(data.directory, "winner")
  const results = await Promise.allSettled(["first", "second"].map((text) =>
    Effect.runPromise(createPrivateFile(file, Buffer.from(text))),
  ))
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  expect(["first", "second"]).toContain((await Effect.runPromise(readPrivateFile(file))).toString())
  expect(await readdir(data.directory)).toEqual(["winner"])
}, 15000)

test("refuses existing nonprivate directories rather than changing their permissions", async () => {
  await using data = await fixture()
  if (process.platform === "win32") {
    const child = Bun.spawn(["icacls.exe", data.directory, "/grant", "*S-1-1-0:(R)"], { stdout: "ignore", stderr: "ignore" })
    expect(await child.exited).toBe(0)
  } else await chmod(data.directory, 0o755)
  await expect(Effect.runPromise(ensurePrivateDirectory(data.directory))).rejects.toThrow()
  await expect(Effect.runPromise(createPrivateFile(path.join(data.directory, "new"), Buffer.from("synthetic")))).rejects.toThrow()
}, 15000)

test.skipIf(process.platform !== "win32")("rejects Windows device, network, alternate-stream and drive-relative paths", async () => {
  for (const file of ["C:\\con", "C:\\nul.json", "\\\\server\\share\\file", "C:\\private\\file:secret", "\\private\\file", "C:relative"]) {
    await expect(Effect.runPromise(readPrivateFile(file))).rejects.toThrow("Protected local storage")
  }
})
