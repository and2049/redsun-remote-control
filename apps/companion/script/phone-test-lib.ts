import { Schema } from "effect"

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

const PendingRequests = Schema.Array(Schema.Struct({ requestID: Schema.String, fingerprint: Schema.String }))

const RemoteStatus = Schema.Struct({ supported: Schema.Boolean, enabled: Schema.Boolean, enrolled: Schema.Boolean })

export type Options = { readonly redsun: string; readonly port: number }

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

export function serveState(config: unknown, host: string, port: number): "missing" | "ready" | "conflict" {
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

export function remoteStatus(text: string): { readonly supported: boolean; readonly enabled: boolean; readonly enrolled: boolean } {
  return Schema.decodeUnknownSync(RemoteStatus)(JSON.parse(text))
}

export function approveCommands(line: string): readonly string[] | undefined {
  if (!line.startsWith("[")) return undefined
  try {
    const pending = Schema.decodeUnknownSync(PendingRequests)(JSON.parse(line))
    return pending.map((request) => `approve ${request.requestID} ${request.fingerprint}`)
  } catch {
    return undefined
  }
}

export function parseOptions(args: readonly string[], defaults: Options): Options {
  let options = defaults
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag === "--redsun" && value) options = { ...options, redsun: value }
    else if (flag === "--port" && value && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) options = { ...options, port: Number(value) }
    else throw new Error("Usage: phone-test [--redsun <checkout>] [--port <loopback-port>]")
  }
  return options
}
