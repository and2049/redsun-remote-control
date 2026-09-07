import { spawn } from "node:child_process"
import path from "node:path"
import { Effect, Schema } from "effect"

const TailscaleStatus = Schema.Struct({
  Self: Schema.Struct({ DNSName: Schema.String }),
  CertDomains: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

const ServeConfig = Schema.Struct({
  TCP: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
  Web: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Struct({
    Handlers: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.optional(Schema.String) })))),
  })))),
})

export type Mapping = "missing" | "ready" | "conflict"
export type Tailscale = { readonly host: string; readonly origin: string; readonly certificate: boolean; readonly mapping: Mapping }
export type Runner = (args: readonly string[]) => Promise<string>

export function tailnetHost(status: unknown): string {
  const decoded = Schema.decodeUnknownSync(TailscaleStatus)(status)
  const host = decoded.Self.DNSName.replace(/\.$/, "")
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) throw new Error("Tailscale did not report a MagicDNS name for this host")
  return host
}

export function certificateReady(status: unknown, host: string): boolean {
  const decoded = Schema.decodeUnknownSync(TailscaleStatus)(status)
  return (decoded.CertDomains ?? []).includes(host)
}

export function serveState(config: unknown, host: string, port: number): Mapping {
  if (config === null || typeof config !== "object") return "missing"
  const decoded = Schema.decodeUnknownSync(ServeConfig)(config)
  const web = decoded.Web ?? {}
  const site = web[`${host}:443`]
  if (site) {
    const handlers = site.Handlers ?? {}
    const only = Object.keys(handlers).length === 1 && handlers["/"]?.Proxy === `http://127.0.0.1:${port}`
    return only ? "ready" : "conflict"
  }
  const occupied = Object.keys(web).length > 0 || Object.keys(decoded.TCP ?? {}).length > 0
  return occupied ? "conflict" : "missing"
}

function validPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid companion port")
  return port
}

export const serveCommand = (port: number) => `tailscale serve --bg --https=443 http://127.0.0.1:${validPort(port)}`

const binary = () => Bun.which("tailscale") ?? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe")

const run: Runner = (args) => new Promise((resolve, reject) => {
  const child = spawn(binary(), [...args], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
  const chunks: Buffer[] = []
  let size = 0
  const timer = setTimeout(() => { child.kill(); reject(new Error("Tailscale did not respond")) }, 15_000)
  child.on("error", () => { clearTimeout(timer); reject(new Error("Tailscale CLI is not installed")) })
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length
    if (size > 1024 * 1024) { child.kill(); reject(new Error("Tailscale output too large")); return }
    chunks.push(chunk)
  })
  child.on("close", (code) => {
    clearTimeout(timer)
    if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"))
    else reject(new Error(`tailscale ${args[0] ?? ""} failed`))
  })
})

const json = (text: string): unknown => { try { return JSON.parse(text) } catch { return null } }

export function inspectTailscale(port: number, runner: Runner = run) {
  return Effect.tryPromise({
    try: async () => {
      validPort(port)
      const status = json(await runner(["status", "--json"]))
      const host = tailnetHost(status)
      const serve = await runner(["serve", "status", "--json"]).then(json, () => null)
      return { host, origin: `https://${host}`, certificate: certificateReady(status, host), mapping: serveState(serve, host, port) } satisfies Tailscale
    },
    catch: (error) => (error instanceof Error ? error : new Error("Tailscale status is unavailable")),
  })
}

export function applyServe(port: number, runner: Runner = run) {
  return inspectTailscale(port, runner).pipe(Effect.flatMap((state) => {
    if (state.mapping === "ready") return Effect.succeed(state)
    if (state.mapping === "conflict") return Effect.fail(new Error("Tailscale Serve already has an unrelated mapping; inspect tailscale serve status and resolve it manually"))
    if (!state.certificate) return Effect.fail(new Error("Enable HTTPS certificates for the tailnet in the Tailscale admin console before mapping"))
    return Effect.tryPromise({
      try: () => runner(["serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]),
      catch: () => new Error("tailscale serve failed; run it manually to see the reason"),
    }).pipe(Effect.andThen(inspectTailscale(port, runner)))
  }))
}
