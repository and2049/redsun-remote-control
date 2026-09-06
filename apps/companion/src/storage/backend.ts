import path from "node:path"
import { homedir } from "node:os"
import { Effect, Redacted } from "effect"
import { decodeHandoff } from "../backend/contract"
import { createPrivateFile, ensurePrivateDirectory, readPrivateFile, StorageError } from "./private-file"

export function dataDirectory(
  platform: string = process.platform,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const base = environment.LOCALAPPDATA
    if (!base || !/^[A-Za-z]:[\\/]/.test(base) || base.slice(2).includes(":")) throw new StorageError()
    return path.win32.join(base, "redsun-remote-control")
  }
  if (platform === "linux") {
    const base = environment.XDG_DATA_HOME || path.posix.join(home, ".local", "share")
    if (!path.posix.isAbsolute(base)) throw new StorageError()
    return path.posix.join(base, "redsun-remote-control")
  }
  throw new StorageError()
}

function decode(bytes: Uint8Array) {
  return Effect.try({
    try: () => {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      return decodeHandoff(value)
    },
    catch: () => new StorageError(),
  })
}

export function loadBackend(directory: string) {
  return readPrivateFile(path.join(directory, "backend.json")).pipe(Effect.flatMap(decode))
}

export function importBackend(source: string, directory: string) {
  return Effect.gen(function* () {
    const bytes = yield* readPrivateFile(source)
    const enrollment = yield* decode(bytes)
    yield* ensurePrivateDirectory(directory)
    const handoff = Redacted.value(enrollment)
    yield* createPrivateFile(path.join(directory, "backend.json"), Buffer.from(JSON.stringify(handoff)))
    return { backendID: handoff.backendID }
  }).pipe(Effect.uninterruptible)
}
