import { expect, test } from "bun:test"
import { parseCommand } from "../src/command"

test("parses only explicitly supported commands", () => {
  expect(parseCommand([])).toEqual({ kind: "dev" })
  expect(parseCommand(["--help"])).toEqual({ kind: "help" })
  expect(parseCommand(["import-backend", "/private/handoff"])).toEqual({ kind: "import-backend", source: "/private/handoff" })
  expect(parseCommand(["serve", "--origin", "https://host.example", "--port", "43123"])).toEqual({ kind: "serve", origin: "https://host.example", port: 43123 })
  expect(parseCommand(["recover", "--confirm"])).toEqual({ kind: "recover" })
})

test.each([["import-backend"], ["unknown"], ["--help", "extra"], ["import-backend", "--token"], ["import-backend", "file", "extra"]].map((args) => ({ args })))(
  "rejects malformed CLI commands", ({ args }) => expect(() => parseCommand(args)).toThrow("Usage:"),
)

test.each([
  ["recover"], ["recover", "confirm"], ["serve", "--origin", "http://host.example", "--port", "43123"],
  ["serve", "--origin", "https://host.example", "--port", "0"],
  ["serve", "--origin", "https://host.example", "--port", "65536"],
  ["serve", "--origin", "https://host.example/path", "--port", "43123"],
].map((args) => ({ args })))("rejects implicit recovery and invalid operational configuration", ({ args }) => {
  expect(() => parseCommand(args)).toThrow()
})
