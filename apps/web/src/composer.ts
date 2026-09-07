import type { Attachment } from "./types"

export const acceptedTypes = ["image/png", "image/jpeg", "image/webp", "text/plain"]
export const attachmentBudget = 6 * 1024 * 1024
export const maxAttachments = 4
const payloadBudget = 5.5 * 1024 * 1024
const dataPattern = /^data:(text\/plain|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/]*={0,2}$/

export function validateAttachments(existing: Attachment[], incoming: { name: string; type: string; size: number }[]): string | undefined {
  if (existing.length + incoming.length > maxAttachments) return "Attach at most 4 files."
  if (incoming.some((file) => !acceptedTypes.includes(file.type))) return "Use PNG, JPEG, WebP, or plain text files."
  if (incoming.some((file) => !Number.isSafeInteger(file.size) || file.size < 0)) return "Invalid file size."
  if (existing.some((file) => !dataPattern.test(file.uri))) return "Invalid attachment data."
  const current = existing.reduce((total, file) => total + file.uri.slice(file.uri.indexOf(",") + 1).length, 0)
  const added = incoming.reduce((total, file) => total + Math.ceil(file.size * 4 / 3), 0)
  if (current + added > payloadBudget) return "Attachments are too large. Keep the encoded payload below 5.5 MiB."
  return undefined
}

export function toDataURI(type: string, base64: string): string {
  const uri = `data:${type};base64,${base64}`
  if (!dataPattern.test(uri)) throw new Error("Invalid attachment type or base64 data.")
  return uri
}
