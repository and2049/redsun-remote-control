import { expect, test } from "bun:test"
import { acceptedTypes, attachmentBudget, maxAttachments, toDataURI, validateAttachments } from "../src/composer"

test("attachment formats are restricted and normalized", () => {
  expect(attachmentBudget).toBe(6291456)
  expect(maxAttachments).toBe(4)
  for (const type of acceptedTypes) expect(toDataURI(type, "YQ==")).toMatch(/^data:(text\/plain|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/]*={0,2}$/)
  expect(toDataURI("text/plain", "YQ==")).toBe("data:text/plain;base64,YQ==")
  expect(() => toDataURI("text/html", "YQ==")).toThrow()
  expect(() => toDataURI("text/plain", "a b")).toThrow()
})

test("validates count, type, size and combined encoded payload", () => {
  const file = { name: "file", type: "text/plain", size: 1 }
  expect(validateAttachments([], Array.from({ length: 4 }, () => file))).toBeUndefined()
  expect(validateAttachments([{ uri: toDataURI("text/plain", "YQ==") }], Array.from({ length: 4 }, () => file))).toBeDefined()
  expect(validateAttachments([], [{ ...file, type: "image/svg+xml" }])).toBeDefined()
  expect(validateAttachments([], [{ ...file, size: -1 }])).toBeDefined()
  expect(validateAttachments([], [{ ...file, size: Number.NaN }])).toBeDefined()
  const limit = 5.5 * 1024 * 1024
  expect(validateAttachments([], [{ ...file, size: limit * 3 / 4 }])).toBeUndefined()
  expect(validateAttachments([], [{ ...file, size: limit * 3 / 4 + 1 }])).toBeDefined()
  expect(validateAttachments([{ uri: toDataURI("text/plain", "YQ==") }], [{ ...file, size: limit * 3 / 4 }])).toBeDefined()
  expect(validateAttachments([{ uri: "https://example.com/file" }], [])).toBeDefined()
})
