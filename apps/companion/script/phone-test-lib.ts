import { Schema } from "effect"
export { certificateReady, serveState, tailnetHost } from "../src/tailscale"

const PendingRequests = Schema.Array(Schema.Struct({ requestID: Schema.String, fingerprint: Schema.String }))

const RemoteStatus = Schema.Struct({ supported: Schema.Boolean, enabled: Schema.Boolean, enrolled: Schema.Boolean })

export type Options = { readonly redsun: string; readonly port: number }

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
