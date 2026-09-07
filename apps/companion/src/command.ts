export type Command =
  | { readonly kind: "dev" }
  | { readonly kind: "help" }
  | { readonly kind: "import-backend"; readonly source: string }
  | { readonly kind: "serve"; readonly origin: string; readonly port: number; readonly backend?: true }
  | { readonly kind: "recover" }
  | { readonly kind: "check-backend" }

export function parseCommand(args: readonly string[]): Command {
  if (args.length === 0) return { kind: "dev" }
  if (args.length === 1 && args[0] === "--help") return { kind: "help" }
  if (args.length === 1 && args[0] === "check-backend") return { kind: "check-backend" }
  if (args.length === 2 && args[0] === "recover" && args[1] === "--confirm") return { kind: "recover" }
  if ((args.length === 5 || (args.length === 6 && args[5] === "--backend")) && args[0] === "serve" && args[1] === "--origin" && args[2] && args[3] === "--port" && args[4] && /^\d+$/.test(args[4])) {
    return { kind: "serve", ...validateServe(args[2], Number(args[4])), ...(args[5] === "--backend" ? { backend: true as const } : {}) }
  }
  if (args.length === 2 && args[0] === "import-backend" && args[1] && !args[1].startsWith("-")) {
    return { kind: "import-backend", source: args[1] }
  }
  throw new Error("Usage: companion --help")
}

export function validateServe(origin: string, port: number): { readonly origin: string; readonly port: number } {
  const url = new URL(origin)
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Usage: companion --help")
  }
  return { origin, port }
}
