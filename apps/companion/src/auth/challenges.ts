import { randomBytes } from "node:crypto"

type Entry<T> = {
  readonly binding: string
  readonly expiresAt: number
  readonly value: T
}

export class Challenges<T> {
  private readonly entries = new Map<string, Entry<T>>()

  constructor(
    private readonly lifetimeMs: number,
    private readonly capacity: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) throw new Error("Invalid challenge lifetime")
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Invalid challenge capacity")
  }

  issue(binding: string, value: T): string {
    if (!binding) throw new Error("Missing browser binding")
    const now = this.now()
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id)
    }
    if (this.entries.size >= this.capacity) throw new Error("Challenge capacity reached")
    const id = randomBytes(32).toString("base64url")
    this.entries.set(id, { binding, value, expiresAt: now + this.lifetimeMs })
    return id
  }

  take(id: string, binding: string): T {
    const entry = this.entries.get(id)
    if (!entry || entry.binding !== binding) throw new Error("Invalid challenge")
    this.entries.delete(id)
    if (entry.expiresAt <= this.now()) throw new Error("Invalid challenge")
    return entry.value
  }

  clear(): void {
    this.entries.clear()
  }
}
