import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { link, lstat, mkdir, open, unlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"

export class StorageError extends Error {
  constructor() {
    super("Protected local storage operation failed")
    this.name = "StorageError"
  }
}

const limit = 16 * 1024

function windows(action: string, file: string, content?: string): Promise<Buffer> {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT
  if (!root || !path.isAbsolute(root)) return Promise.reject(new StorageError())
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(root, "System32/WindowsPowerShell/v1.0/powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", fileURLToPath(new URL("./private-file.ps1", import.meta.url)),
    ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] })
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => { child.kill(); reject(new StorageError()) }, 15_000)
    child.on("error", () => { clearTimeout(timer); reject(new StorageError()) })
    child.stdin.on("error", () => {})
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > 32 * 1024) { child.kill(); reject(new StorageError()); return }
      chunks.push(chunk)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0 || size > 32 * 1024) reject(new StorageError())
      else resolve(Buffer.from(Buffer.concat(chunks).toString("utf8"), "base64"))
    })
    child.stdin.end(JSON.stringify({ action, path: file, limit, content }))
  })
}

async function localPath(file: string): Promise<void> {
  if (!path.isAbsolute(file) || file.includes("\0")) throw new StorageError()
  if (process.platform !== "linux" && process.platform !== "win32") throw new StorageError()
  if (process.platform === "win32") {
    if (!/^[A-Za-z]:[\\/]/.test(file) || file.slice(2).includes(":")) throw new StorageError()
    if (/(^|[\\/])(con|prn|aux|nul|com[1-9]|lpt[1-9])([.\\/]|$)/i.test(file)) throw new StorageError()
    return
  }
  let current = file
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new StorageError()
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function privateDirectory(directory: string): Promise<void> {
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new StorageError()
}

export function ensurePrivateDirectory(directory: string) {
  return Effect.tryPromise({
    try: async () => {
      await localPath(directory)
      if (process.platform === "win32") { await windows("directory", directory); return }
      try { await mkdir(directory, { mode: 0o700 }) }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
      }
      await privateDirectory(directory)
    },
    catch: () => new StorageError(),
  }).pipe(Effect.uninterruptible)
}

export function readPrivateFile(file: string) {
  return Effect.tryPromise({
    try: async () => {
      await localPath(file)
      if (process.platform === "win32") return windows("read", file)
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > limit) throw new StorageError()
        const buffer = Buffer.alloc(limit + 1)
        let size = 0
        while (size < buffer.length) {
          const result = await handle.read(buffer, size, buffer.length - size, null)
          if (!result.bytesRead) break
          size += result.bytesRead
        }
        if (size > limit) throw new StorageError()
        return buffer.subarray(0, size)
      } finally { await handle.close() }
    },
    catch: () => new StorageError(),
  })
}

export function createPrivateFile(file: string, content: Uint8Array) {
  const bytes = Buffer.from(content)
  return Effect.tryPromise({
    try: async () => {
      if (bytes.length > limit) throw new StorageError()
      await localPath(file)
      if (process.platform === "win32") { await windows("create", file, bytes.toString("base64")); return }
      const parent = path.dirname(file)
      await privateDirectory(parent)
      const temporary = path.join(parent, `${randomUUID()}.tmp`)
      const handle = await open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(bytes)
        await handle.sync()
        await handle.close()
        await link(temporary, file)
      } finally { await handle.close(); await unlink(temporary) }
      const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY)
      try { await directory.sync() } finally { await directory.close() }
    },
    catch: () => new StorageError(),
  }).pipe(Effect.uninterruptible)
}
