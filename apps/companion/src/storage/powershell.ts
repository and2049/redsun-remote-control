import { spawn } from "node:child_process"
import path from "node:path"
import helper from "./private-file.ps1" with { type: "text" }

const encoded = Buffer.from(helper, "utf16le").toString("base64")

export function spawnHelper(lock = false) {
  const root = process.env.SystemRoot ?? process.env.SYSTEMROOT
  if (!root || !path.isAbsolute(root)) return undefined
  return spawn(path.join(root, "System32/WindowsPowerShell/v1.0/powershell.exe"), [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded,
  ], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: lock ? { ...process.env, REDSUN_PRIVATE_FILE_LOCK: "1" } : process.env })
}
