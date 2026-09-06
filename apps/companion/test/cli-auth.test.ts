import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import { authenticator } from "./auth/authenticator"

test("authenticated CLI accepts local approval/recovery and releases its writer lease after process death", async () => {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/cli-auth-" : "redsun-cli-auth-"))
  const reserve = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = reserve.port
  await reserve.stop(true)
  const origin = "https://host.example.ts.net"
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
  const env = { ...process.env, LOCALAPPDATA: root, XDG_DATA_HOME: root }
  const child = spawn(process.execPath, ["run", cli, "serve", "--origin", origin, "--port", String(port)], { env, stdio: ["pipe", "pipe", "pipe"] })
  let output = ""
  const ended = new Promise<void>((resolve) => child.once("close", () => resolve()))
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
  const wait = (text: string) => new Promise<void>((resolve, reject) => {
    const finish = () => { clearTimeout(timer); child.stdout.off("data", check); child.off("close", closed) }
    const check = () => { if (output.includes(text)) { finish(); resolve() } }
    const closed = () => { finish(); reject(new Error("CLI exited before expected output")) }
    const timer = setTimeout(() => { finish(); reject(new Error("CLI output timed out")) }, 10000)
    child.stdout.on("data", check)
    child.once("close", closed)
    check()
  })
  const post = (route: string, cookie = "", body: unknown = {}) => fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST", headers: { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
  })
  const offline = async () => {
    const recovery = Bun.spawn([process.execPath, "run", cli, "recover", "--confirm"], { env, stdout: "pipe", stderr: "pipe" })
    const [code, stdout, stderr] = await Promise.all([recovery.exited, new Response(recovery.stdout).text(), new Response(recovery.stderr).text()])
    return { code, stdout, stderr }
  }
  try {
    await wait("Local commands:")
    child.stdin.write("enroll\n")
    await wait("Enrollment open")
    const binding = (await post("/auth/binding")).headers.get("set-cookie")?.split(";")[0] ?? ""
    const options = Schema.decodeUnknownSync(Schema.Struct({ requestID: Schema.String, options: Schema.Struct({ challenge: Schema.String }) }))(
      await (await post("/auth/register/options", binding)).json(),
    )
    const device = authenticator()
    const proof = Schema.decodeUnknownSync(Schema.Struct({ requestID: Schema.String, fingerprint: Schema.String }))(
      await (await post("/auth/register/verify", binding, { requestID: options.requestID, response: device.registration({ origin, challenge: options.options.challenge }) })).json(),
    )
    child.stdin.write(`approve ${proof.requestID} ${proof.fingerprint}\n`)
    await wait("Owner enrollment persisted")
    const login = Schema.decodeUnknownSync(Schema.Struct({ ceremonyID: Schema.String, options: Schema.Struct({ challenge: Schema.String }) }))(
      await (await post("/auth/login/options", binding)).json(),
    )
    const loggedIn = await post("/auth/login/verify", binding, { ceremonyID: login.ceremonyID, response: device.authentication({ origin, challenge: login.options.challenge, counter: 1 }) })
    expect(loggedIn.status).toBe(200)
    const cookie = loggedIn.headers.get("set-cookie")?.split(";")[0] ?? ""
    expect((await post("/auth/session", cookie)).status).toBe(200)
    expect((await offline()).code).toBe(1)
    child.stdin.write("recover confirm\n")
    await wait("sessions revoked")
    expect((await post("/auth/session", cookie)).status).toBe(401)
    expect(output).not.toContain(cookie)
    child.kill("SIGKILL")
    await ended
    expect((await offline()).code).toBe(0)
  } finally {
    child.kill("SIGKILL")
    await ended
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
