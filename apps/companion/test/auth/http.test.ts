import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Schema } from "effect"
import { makeAuthentication, type Authentication } from "../../src/auth/service"
import { makeAuthenticationHttp } from "../../src/auth/http"
import { loadOwner } from "../../src/storage/owner"
import { localCommand } from "../../src/local"
import { authenticator } from "./authenticator"

const origin = "https://host.example.ts.net"
const run = Effect.runPromise
const Options = Schema.Struct({ requestID: Schema.String, options: Schema.Struct({ challenge: Schema.String, user: Schema.Struct({ id: Schema.String }) }) })
const LoginOptions = Schema.Struct({ ceremonyID: Schema.String, options: Schema.Struct({ challenge: Schema.String }) })
const Proof = Schema.Struct({ requestID: Schema.String, fingerprint: Schema.String })
type Http = Effect.Success<ReturnType<typeof makeAuthenticationHttp>>

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/auth-http-" : "redsun-auth-http-"))
  return { directory: path.join(root, "private"), [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

function post(http: Http, route: string, cookie = "", body: unknown = {}, extra: Record<string, string> = {}) {
  return http.handle(new Request(origin + route, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie, ...extra }, body: JSON.stringify(body),
  }))
}

function savedCookie(response: Response): string {
  const value = response.headers.get("set-cookie")
  expect(value).not.toBeNull()
  expect(value).toContain("Secure; HttpOnly; SameSite=Strict")
  return value?.split(";")[0] ?? ""
}

async function enrolled(auth: Authentication, http: Http) {
  await run(localCommand(auth, "enroll"))
  const binding = savedCookie(await post(http, "/auth/binding"))
  const options = Schema.decodeUnknownSync(Options)(await (await post(http, "/auth/register/options", binding)).json())
  const device = authenticator()
  const response = device.registration({ origin, challenge: options.options.challenge })
  const verification = await post(http, "/auth/register/verify", binding, { requestID: options.requestID, response })
  expect(verification.status).toBe(200)
  expect(verification.headers.get("set-cookie")).toBeNull()
  const proof = Schema.decodeUnknownSync(Proof)(await verification.json())
  expect(await run(localCommand(auth, "pending"))).toContain(proof.fingerprint)
  expect((await post(http, "/auth/session", binding)).status).toBe(401)
  await run(localCommand(auth, `approve ${proof.requestID} ${proof.fingerprint}`))
  return { binding, device, userID: options.options.user.id }
}

test("HTTP registration, local approval, durable login, logout, and recovery work without UI", async () => {
  await using data = await fixture()
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    yield* Effect.promise(async () => {
      const { binding, device, userID } = await enrolled(auth, http)
      const login = Schema.decodeUnknownSync(LoginOptions)(await (await post(http, "/auth/login/options", binding)).json())
      const signed = device.authentication({ origin, challenge: login.options.challenge, userHandle: userID, counter: 1 })
      const result = await post(http, "/auth/login/verify", binding, { ceremonyID: login.ceremonyID, response: signed })
      expect(result.status).toBe(200)
      const session = savedCookie(result)
      expect(await result.json()).toEqual({ authenticated: true })
      expect((await run(loadOwner(data.directory, origin))).passkey.credential.counter).toBe(1)
      expect((await post(http, "/auth/session", session)).status).toBe(200)
      expect((await post(http, "/auth/login/verify", binding, { ceremonyID: login.ceremonyID, response: signed })).status).toBe(401)
      const logout = await post(http, "/auth/logout", session)
      expect(logout.status).toBe(204)
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0")
      expect((await post(http, "/auth/session", session)).status).toBe(401)
      const again = Schema.decodeUnknownSync(LoginOptions)(await (await post(http, "/auth/login/options", binding)).json())
      const active = savedCookie(await post(http, "/auth/login/verify", binding, {
        ceremonyID: again.ceremonyID, response: device.authentication({ origin, challenge: again.options.challenge, counter: 2 }),
      }))
      const signal = await run(auth.session(active.slice(active.indexOf("=") + 1)))
      const pending = Schema.decodeUnknownSync(LoginOptions)(await (await post(http, "/auth/login/options", binding)).json())
      await run(localCommand(auth, "recover confirm"))
      expect(signal.aborted).toBe(true)
      expect((await post(http, "/auth/session", active)).status).toBe(401)
      const stale = device.authentication({ origin, challenge: pending.options.challenge, counter: 3 })
      expect((await post(http, "/auth/login/verify", binding, { ceremonyID: pending.ceremonyID, response: stale })).status).toBe(401)
      await run(localCommand(auth, "enroll"))
      expect((await post(http, "/auth/register/options", binding)).status).toBe(200)
    })
  })))
}, 25000)

test("recovery invalidates a login already in flight before issuing a session", async () => {
  await using data = await fixture()
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    yield* Effect.promise(async () => {
      const { binding, device } = await enrolled(auth, http)
      const token = binding.slice(binding.indexOf("=") + 1)
      const options = await run(auth.loginOptions(token))
      const pending = run(auth.login(token, options.ceremonyID, device.authentication({ origin, challenge: options.options.challenge, counter: 1 }))).then(() => "accepted", () => "rejected")
      await run(auth.local.recover)
      expect(await pending).toBe("rejected")
    })
  })))
}, 25000)

test("restart preserves credentials and counters but not browser sessions", async () => {
  await using data = await fixture()
  const prior = await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    return yield* Effect.promise(async () => {
      const { binding, device } = await enrolled(auth, http)
      const token = binding.slice(binding.indexOf("=") + 1)
      const options = await run(auth.loginOptions(token))
      const session = await run(auth.login(token, options.ceremonyID, device.authentication({ origin, challenge: options.options.challenge, counter: 1 })))
      return { device, session }
    })
  })))
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    yield* auth.session(prior.session).pipe(Effect.flip)
    yield* auth.local.open.pipe(Effect.flip)
    const options = yield* auth.loginOptions("new-server-binding")
    const token = yield* auth.login("new-server-binding", options.ceremonyID, prior.device.authentication({ origin, challenge: options.options.challenge, counter: 2 }))
    expect((yield* auth.session(token)).aborted).toBe(false)
    expect((yield* loadOwner(data.directory, origin)).passkey.credential.counter).toBe(2)
    yield* auth.disable
    yield* auth.session(token).pipe(Effect.flip)
    yield* auth.local.recover
    yield* auth.local.open.pipe(Effect.flip)
  })))
}, 25000)

test("HTTP trust boundaries reject CSRF, unapproved routes, malformed JSON, and duplicate cookies", async () => {
  await using data = await fixture()
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    yield* Effect.promise(async () => {
      expect((await post(http, "/auth/binding", "", {}, { Origin: "https://attacker.example" })).status).toBe(403)
      expect((await post(http, "/auth/binding", "", {}, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403)
      expect((await post(http, "/auth/binding", "", {}, { Host: "attacker.example" })).status).toBe(403)
      expect((await post(http, "/auth/binding", "", {}, { "Content-Type": "text/plain" })).status).toBe(415)
      expect((await post(http, "/auth/binding", "", { unexpected: true })).status).toBe(400)
      expect((await http.handle(new Request(origin + "/auth/binding", { method: "OPTIONS" }))).status).toBe(405)
      for (const route of ["/auth/approve", "/auth/recover", "/api/session", "/auth/binding?extra=1"]) {
        expect((await post(http, route)).status).toBe(route.includes("?") ? 403 : 404)
      }
      const binding = savedCookie(await post(http, "/auth/binding"))
      expect((await post(http, "/auth/register/options", `${binding}; ${binding}`)).status).toBe(400)
      expect((await post(http, "/auth/register/options", "__Host-redsun-binding=" + "a".repeat(43))).status).toBe(401)
      expect((await post(http, "/auth/binding", "", {}, { "Content-Length": "65537" })).status).toBe(413)
      const response = await http.handle(new Request(origin + "/auth/binding", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" }))
      expect(response.status).toBe(400)
      expect(response.headers.get("access-control-allow-origin")).toBeNull()
      expect(response.headers.get("cache-control")).toBe("no-store")
    })
  })))
}, 15000)

test("authentication rate limits are bounded and ignore attacker-selected proxy identities", async () => {
  await using data = await fixture()
  let now = 0
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin, () => now)
    yield* Effect.promise(async () => {
      for (let i = 0; i < 30; i += 1) expect((await post(http, "/auth/binding", "", { invalid: true }, { "X-Forwarded-For": String(i) })).status).toBe(400)
      const limited = await post(http, "/auth/binding")
      expect(limited.status).toBe(429)
      expect(limited.headers.get("retry-after")).toBe("2")
      now = 2000
      expect((await post(http, "/auth/binding")).status).toBe(200)
    })
  })))
}, 15000)

test("streamed request bodies are bounded and stalled bodies time out", async () => {
  await using data = await fixture()
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    yield* Effect.promise(async () => {
      const request = (body: ReadableStream<Uint8Array>) => new Request(origin + "/auth/binding", {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body,
      })
      expect((await http.handle(request(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); controller.close() } })))).status).toBe(413)
      let cancelled = false
      const slow = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
      expect((await http.handle(request(slow))).status).toBe(408)
      expect(cancelled).toBe(true)
    })
  })))
}, 15000)

test("corrupted owner state issues no cookie and blocks authentication until local recovery", async () => {
  await using data = await fixture()
  await run(Effect.scoped(Effect.gen(function* () {
    const auth = yield* makeAuthentication(data.directory, origin)
    const http = yield* makeAuthenticationHttp(auth, origin)
    yield* Effect.promise(async () => {
      const { binding, device } = await enrolled(auth, http)
      const options = Schema.decodeUnknownSync(LoginOptions)(await (await post(http, "/auth/login/options", binding)).json())
      await writeFile(path.join(data.directory, "owner.json"), "corrupted fixture")
      const result = await post(http, "/auth/login/verify", binding, { ceremonyID: options.ceremonyID, response: device.authentication({ origin, challenge: options.options.challenge, counter: 1 }) })
      expect(result.status).toBe(401)
      expect(result.headers.get("set-cookie")).toBeNull()
      await run(localCommand(auth, "recover confirm"))
      await run(localCommand(auth, "enroll"))
    })
  })))
}, 25000)
