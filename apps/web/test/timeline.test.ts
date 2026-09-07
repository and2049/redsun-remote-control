import { describe, expect, test } from "bun:test"
import { timelineEntries, toolOutput, toolSubject, workGroupLabel, type ToolPart } from "../src/timeline"

function tool(name: string, state: ToolPart["state"] = { status: "running", input: {} }): ToolPart {
  return { type: "tool", id: name, name, state, time: { created: 0 } }
}

describe("timeline", () => {
  test("groups only consecutive tools in the same message with stable keys", () => {
    const entries = timelineEntries([
      { id: "a", type: "assistant", time: { created: 0 }, content: [tool("write"), tool("bash"), { type: "text", text: "Done" }, tool("read")] },
      { id: "b", type: "assistant", time: { created: 0 }, content: [tool("read")] },
    ])
    expect(entries.map((entry) => entry.kind)).toEqual(["work", "assistant-text", "work", "work"])
    expect(entries.map((entry) => entry.key)).toEqual(["a:0", "a:2", "a:3", "b:0"])
    expect(entries[0]).toMatchObject({ tools: [tool("write"), tool("bash")] })
  })
  test("summarizes aliases and plural counts in encounter order", () => {
    expect(workGroupLabel([tool("write"), tool("bash")])).toBe("Created a file, ran a command")
    expect(workGroupLabel([tool("edit"), tool("patch"), tool("bash"), tool("shell"), tool("bash")])).toBe("Edited 2 files, ran 3 commands")
    expect(workGroupLabel([tool("read"), tool("glob"), tool("grep"), tool("webfetch"), tool("websearch"), tool("task"), tool("agent"), tool("custom")])).toBe("Read a file, searched files 2 times, fetched 2 pages, ran 2 subagents, custom")
    expect(workGroupLabel([])).toBe("")
    expect(workGroupLabel([tool("multiedit"), tool("list"), tool("task"), tool("webfetch")])).toBe("Edited a file, searched files, ran a subagent, fetched a page")
    expect(workGroupLabel([tool("write"), tool("write"), tool("read"), tool("read")])).toBe("Created 2 files, read 2 files")
  })
  test("extracts useful subjects and outputs", () => {
    expect(toolSubject(tool("shell", { status: "running", input: { path: "x", command: "pwd" } }))).toBe("pwd")
    expect(toolSubject(tool("x", { status: "running", input: { count: 2, value: "fallback" } }))).toBe("fallback")
    expect(toolSubject(tool("x"))).toBeUndefined()
    for (const key of ["filePath", "path", "pattern", "url", "description"]) {
      expect(toolSubject(tool("x", { status: "running", input: { other: "fallback", [key]: "preferred" } }))).toBe("preferred")
    }
    expect(toolSubject(tool("x", { status: "streaming", input: "partial" }))).toBe("partial")
    expect(toolOutput(tool("x", { status: "completed", input: {}, content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }))).toBe("a\nb")
    expect(toolOutput(tool("x", { status: "error", input: {}, error: { type: "error", message: "Failed" } }))).toBe("Failed")
    expect(toolOutput(tool("x"))).toBe("")
    expect(toolOutput(tool("x", { status: "streaming", input: "partial" }))).toBe("")
    expect(toolOutput(tool("x", { status: "completed", input: {}, content: [] }))).toBe("")
  })
  test("projects non-tool history and assistant errors", () => {
    const time = { created: 0 }
    expect(timelineEntries([
      { id: "u", time, type: "user", text: "Hello" },
      { id: "s", time, type: "shell", command: "pwd", status: "completed", output: { output: "home", truncated: false } },
      { id: "a", time, type: "agent-switched", agent: "build" },
      { id: "m", time, type: "model-switched", model: { id: "model", providerID: "p" } },
      { id: "l", time, type: "location-switched", location: { directory: "/work" } },
      { id: "n", time, type: "system", text: "Note" },
      { id: "e", time, type: "assistant", content: [{ type: "reasoning", text: "Think" }], error: { type: "error", message: "Oops" } },
    ]).map((entry) => entry.kind)).toEqual(["user", "shell", "switch", "switch", "switch", "note", "reasoning", "error"])
  })
  test("renders descriptive notes and missing shell output", () => {
    const time = { created: 0 }
    expect(timelineEntries([
      { id: "a", time, type: "synthetic", text: "long", description: "Short" },
      { id: "b", time, type: "skill", name: "Review", text: "Loaded" },
      { id: "c", time, type: "compaction", status: "completed", reason: "Limit", summary: "Summary" },
      { id: "d", time, type: "shell", status: "running", command: "pwd" },
    ])).toEqual([
      { key: "a:0", kind: "note", text: "Short" },
      { key: "b:0", kind: "note", text: "Review: Loaded" },
      { key: "c:0", kind: "note", text: "Compaction completed: Summary" },
      { key: "d:0", kind: "shell", command: "pwd", output: "" },
    ])
  })
})
