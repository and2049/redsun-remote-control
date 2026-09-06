import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createInterface } from "node:readline"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { dataDirectory } from "../src/storage/backend"
import { approveCommands, certificateReady, parseOptions, remoteStatus, serveState, tailnetHost } from "./phone-test-lib"

const companion = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
const root = fileURLToPath(new URL("../../..", import.meta.url))
const options = parseOptions(process.argv.slice(2), { redsun: path.resolve(root, "..", "redsun"), port: 43123 })
const redsunCli = path.join(options.redsun, "packages", "cli")
const tailscale = Bun.which("tailscale") ?? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe")
const terminal = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })

type Result = { readonly code: number; readonly stdout: string; readonly stderr: string }

function run(command: string, args: readonly string[], cwd?: string): Result {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function step(label: string, result: Result): string {
  if (result.code !== 0) fail(`${label} failed.\n${result.stdout}${result.stderr}`)
  console.log(`ok: ${label}`)
  return result.stdout
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const redsun = (args: readonly string[]) => run(process.execPath, ["src/index.ts", ...args], redsunCli)
const companionCommand = (args: readonly string[]) => run(process.execPath, ["run", companion, ...args])

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => terminal.question(`${question} [y/N] `, (answer) => resolve(answer.trim().toLowerCase() === "y")))
}

const tailscaleStatus = parseJson(step("tailscale status", run(tailscale, ["status", "--json"])))
const host = tailnetHost(tailscaleStatus)
const origin = `https://${host}`
if (!certificateReady(tailscaleStatus, host)) {
  fail(`Tailscale HTTPS certificates are not enabled for this tailnet, so ${origin} cannot exist and passkeys cannot work.\nEnable "HTTPS Certificates" on the DNS page of the Tailscale admin console, wait until 'tailscale status --json' lists ${host} under CertDomains, then rerun.`)
}

const directory = dataDirectory()
const imported = existsSync(path.join(directory, "backend.json"))
const enrolled = existsSync(path.join(directory, "owner.json"))
const initial = redsun(["remote", "status"])
const supported = initial.code === 0 && remoteStatus(initial.stdout).supported
const serveNow = parseJson(run(tailscale, ["serve", "status", "--json"]).stdout)
const serve = serveState(serveNow, host, options.port)
if (serve === "conflict") fail(`Tailscale Serve already has an unrelated mapping. Inspect 'tailscale serve status' and resolve it manually; this script never resets Serve.`)

console.log(`\nThis run changes only this host. It will:`)
if (!supported) console.log(`  - restart the local source redsun service from ${redsunCli} (the running one lacks remote control)`)
if (!imported) console.log(`  - enroll a companion credential on that service and import the private handoff into ${directory}`)
console.log(`  - enable remote-control policy on that service if it is disabled`)
if (serve === "missing") console.log(`  - map ${origin} (Tailscale Serve, tailnet-only, never Funnel) to http://127.0.0.1:${options.port}`)
console.log(`  - start the companion diagnostic listener on loopback port ${options.port} and keep it in the foreground`)
if (!(await confirm("Proceed?"))) fail("Nothing was changed.")

if (!supported) {
  step("restart local source redsun service", redsun(["service", "restart"]))
  const restarted = redsun(["remote", "status"])
  if (restarted.code !== 0 || !remoteStatus(restarted.stdout).supported) fail("The restarted service still lacks remote control; check out the integration branch and rerun.")
}
if (!imported) {
  const handoff = path.join(tmpdir(), `redsun-handoff-${Date.now()}.json`)
  step("enroll companion credential", redsun(["remote", "enroll", "--handoff", handoff]))
  step("import handoff", companionCommand(["import-backend", handoff]))
  await unlink(handoff)
  console.log(`ok: temporary handoff removed; the imported copy lives in ${directory}`)
}
if (!remoteStatus(step("read remote status", redsun(["remote", "status"]))).enabled) step("enable remote control", redsun(["remote", "enable"]))
step("check-backend", companionCommand(["check-backend"]))
if (serve === "missing") {
  step("tailscale serve", run(tailscale, ["serve", "--bg", "--https=443", `http://127.0.0.1:${options.port}`]))
  const applied = parseJson(run(tailscale, ["serve", "status", "--json"]).stdout)
  if (serveState(applied, host, options.port) !== "ready") fail("Tailscale Serve did not report the expected mapping; inspect 'tailscale serve status'.")
}

const child = spawn(process.execPath, ["run", companion, "serve", "--origin", origin, "--port", String(options.port), "--backend"], { stdio: ["pipe", "pipe", "inherit"] })
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
  console.log(`\nPhone steps (Tailscale iOS app connected, VPN on):`)
  console.log(`  1. Open Safari at ${origin}`)
  if (enrolled) console.log(`  2. Already enrolled: tap "Log in", then "Connect / refresh".`)
  else {
    console.log(`  2. Tap "Register passkey". The request fingerprint is printed here automatically.`)
    console.log(`  3. Compare it with the phone, type the printed approve command here, then tap "Log in" and "Connect / refresh".`)
  }
  console.log(`Type "enroll" here to reopen the five-minute window. Ctrl+C stops the companion; 'tailscale serve reset' removes the mapping.\n`)
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
  console.log(`\nCompanion stopped. Remove the tailnet mapping with: tailscale serve reset`)
  process.exit(code ?? 0)
})
