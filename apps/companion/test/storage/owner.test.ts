import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { makeEnrollment } from "../../src/auth/enrollment"
import { makePasskeys } from "../../src/auth/passkeys"
import { createOwner, loadOwner } from "../../src/storage/owner"
import { createPrivateFile, ensurePrivateDirectory } from "../../src/storage/private-file"
import { authenticator } from "../auth/authenticator"

const origin = "https://host.example.ts.net"

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/owner-" : "redsun-owner-"))
  const directory = path.join(root, "private")
  await Effect.runPromise(ensurePrivateDirectory(directory))
  return { directory, [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

test("local approval persists the verified credential and origin without permitting replacement", async () => {
  await using data = await fixture()
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment({ origin, capacity: 2 }, (record) => createOwner(data.directory, record))
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const device = authenticator()
    const response = device.registration({ origin, challenge: options.options.challenge })
    const proof = yield* enrollment.verify("browser", options.requestID, response)
    yield* loadOwner(data.directory, origin).pipe(Effect.flip)
    yield* enrollment.approve(proof.requestID, proof.fingerprint)
    const stored = yield* loadOwner(data.directory, origin)
    expect(stored.passkey.credential.id).toBe(response.id)
    expect(stored.passkey.credential.publicKey.byteLength).toBeGreaterThan(0)
    expect(stored.passkey.userID).toBe(options.options.user.id)
    expect(stored.fingerprint).toBe(proof.fingerprint)
    const passkeys = makePasskeys({ origin, challengeCapacity: 2, challengeLifetimeMs: 300_000 })
    const login = yield* passkeys.authenticationOptions("browser", stored.passkey)
    const verified = yield* passkeys.verifyAuthentication("browser", login.ceremonyID, device.authentication({
      origin, challenge: login.options.challenge, counter: 1, userHandle: stored.passkey.userID,
    }), stored.passkey)
    expect(verified.credential.counter).toBe(1)
    yield* createOwner(data.directory, stored).pipe(Effect.flip)
    expect(yield* loadOwner(data.directory, origin)).toEqual(stored)
    yield* loadOwner(data.directory, "https://other.example").pipe(Effect.flip)
  })))
}, 15000)

test("owner decoding rejects unknown fields, invalid origins, counters, and noncanonical base64", async () => {
  await using data = await fixture()
  const file = path.join(data.directory, "owner.json")
  const base = {
    version: 1, origin, fingerprint: "a".repeat(32), userID: "AQ",
    credential: { id: "AQ", publicKey: "AQ", counter: 0 },
  }
  await Effect.runPromise(createPrivateFile(file, Buffer.from(JSON.stringify(base))))
  for (const override of [
    { extra: "unexpected" }, { origin: "http://host.example.ts.net" }, { fingerprint: "short" },
    { userID: "AR" }, { userID: Buffer.alloc(65).toString("base64url") },
    { credential: { ...base.credential, counter: -1 } },
    { credential: { ...base.credential, counter: 0x100000000 } },
    { credential: { ...base.credential, privateKey: "unexpected" } },
    { credential: { ...base.credential, transports: ["unknown"] } },
  ]) {
    await writeFile(file, JSON.stringify({ ...base, ...override }))
    await expect(Effect.runPromise(loadOwner(data.directory, origin))).rejects.toThrow("Protected local storage")
  }
}, 15000)

test("malformed or unexpected owner fields fail closed", async () => {
  await using data = await fixture()
  await Effect.runPromise(createPrivateFile(path.join(data.directory, "owner.json"), Buffer.from(JSON.stringify({
    version: 2, origin, privateKey: "synthetic",
  }))))
  await expect(Effect.runPromise(loadOwner(data.directory, origin))).rejects.toThrow("Protected local storage operation failed")
}, 15000)
