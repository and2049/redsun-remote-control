export function pendingPromptKey(backendID: string, sessionID: string): string {
  if (!backendID || !/^ses_[A-Za-z0-9_-]+$/.test(sessionID)) throw new Error("Connect to a verified backend and select a session first")
  return `redsun-diagnostic/${encodeURIComponent(backendID)}/${sessionID}/pending`
}

export function containsPrompt(id: string, pages: readonly unknown[]): boolean {
  return pages.some((items) => Array.isArray(items) && items.some((item: unknown) =>
    item !== null && typeof item === "object" && "id" in item && item.id === id,
  ))
}
