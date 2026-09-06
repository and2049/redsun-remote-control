export type Command =
  | { readonly kind: "dev" }
  | { readonly kind: "help" }
  | { readonly kind: "import-backend"; readonly source: string }

export function parseCommand(args: readonly string[]): Command {
  if (args.length === 0) return { kind: "dev" }
  if (args.length === 1 && args[0] === "--help") return { kind: "help" }
  if (args.length === 2 && args[0] === "import-backend" && args[1] && !args[1].startsWith("-")) {
    return { kind: "import-backend", source: args[1] }
  }
  throw new Error("Usage: companion [--help | import-backend <absolute-private-handoff-file>]")
}
