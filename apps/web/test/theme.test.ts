import { expect, test } from "bun:test"
import { decodeTheme, themeVariables } from "../src/theme"
import type { Theme } from "../src/types"

const sample: Theme = {
  name: "dusk",
  mode: "dark",
  colors: {
    text: {
      default: "#e4e4e4", subdued: "#e4e4e45e",
      action: { primary: "#181717", secondary: "#e4e4e4", destructive: "#181717" },
      status: { running: "#8fb458", question: "#f1b467", permission: "#e34671", unread: "#fde36f" },
      feedback: { error: "#e34671", warning: "#f1b467", success: "#8fb458", info: "#ee9a62" },
    },
    background: {
      default: "#181717", offset: "#242222", overlay: "#2c2a2a",
      action: { primary: "#fde36f", secondary: "#242222", destructive: "#e34671" },
      feedback: { error: "#3a1f27", warning: "#3a2f1f", success: "#233a1f", info: "#3a2a1f" },
    },
    border: { default: "#e4e4e413" },
    diff: { added: "#3fa266", removed: "#e34671" },
    markdown: {
      text: "#e4e4e4", heading: "#AAA0FA", link: "#82D2CE", linkText: "#ee9a62", code: "#E394DC", blockQuote: "#e4e4e45e",
      emphasis: "#82D2CE", strong: "#F8C762", horizontalRule: "#e4e4e45e", listItem: "#e4e4e4", listEnumeration: "#e4e4e4",
      image: "#82D2CE", imageText: "#ee9a62", codeBlock: "#e4e4e4",
    },
  },
}

test("theme variables map host tokens onto the stylesheet custom properties", () => {
  const variables = themeVariables(sample)
  expect(variables["--surface"]).toBe("#181717")
  expect(variables["--surface-raised"]).toBe("#2c2a2a")
  expect(variables["--ink"]).toBe("#e4e4e4")
  expect(variables["--accent"]).toBe("#fde36f")
  expect(variables["--accent-ink"]).toBe("#181717")
  expect(variables["--danger"]).toBe("#e34671")
  expect(variables["--link"]).toBe("#82D2CE")
  expect(Object.keys(variables).every((name) => name.startsWith("--"))).toBe(true)
})

test("cached themes are validated before use", () => {
  expect(decodeTheme(sample)).toBe(sample)
  expect(decodeTheme(undefined)).toBeUndefined()
  expect(decodeTheme({ ...sample, mode: "sepia" })).toBeUndefined()
  expect(decodeTheme({ ...sample, colors: { ...sample.colors, border: { default: "red" } } })).toBeUndefined()
  expect(decodeTheme({ ...sample, colors: { ...sample.colors, text: { ...sample.colors.text, default: "url(x)" } } })).toBeUndefined()
})
