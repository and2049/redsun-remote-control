import type { ModelRef, PromptBody, Session } from "./types"

const sessionPattern = /^ses_[A-Za-z0-9_-]+$/

export function newID(prefix: "ses" | "msg"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`
}

export function pendingPromptKey(backendID: string, sessionID: string): string {
  if (!backendID || !sessionPattern.test(sessionID)) throw new Error("Connect to a verified backend and select a session first")
  return `redsun/${encodeURIComponent(backendID)}/${sessionID}/pending`
}

export function creatingKey(backendID: string): string {
  if (!backendID) throw new Error("Connect to a verified backend first")
  return `redsun/${encodeURIComponent(backendID)}/creating`
}

export function containsPrompt(id: string, pages: readonly unknown[]): boolean {
  return pages.some((items) => Array.isArray(items) && items.some((item: unknown) =>
    item !== null && typeof item === "object" && "id" in item && item.id === id,
  ))
}

export function readPending(storage: Pick<Storage, "getItem">, key: string): PromptBody | undefined {
  const raw = storage.getItem(key)
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === "object" && "id" in value && "text" in value) return value as PromptBody
  } catch {}
  return undefined
}

export function sessionTitle(session: Pick<Session, "title" | "location" | "id">): string {
  if (session.title?.trim()) return session.title.trim()
  return directoryName(session.location.directory) || session.id
}

export function directoryName(directory: string): string {
  const parts = directory.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

export function relativeTime(millis: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - millis) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(millis).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function modelLabel(model: ModelRef | undefined): string {
  if (!model) return "Default model"
  return model.variant ? `${model.id} ${model.variant}` : model.id
}
