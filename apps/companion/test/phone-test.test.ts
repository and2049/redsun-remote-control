import { expect, test } from "bun:test"
import { approveCommands, parseOptions } from "../script/phone-test-lib"

test("approve commands come only from non-empty pending lists", () => {
  expect(approveCommands("Enrollment open for five minutes.")).toBeUndefined()
  expect(approveCommands("[]")).toEqual([])
  expect(approveCommands("[not json")).toBeUndefined()
  expect(approveCommands('[{"requestID":"req","fingerprint":"abcd"}]')).toEqual(["approve req abcd"])
})

test("phone-test requires an explicit HTTPS origin and validates the loopback port", () => {
  expect(parseOptions(["--origin", "https://remote.example"])).toEqual({ origin: "https://remote.example", port: 43123 })
  expect(parseOptions(["--port", "50000", "--origin", "https://remote.example"])).toEqual({ origin: "https://remote.example", port: 50000 })
  for (const args of [[], ["--origin", "http://remote.example"], ["--origin", "https://remote.example/path"], ["--origin", "https://remote.example", "--port", "0"], ["--origin", "https://remote.example", "--port", "65536"], ["--origin", "https://remote.example", "--redsun", "/src/redsun"], ["--origin"]]) {
    expect(() => parseOptions(args)).toThrow()
  }
})
