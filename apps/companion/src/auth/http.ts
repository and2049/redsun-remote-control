import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server"
import { Effect, Schema } from "effect"
import type { Authentication } from "./service"
import { Sessions } from "./sessions"

const Token = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/))
const Encoded = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/), Schema.isMaxLength(65536))
const Transports = Schema.Array(Schema.Literals(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]))
const Common = {
  id: Encoded, rawId: Encoded, type: Schema.Literal("public-key"),
  authenticatorAttachment: Schema.optional(Schema.Literals(["platform", "cross-platform"])),
  clientExtensionResults: Schema.Record(Schema.String, Schema.Unknown),
}
const Registration = Schema.Struct({
  requestID: Token,
  response: Schema.Struct({
    ...Common,
    response: Schema.Struct({
      clientDataJSON: Encoded, attestationObject: Encoded,
      transports: Schema.optional(Transports),
      authenticatorData: Schema.optional(Encoded), publicKey: Schema.optional(Encoded),
      publicKeyAlgorithm: Schema.optional(Schema.Int),
    }),
  }),
})
const Login = Schema.Struct({
  ceremonyID: Token,
  response: Schema.Struct({
    ...Common,
    response: Schema.Struct({
      clientDataJSON: Encoded, authenticatorData: Encoded, signature: Encoded,
      userHandle: Schema.optional(Schema.NullOr(Encoded)),
    }),
  }),
})
export function emptyBody(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) throw new HttpError(400)
}
const bindingName = "__Host-redsun-binding"
const sessionName = "__Host-redsun-session"
export const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
}

export class HttpError extends Error {
  constructor(readonly status: number) { super("Request rejected") }
}

export function cookie(request: Request, name: string): string {
  const values = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`))
  if (values.length > 1) throw new HttpError(400)
  const value = values[0]?.slice(name.length + 1) ?? ""
  if (value && !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(400)
  return value
}

function setCookie(name: string, token: string, lifetime: number): string {
  return `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${lifetime}`
}

export async function json(request: Request, limit = 65536): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new HttpError(415)
  if (request.headers.has("content-encoding")) throw new HttpError(415)
  const length = request.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413)
  if (!request.body) throw new HttpError(400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const body = async () => {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > limit) throw new HttpError(413)
      chunks.push(chunk.value)
    }
    try {
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
      return value
    } catch { throw new HttpError(400) }
  }
  try {
    return await Promise.race([
      body(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HttpError(408)), 5000) }),
    ])
  } finally {
    clearTimeout(timer)
    void reader.cancel().catch(() => {})
  }
}

export function sameOrigin(request: Request, origin: string): void {
  const target = new URL(request.url)
  const host = new URL(origin).host
  if (target.host !== host || (request.headers.has("host") && request.headers.get("host") !== host) || request.headers.get("origin") !== origin || target.search ||
    (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) throw new HttpError(403)
  if ((request.headers.get("cookie")?.length ?? 0) > 8192) throw new HttpError(431)
}

function decode<S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown): S["Type"] {
  try { return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(value) }
  catch { throw new HttpError(400) }
}

export function makeAuthenticationHttp(auth: Authentication, origin: string, now: () => number = () => performance.now()) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const url = new URL(origin)
      if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Invalid authentication origin")
      const bindings = new Sessions(128, { absoluteLifetimeMs: 300_000, idleLifetimeMs: 300_000 }, now)
      let remaining = 30
      let refill = now()
      let closed = false
      const routes = new Set(["/auth/binding", "/auth/register/options", "/auth/register/verify", "/auth/login/options", "/auth/login/verify", "/auth/session", "/auth/logout"])

      async function handle(request: Request): Promise<Response> {
        try {
          const target = new URL(request.url)
          if (!routes.has(target.pathname)) throw new HttpError(404)
          if (request.method !== "POST") return new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } })
          if (closed) throw new HttpError(503)
          if (target.host !== url.host || (request.headers.has("host") && request.headers.get("host") !== url.host) || request.headers.get("origin") !== origin || target.search ||
            (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) throw new HttpError(403)
          if ((request.headers.get("cookie")?.length ?? 0) > 8192) throw new HttpError(431)
          const time = now()
          remaining = Math.min(30, remaining + Math.max(0, time - refill) / 2000)
          refill = time
          if (remaining < 1) return new Response(null, { status: 429, headers: { ...headers, "Retry-After": "2" } })
          remaining -= 1
          const body = await json(request)
          if (closed) throw new HttpError(503)
          const responseHeaders = new Headers(headers)
          if (target.pathname === "/auth/binding") {
            emptyBody(body)
            const old = cookie(request, bindingName)
            const token = bindings.authenticate(old) ? old : bindings.issue()
            responseHeaders.set("Set-Cookie", setCookie(bindingName, token, 300))
            return Response.json({ ready: true }, { headers: responseHeaders })
          }
          if (target.pathname === "/auth/session" || target.pathname === "/auth/logout") {
            emptyBody(body)
            const token = cookie(request, sessionName)
            await Effect.runPromise(auth.session(token))
            if (target.pathname === "/auth/logout") {
              await Effect.runPromise(auth.logout(token))
              responseHeaders.set("Set-Cookie", setCookie(sessionName, "", 0))
              return new Response(null, { status: 204, headers: responseHeaders })
            }
            return Response.json({ authenticated: true }, { headers: responseHeaders })
          }
          const binding = cookie(request, bindingName)
          if (!bindings.authenticate(binding)) throw new HttpError(401)
          if (target.pathname === "/auth/register/options") {
            emptyBody(body)
            return Response.json(await Effect.runPromise(auth.registrationOptions(binding)), { headers: responseHeaders })
          }
          if (target.pathname === "/auth/register/verify") {
            const value = decode(Registration, body)
            if (value.response.id !== value.response.rawId) throw new HttpError(400)
            const response: RegistrationResponseJSON = {
              id: value.response.id, rawId: value.response.rawId, type: "public-key", clientExtensionResults: {},
              response: {
                clientDataJSON: value.response.response.clientDataJSON,
                attestationObject: value.response.response.attestationObject,
                ...(value.response.response.transports === undefined ? {} : { transports: [...value.response.response.transports] }),
              },
            }
            return Response.json(await Effect.runPromise(auth.registration(binding, value.requestID, response)), { headers: responseHeaders })
          }
          if (target.pathname === "/auth/login/options") {
            emptyBody(body)
            return Response.json(await Effect.runPromise(auth.loginOptions(binding)), { headers: responseHeaders })
          }
          const value = decode(Login, body)
          if (value.response.id !== value.response.rawId) throw new HttpError(400)
          const response: AuthenticationResponseJSON = {
            id: value.response.id, rawId: value.response.rawId, type: "public-key", clientExtensionResults: {},
            response: {
              clientDataJSON: value.response.response.clientDataJSON,
              authenticatorData: value.response.response.authenticatorData,
              signature: value.response.response.signature,
              ...(value.response.response.userHandle == null ? {} : { userHandle: value.response.response.userHandle }),
            },
          }
          const previous = cookie(request, sessionName)
          const token = await Effect.runPromise(auth.login(binding, value.ceremonyID, response))
          if (closed || !bindings.authenticate(binding)) {
            await Effect.runPromise(auth.logout(token))
            throw new HttpError(401)
          }
          if (previous) await Effect.runPromise(auth.logout(previous))
          responseHeaders.set("Set-Cookie", setCookie(sessionName, token, 86400))
          return Response.json({ authenticated: true }, { headers: responseHeaders })
        } catch (error) {
          return new Response(null, { status: error instanceof HttpError ? error.status : 401, headers })
        }
      }

      return { handle, close: () => { closed = true; bindings.close() } }
    }),
    (http) => Effect.sync(() => http.close()),
  )
}
