import { Schema } from "effect"
import { validateServe } from "../src/command"

const PendingRequests = Schema.Array(Schema.Struct({ requestID: Schema.String, fingerprint: Schema.String }))

export type Options = { readonly origin: string; readonly port: number }

export function approveCommands(line: string): readonly string[] | undefined {
  if (!line.startsWith("[")) return undefined
  try {
    const pending = Schema.decodeUnknownSync(PendingRequests)(JSON.parse(line))
    return pending.map((request) => `approve ${request.requestID} ${request.fingerprint}`)
  } catch {
    return undefined
  }
}

export function parseOptions(args: readonly string[]): Options {
  let origin: string | undefined
  let port = 43123
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag === "--origin" && value && origin === undefined) origin = value
    else if (flag === "--port" && value && /^\d+$/.test(value)) port = Number(value)
    else throw new Error("Usage: phone-test --origin <https-origin> [--port <loopback-port>]")
  }
  if (!origin) throw new Error("Usage: phone-test --origin <https-origin> [--port <loopback-port>]")
  try {
    return validateServe(origin, port)
  } catch {
    throw new Error("Usage: phone-test --origin <https-origin> [--port <loopback-port>]")
  }
}
