import { expect, test } from "bun:test"
import { parseCommand } from "../src/command"

test("parses only explicitly supported commands", () => {
  expect(parseCommand([])).toEqual({ kind: "dev" })
  expect(parseCommand(["--help"])).toEqual({ kind: "help" })
  expect(parseCommand(["import-backend", "/private/handoff"])).toEqual({ kind: "import-backend", source: "/private/handoff" })
})

test.each([["import-backend"], ["unknown"], ["--help", "extra"], ["import-backend", "--token"], ["import-backend", "file", "extra"]].map((args) => ({ args })))(
  "rejects malformed CLI commands", ({ args }) => expect(() => parseCommand(args)).toThrow("Usage:"),
)
