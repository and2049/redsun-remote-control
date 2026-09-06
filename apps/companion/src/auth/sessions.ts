import { createHash, randomBytes } from "node:crypto"
import { Effect } from "effect"

export const sessionPolicy = Object.freeze({
  absoluteLifetimeMs: 24 * 60 * 60 * 1000,
  idleLifetimeMs: 60 * 60 * 1000,
})

type Entry = {
  readonly controller: AbortController
  readonly expiresAt: number
  idleExpiresAt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export function makeSessions(capacity: number) {
  return Effect.acquireRelease(
    Effect.sync(() => new Sessions(capacity)),
    (sessions) => Effect.sync(() => sessions.close()),
  )
}

export class Sessions {
  private readonly entries = new Map<string, Entry>()
  private closed = false

  constructor(
    private readonly capacity: number,
    private readonly policy: { readonly absoluteLifetimeMs: number; readonly idleLifetimeMs: number } = sessionPolicy,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Invalid session capacity")
    for (const value of [policy.absoluteLifetimeMs, policy.idleLifetimeMs]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error("Invalid session lifetime")
    }
    this.policy = { ...policy }
  }

  issue(): string {
    if (this.closed) throw new Error("Session store closed")
    this.expire()
    if (this.entries.size >= this.capacity) throw new Error("Session capacity reached")
    const token = randomBytes(32).toString("base64url")
    const key = this.key(token)
    const now = this.now()
    const entry: Entry = {
      controller: new AbortController(),
      expiresAt: now + this.policy.absoluteLifetimeMs,
      idleExpiresAt: now + this.policy.idleLifetimeMs,
      timer: undefined,
    }
    this.entries.set(key, entry)
    this.schedule(key, entry)
    return token
  }

  authenticate(token: string): AbortSignal | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined
    const key = this.key(token)
    const entry = this.entries.get(key)
    if (!entry) return undefined
    const now = this.now()
    if (Math.min(entry.expiresAt, entry.idleExpiresAt) <= now) {
      this.remove(key, entry)
      return undefined
    }
    entry.idleExpiresAt = now + this.policy.idleLifetimeMs
    this.schedule(key, entry)
    return entry.controller.signal
  }

  revoke(token: string): void {
    const key = this.key(token)
    const entry = this.entries.get(key)
    if (entry) this.remove(key, entry)
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.remove(key, entry)
  }

  close(): void {
    this.closed = true
    this.clear()
  }

  private key(token: string): string {
    return createHash("sha256").update(token).digest("hex")
  }

  private expire(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (Math.min(entry.expiresAt, entry.idleExpiresAt) <= now) this.remove(key, entry)
    }
  }

  private schedule(key: string, entry: Entry): void {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      if (Math.min(entry.expiresAt, entry.idleExpiresAt) <= this.now()) this.remove(key, entry)
      else this.schedule(key, entry)
    }, Math.max(1, Math.ceil(Math.min(entry.expiresAt, entry.idleExpiresAt) - this.now())))
    entry.timer.unref()
  }

  private remove(key: string, entry: Entry): void {
    this.entries.delete(key)
    clearTimeout(entry.timer)
    entry.controller.abort()
  }
}
