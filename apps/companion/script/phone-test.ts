import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createInterface } from "node:readline"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dataDirectory } from "../src/storage/backend"
import { approveCommands, parseOptions } from "./phone-test-lib"

const companion = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const options = parseOptions(process.argv.slice(2))
const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })

const check = spawnSync(process.execPath, ["run", companion, "check-backend"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
if (check.status !== 0) {
  console.error(`check-backend failed.\n${check.stdout ?? ""}${check.stderr ?? ""}`)
  process.exit(1)
}
console.log("ok: check-backend")

const enrolled = existsSync(path.join(dataDirectory(), "owner.json"))
const child = spawn(process.execPath, ["run", companion, "serve", "--origin", options.origin, "--port", String(options.port), "--backend"], { stdio: ["pipe", "pipe", "inherit"] })
const send = (line: string) => child.stdin.write(`${line}\n`)
let polling: ReturnType<typeof setInterval> | undefined
const stopPolling = () => {
  if (polling) clearInterval(polling)
  polling = undefined
}
const openEnrollment = () => {
  send("enroll")
  stopPolling()
  polling = setInterval(() => send("pending"), 3000)
  setTimeout(stopPolling, 5 * 60_000)
}
const phoneSteps = () => {
  console.log("\nPhone steps (after the host's HTTPS route is ready):")
  console.log(`  1. Open Safari at ${options.origin}/diagnostic`)
  if (enrolled) console.log('  2. Already enrolled: tap "Log in", then "Connect / refresh".')
  else {
    console.log('  2. Tap "Register passkey". The request fingerprint is printed here automatically.')
    console.log('  3. Compare it with the phone, type the printed approve command here, then tap "Log in" and "Connect / refresh".')
  }
  console.log('Type "enroll" here to reopen the five-minute window. Ctrl+C stops the companion.\n')
}

createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
  const approvals = approveCommands(line)
  if (approvals !== undefined) {
    if (approvals.length === 0) return
    stopPolling()
    console.log(`\nPending enrollment. Compare the full fingerprint on the phone, then type exactly one of:\n  ${approvals.join("\n  ")}\n`)
    return
  }
  console.log(line)
  if (line.startsWith("Local commands:")) {
    phoneSteps()
    if (!enrolled) openEnrollment()
  }
  if (line.startsWith("Owner enrollment persisted")) stopPolling()
})
terminal.on("line", (line) => (line.trim() === "enroll" ? openEnrollment() : send(line)))
process.on("SIGINT", () => setTimeout(() => child.kill(), 5000).unref())
child.on("close", (code) => {
  stopPolling()
  terminal.close()
  console.log("\nCompanion stopped.")
  process.exit(code ?? 0)
})
