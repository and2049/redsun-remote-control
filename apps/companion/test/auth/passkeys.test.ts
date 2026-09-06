import { expect, test } from "bun:test"
import { Effect } from "effect"
import { makePasskeys } from "../../src/auth/passkeys"
import { authenticator } from "./authenticator"

const origin = "https://host.example.ts.net"
const config = { origin, challengeLifetimeMs: 60_000, challengeCapacity: 4 }
const userID = new Uint8Array([1, 2, 3, 4])
const run = Effect.runPromise

async function registered(algorithm: "ES256" | "RS256" | "Ed25519" = "ES256") {
  const service = makePasskeys(config)
  const device = authenticator(algorithm)
  const ceremony = await run(service.registrationOptions("browser", userID))
  const response = device.registration({ origin, challenge: ceremony.options.challenge })
  const passkey = await run(service.verifyRegistration("browser", ceremony.ceremonyID, response))
  return { service, device, passkey }
}

test.each([
  "http://host.example.ts.net", "https://host.example.ts.net/", "https://host.example.ts.net/path",
  "https://user:secret@host.example.ts.net", "https://host.example.ts.net?query", "not a URL",
])("rejects an invalid configured origin: %s", (origin) => {
  expect(() => makePasskeys({ ...config, origin })).toThrow()
})

test("generates options requiring verification without forcing a platform authenticator", async () => {
  const service = makePasskeys(config)
  const { options } = await run(service.registrationOptions("browser", userID))
  expect(options.rp.id).toBe("host.example.ts.net")
  expect(options.authenticatorSelection?.userVerification).toBe("required")
  expect(options.authenticatorSelection?.authenticatorAttachment).toBeUndefined()
  expect(options.attestation).toBe("none")
})

test.each(["ES256", "RS256", "Ed25519"] as const)("verifies registration and signed %s authentication on Bun", async (algorithm) => {
  const { service, device, passkey } = await registered(algorithm)
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  expect(ceremony.options.userVerification).toBe("required")
  const response = device.authentication({ origin, challenge: ceremony.options.challenge, counter: 1 })
  const updated = await run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))
  expect(updated.credential.counter).toBe(1)
  expect(updated.userID).toBe(passkey.userID)
  expect(passkey.credential.counter).toBe(0)
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, updated))).rejects.toThrow()
})

test.each([
  { origin: "https://attacker.example" },
  { challenge: "wrong" },
  { rpID: "attacker.example" },
  { flags: 1 },
  { flags: 4 },
  { crossOrigin: true },
])("rejects invalid registration properties: %j", async (override) => {
  const service = makePasskeys(config)
  const device = authenticator()
  const ceremony = await run(service.registrationOptions("browser", userID))
  const response = device.registration({ origin, challenge: ceremony.options.challenge, ...override })
  await expect(run(service.verifyRegistration("browser", ceremony.ceremonyID, response))).rejects.toThrow("Passkey ceremony failed")
  const valid = device.registration({ origin, challenge: ceremony.options.challenge })
  await expect(run(service.verifyRegistration("browser", ceremony.ceremonyID, valid))).rejects.toThrow()
})

test.each([
  { origin: "https://attacker.example" },
  { challenge: "wrong" },
  { rpID: "attacker.example" },
  { flags: 1 },
  { flags: 4 },
  { crossOrigin: true },
  { userHandle: "wrong-owner" },
])("rejects invalid authentication properties: %j", async (override) => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge, ...override })
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).rejects.toThrow("Passkey ceremony failed")
})

test("rejects invalid signatures even with valid client data", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge })
  const signature = Buffer.from(response.response.signature, "base64url")
  signature[signature.length - 1] = (signature[signature.length - 1] ?? 0) ^ 1
  response.response.signature = signature.toString("base64url")
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).rejects.toThrow()
})

test("rejects a mismatched credential and stale counters", async () => {
  const { service, device, passkey } = await registered()
  for (const stored of [
    { ...passkey, credential: { ...passkey.credential, id: "different" } },
    { ...passkey, credential: { ...passkey.credential, counter: 2 } },
  ]) {
    const ceremony = await run(service.authenticationOptions("browser", stored))
    const response = device.authentication({ origin, challenge: ceremony.options.challenge, counter: 1 })
    await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, stored))).rejects.toThrow()
  }
})

test("allows a synced passkey with a zero counter", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge, flags: 29 })
  expect((await run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).credential.counter).toBe(0)
})

test("a challenge cannot be transferred to another browser", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge })
  await expect(run(service.verifyAuthentication("other-browser", ceremony.ceremonyID, response, passkey))).rejects.toThrow()
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).resolves.toBeDefined()
})

test("concurrent attempts cannot consume a challenge twice", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge })
  const results = await Promise.allSettled([0, 1].map(() =>
    run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey)),
  ))
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
})

test("invalidation rejects pending and in-flight ceremonies", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge })
  const pending = run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))
  Effect.runSync(service.invalidate)
  await expect(pending).rejects.toThrow()
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).rejects.toThrow()
})

test("expired challenges cannot complete registration", async () => {
  let now = 0
  const service = makePasskeys(config, () => now)
  const ceremony = await run(service.registrationOptions("browser", userID))
  now = config.challengeLifetimeMs
  const response = authenticator().registration({ origin, challenge: ceremony.options.challenge })
  await expect(run(service.verifyRegistration("browser", ceremony.ceremonyID, response))).rejects.toThrow()
})

test("registration challenges cannot authorize authentication", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.registrationOptions("browser", userID))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge })
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).rejects.toThrow()
})

test("malformed client data fails generically and consumes the attempt", async () => {
  const { service, device, passkey } = await registered()
  const ceremony = await run(service.authenticationOptions("browser", passkey))
  const response = device.authentication({ origin, challenge: ceremony.options.challenge })
  response.response.clientDataJSON = "not-json"
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, response, passkey))).rejects.toThrow("Passkey ceremony failed")
  const valid = device.authentication({ origin, challenge: ceremony.options.challenge })
  await expect(run(service.verifyAuthentication("browser", ceremony.ceremonyID, valid, passkey))).rejects.toThrow()
})

test("invalidation rejects in-flight registration", async () => {
  const service = makePasskeys(config)
  const ceremony = await run(service.registrationOptions("browser", userID))
  const response = authenticator().registration({ origin, challenge: ceremony.options.challenge })
  const pending = run(service.verifyRegistration("browser", ceremony.ceremonyID, response))
  Effect.runSync(service.invalidate)
  await expect(pending).rejects.toThrow()
})
