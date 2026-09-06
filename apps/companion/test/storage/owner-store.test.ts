import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { makeOwnerStore, recoverOwner } from "../../src/storage/owner"

const origin = "https://host.example.ts.net"
const owner = {
  origin, fingerprint: "a".repeat(32),
  passkey: { userID: "AQ", credential: { id: "AQ", publicKey: new Uint8Array([1]), counter: 0 } },
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/store-" : "redsun-store-"))
  return { directory: path.join(root, "private"), [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }) }
}

test("store leases exclude a second writer and offline recovery, then release without stale locks", async () => {
  await using data = await fixture()
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const store = yield* makeOwnerStore(data.directory, origin)
    expect(yield* store.read).toBeUndefined()
    yield* store.enroll(owner)
    yield* Effect.scoped(makeOwnerStore(data.directory, origin)).pipe(Effect.flip)
    yield* recoverOwner(data.directory).pipe(Effect.flip)
    expect((yield* store.read)?.fingerprint).toBe(owner.fingerprint)
  })))
  await Effect.runPromise(recoverOwner(data.directory))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const store = yield* makeOwnerStore(data.directory, origin)
    expect(yield* store.read).toBeUndefined()
  })))
}, 20000)

test("concurrent counter updates have one winner and survive store recreation", async () => {
  await using data = await fixture()
  let counter = 0
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const store = yield* makeOwnerStore(data.directory, origin)
    yield* store.enroll(owner)
    const results = yield* Effect.promise(() => Promise.allSettled([1, 2].map((value) => Effect.runPromise(store.update(owner, {
      ...owner.passkey, credential: { ...owner.passkey.credential, counter: value },
    })))))
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    counter = (yield* store.read)?.passkey.credential.counter ?? 0
    expect(counter).toBeGreaterThan(0)
  })))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const store = yield* makeOwnerStore(data.directory, origin)
    expect((yield* store.read)?.passkey.credential.counter).toBe(counter)
  })))
}, 20000)

test("counter updates persist atomically, reject stale writers, and allow zero-counter passkeys", async () => {
  await using data = await fixture()
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const store = yield* makeOwnerStore(data.directory, origin)
    yield* store.enroll(owner)
    yield* store.update(owner, owner.passkey)
    const next = { ...owner.passkey, credential: { ...owner.passkey.credential, counter: 1 } }
    yield* store.update(owner, next)
    expect((yield* store.read)?.passkey.credential.counter).toBe(1)
    yield* store.update(owner, next).pipe(Effect.flip)
    expect((yield* store.read)?.passkey.credential.counter).toBe(1)
    yield* store.reset
    expect(yield* store.read).toBeUndefined()
    yield* store.update(owner, next).pipe(Effect.flip)
  })))
}, 20000)
