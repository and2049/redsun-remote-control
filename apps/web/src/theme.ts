import type { Theme } from "./types"

const storageKey = "redsun/theme"
const hex = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

export function themeVariables(theme: Theme): Record<string, string> {
  const colors = theme.colors
  return {
    "--surface": colors.background.default,
    "--surface-raised": colors.background.overlay,
    "--surface-sunken": colors.background.offset,
    "--ink": colors.text.default,
    "--ink-secondary": colors.text.subdued,
    "--border": colors.border.default,
    "--accent": colors.background.action.primary,
    "--accent-ink": colors.text.action.primary,
    "--user-bubble": colors.background.offset,
    "--code-bg": colors.background.offset,
    "--success": colors.text.feedback.success,
    "--danger": colors.text.feedback.error,
    "--warning": colors.text.feedback.warning,
    "--link": colors.markdown.link,
    "--heading": colors.markdown.heading,
    "--running": colors.text.status.running,
  }
}

function colorRecord(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false
  return keys.every((key) => typeof (value as Record<string, unknown>)[key] === "string" && hex.test((value as Record<string, string>)[key] ?? ""))
}

export function decodeTheme(value: unknown): Theme | undefined {
  if (!value || typeof value !== "object") return undefined
  const theme = value as Record<string, unknown>
  const colors = theme.colors as Record<string, unknown> | undefined
  if (typeof theme.name !== "string" || (theme.mode !== "light" && theme.mode !== "dark") || !colors) return undefined
  const text = colors.text as Record<string, unknown> | undefined
  const background = colors.background as Record<string, unknown> | undefined
  const valid = colorRecord(text, ["default", "subdued"]) && colorRecord(text?.action, ["primary"]) &&
    colorRecord(text?.status, ["running"]) && colorRecord(text?.feedback, ["error", "warning", "success"]) &&
    colorRecord(background, ["default", "offset", "overlay"]) && colorRecord(background?.action, ["primary"]) &&
    colorRecord(colors.border, ["default"]) && colorRecord(colors.markdown, ["link", "heading"])
  return valid ? (value as Theme) : undefined
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, color] of Object.entries(themeVariables(theme))) root.style.setProperty(name, color)
  root.style.colorScheme = theme.mode
}

export function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(theme))
  } catch {}
}

export function restoreTheme(): Theme | undefined {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? decodeTheme(JSON.parse(raw)) : undefined
  } catch {
    return undefined
  }
}
