import { expect, test } from "bun:test"
import { Effect } from "effect"
import { makeEnrollment } from "../../src/auth/enrollment"
import type { OwnerEnrollment } from "../../src/storage/owner"
import { authenticator } from "./authenticator"

const origin = "https://host.example.ts.net"
const config = { origin, capacity: 4 }
const run = Effect.runPromise

test("requires verified proof and the exact locally approved fingerprint before persistence", async () => {
  const saved: OwnerEnrollment[] = []
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, (record) => Effect.sync(() => { saved.push(record) }))
    expect((yield* enrollment.options("browser").pipe(Effect.flip)).message).toBe("Local enrollment operation failed")
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    expect(yield* enrollment.pending).toEqual([])
    yield* enrollment.approve(options.requestID, "a".repeat(32)).pipe(Effect.flip)
    expect(saved).toHaveLength(0)
    const device = authenticator()
    const response = device.registration({ origin, challenge: options.options.challenge })
    yield* enrollment.verify("wrong-browser", options.requestID, response).pipe(Effect.flip)
    const proof = yield* enrollment.verify("browser", options.requestID, response)
    expect(proof.fingerprint).toMatch(/^[a-f0-9]{32}$/)
    expect(yield* enrollment.pending).toEqual([proof])
    yield* enrollment.approve(proof.requestID, "wrong").pipe(Effect.flip)
    expect(saved).toHaveLength(0)
    yield* enrollment.approve(proof.requestID, proof.fingerprint)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.passkey.credential.id).toBe(response.id)
    expect(saved[0]?.fingerprint).toBe(proof.fingerprint)
    yield* enrollment.open.pipe(Effect.flip)
    yield* enrollment.approve(proof.requestID, proof.fingerprint).pipe(Effect.flip)
    expect(saved).toHaveLength(1)
  })))
})

test("window expiration includes its five-minute deadline", async () => {
  let now = 0
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.void, () => now)
    expect(yield* enrollment.open).toEqual({ lifetimeMs: 300_000 })
    const options = yield* enrollment.options("browser")
    const proof = yield* enrollment.verify("browser", options.requestID, authenticator().registration({ origin, challenge: options.options.challenge }))
    now = 300_000
    yield* enrollment.approve(proof.requestID, proof.fingerprint).pipe(Effect.flip)
    yield* enrollment.options("browser").pipe(Effect.flip)
    yield* enrollment.open
    expect(yield* enrollment.pending).toEqual([])
  })))
})

test("cancel and a new window invalidate outstanding ceremonies and proofs", async () => {
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.void)
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const device = authenticator()
    const response = device.registration({ origin, challenge: options.options.challenge })
    yield* enrollment.cancel
    yield* enrollment.open
    yield* enrollment.verify("browser", options.requestID, response).pipe(Effect.flip)
    expect(yield* enrollment.pending).toEqual([])
  })))
})

test("failed verification consumes the attempt and cannot become approvable", async () => {
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.void)
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const device = authenticator()
    yield* enrollment.verify("browser", options.requestID, device.registration({ origin, challenge: "wrong" })).pipe(Effect.flip)
    yield* enrollment.verify("browser", options.requestID, device.registration({ origin, challenge: options.options.challenge })).pipe(Effect.flip)
    expect(yield* enrollment.pending).toEqual([])
  })))
})

test("bounded concurrent option requests cannot exceed capacity", async () => {
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment({ origin, capacity: 1 }, () => Effect.void)
    yield* enrollment.open
    const results = yield* Effect.promise(() => Promise.allSettled([
      run(enrollment.options("a")), run(enrollment.options("b")),
    ]))
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  })))
})

test("concurrent approvals persist only one enrollment", async () => {
  let writes = 0
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.sync(() => { writes += 1 }))
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const proof = yield* enrollment.verify("browser", options.requestID, authenticator().registration({ origin, challenge: options.options.challenge }))
    const results = yield* Effect.promise(() => Promise.allSettled([
      run(enrollment.approve(proof.requestID, proof.fingerprint)),
      run(enrollment.approve(proof.requestID, proof.fingerprint)),
    ]))
    expect(writes).toBe(1)
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  })))
})

test("persistence failures return no approval and require a new local window", async () => {
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.fail(new Error("private persistence detail")))
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const proof = yield* enrollment.verify("browser", options.requestID, authenticator().registration({ origin, challenge: options.options.challenge }))
    const error = yield* enrollment.approve(proof.requestID, proof.fingerprint).pipe(Effect.flip)
    expect(String(error)).not.toContain("private persistence detail")
    yield* enrollment.pending.pipe(Effect.flip)
    yield* enrollment.approve(proof.requestID, proof.fingerprint).pipe(Effect.flip)
  })))
})

test("scope release permanently closes enrollment", async () => {
  const enrollment = await run(Effect.scoped(makeEnrollment(config, () => Effect.void)))
  await expect(run(enrollment.open)).rejects.toThrow("Local enrollment operation failed")
})

test("invalid setup fails through the safe error channel", async () => {
  for (const invalid of [{ origin: "http://invalid", capacity: 1 }, { origin, capacity: 0 }]) {
    const error = await run(Effect.scoped(makeEnrollment(invalid, () => Effect.void)).pipe(Effect.flip))
    expect(String(error)).toBe("EnrollmentError: Local enrollment operation failed")
  }
})

test("cancellation invalidates registration verification already in flight", async () => {
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.void)
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const response = authenticator().registration({ origin, challenge: options.options.challenge })
    const pending = run(enrollment.verify("browser", options.requestID, response)).then(() => "accepted", () => "rejected")
    yield* enrollment.cancel
    expect(yield* Effect.promise(() => pending)).toBe("rejected")
    yield* enrollment.open
    expect(yield* enrollment.pending).toEqual([])
  })))
})

test("approval waits for persistence; local cancellation serializes after an admitted approval", async () => {
  let finish: (() => void) | undefined
  let started: (() => void) | undefined
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  const entered = new Promise<void>((resolve) => { started = resolve })
  await run(Effect.scoped(Effect.gen(function* () {
    const enrollment = yield* makeEnrollment(config, () => Effect.promise(() => { started?.(); return waiting }))
    yield* enrollment.open
    const options = yield* enrollment.options("browser")
    const proof = yield* enrollment.verify("browser", options.requestID, authenticator().registration({ origin, challenge: options.options.challenge }))
    let approved = false
    let cancelled = false
    const approval = run(enrollment.approve(proof.requestID, proof.fingerprint)).then(() => { approved = true })
    yield* Effect.promise(() => entered)
    const cancellation = run(enrollment.cancel).then(() => { cancelled = true })
    expect(approved).toBe(false)
    expect(cancelled).toBe(false)
    finish?.()
    yield* Effect.promise(() => Promise.all([approval, cancellation]))
    expect(approved).toBe(true)
    expect(cancelled).toBe(true)
    yield* enrollment.open.pipe(Effect.flip)
  })))
})
