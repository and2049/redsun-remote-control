import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { createPrivateFile, ensurePrivateDirectory, readPrivateFile, removePrivateFile, replacePrivateFile, StorageError } from "./private-file"

type Mutation = "create" | "replace" | "remove"
type Lease = {
  readonly signal: AbortSignal
  readonly close: () => Promise<void>
  readonly mutate: (action: Mutation, content?: Uint8Array) => Promise<void>
}

async function acquire(file: string): Promise<Lease> {
  const controller = new AbortController()
  if (process.platform === "linux") {
    await Effect.runPromise(readPrivateFile(file))
    const handle = await open(file, constants.O_RDWR | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new StorageError()
      await new Promise<void>((resolve, reject) => {
        const child = spawn("/usr/bin/flock", ["--nonblock", "3"], { stdio: ["ignore", "ignore", "ignore", handle.fd] })
        child.on("error", reject)
        child.on("close", (code) => code === 0 ? resolve() : reject(new StorageError()))
      })
      return {
        signal: controller.signal,
        close: async () => { controller.abort(); await handle.close() },
        mutate: async (action, content) => {
          if (controller.signal.aborted) throw new StorageError()
          const owner = path.join(path.dirname(file), "owner.json")
          await Effect.runPromise(action === "remove" ? removePrivateFile(owner) : action === "create"
            ? createPrivateFile(owner, content ?? new Uint8Array()) : replacePrivateFile(owner, content ?? new Uint8Array()))
        },
      }
    } catch (error) { await handle.close(); throw error }
  }
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT
  if (process.platform !== "win32" || !root || !path.isAbsolute(root)) throw new StorageError()
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, "System32/WindowsPowerShell/v1.0/powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      fileURLToPath(new URL("./private-file.ps1", import.meta.url)), "-Lock",
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] })
    let output = ""
    let ready = false
    let pending: { readonly resolve: () => void; readonly reject: () => void; readonly timer: ReturnType<typeof setTimeout> } | undefined
    const ended = new Promise<void>((done) => child.once("close", () => { controller.abort(); done() }))
    const timer = setTimeout(() => { child.kill(); reject(new StorageError()) }, 15_000)
    child.on("error", () => { clearTimeout(timer); reject(new StorageError()) })
    child.stdin.on("error", () => {})
    child.on("close", () => {
      clearTimeout(timer)
      if (pending) { clearTimeout(pending.timer); pending.reject(); pending = undefined }
      if (!ready) reject(new StorageError())
    })
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (!ready && (output === "locked\r\n" || output === "locked\n")) {
        ready = true
        output = ""
        clearTimeout(timer)
        resolve({
          signal: controller.signal,
          close: async () => { child.stdin.end(); await ended },
          mutate: (action, content) => new Promise<void>((complete, fail) => {
            if (pending || controller.signal.aborted || (content?.byteLength ?? 0) > 16384) { fail(new StorageError()); return }
            const timeout = setTimeout(() => { child.kill(); fail(new StorageError()) }, 15000)
            pending = { resolve: complete, reject: () => fail(new StorageError()), timer: timeout }
            child.stdin.write(JSON.stringify({ action, content: Buffer.from(content ?? []).toString("base64") }) + "\n")
          }),
        })
      } else if (ready && output.endsWith("\n")) {
        const operation = pending
        pending = undefined
        if (operation) {
          clearTimeout(operation.timer)
          if (output.trim() === "ok") operation.resolve()
          else operation.reject()
        } else child.kill()
        output = ""
      } else if (output.length > 16) { child.kill(); reject(new StorageError()) }
    })
    child.stdin.write(JSON.stringify({ action: "lock", path: file }) + "\n")
  })
}

export function acquireStore(directory: string) {
  return Effect.gen(function* () {
    yield* ensurePrivateDirectory(directory)
    const file = path.join(directory, "owner.lock")
    yield* createPrivateFile(file, Buffer.alloc(0)).pipe(Effect.ignore)
    return yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => acquire(file), catch: () => new StorageError() }),
      (lease) => Effect.promise(() => lease.close()),
    )
  })
}
