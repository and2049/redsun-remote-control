import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Approvals } from "../src/components/Approvals"
import { Composer } from "../src/components/Composer"
import { Markdown } from "../src/components/Markdown"
import { Timeline } from "../src/components/Timeline"

const reply = async () => {}

test("timeline renders user, work, inbox, pending and running states", () => {
  const html = renderToStaticMarkup(<Timeline messages={[
    { id: "u", type: "user", text: "Hello\nworld", time: { created: 0 } },
    { id: "a", type: "assistant", time: { created: 0 }, content: [
      { type: "tool", id: "t", name: "write", state: { status: "running", input: { filePath: "file.ts" } }, time: { created: 0 } },
      { type: "tool", id: "t2", name: "bash", state: { status: "completed", input: { command: "pwd" }, content: [{ type: "text", text: "x".repeat(2001) }] }, time: { created: 0 } },
      { type: "reasoning", text: "Considering" },
      { type: "text", text: "**Done**" },
    ] },
  ]} inbox={[{ id: "q", sessionID: "s", timeCreated: 0, type: "user", delivery: "queue", payload: { text: "Next" } }, { id: "st", sessionID: "s", timeCreated: 0, type: "user", delivery: "steer", payload: { text: "Instead" } }]} running pending={{ id: "p", text: "Pending" }} />)
  expect(html).toContain('class="user-bubble">Hello\nworld')
  expect(html).toContain("Created a file, ran a command")
  for (const text of ["Queued", "Steering", "Sending", "Thinking", "file.ts", "Show all", "Agent running", "<strong>Done</strong>"]) expect(html).toContain(text)
  expect(html).not.toContain("x".repeat(2001))
})

test("task lists render status glyphs, nesting and counts", () => {
  const html = renderToStaticMarkup(<Timeline messages={[
    { id: "a", type: "assistant", time: { created: 0 }, content: [
      { type: "tool", id: "t", name: "todowrite", state: { status: "completed", input: { todos: [
        { content: "Parent", status: "in_progress", children: [{ content: "Child", status: "completed" }, { content: "Dropped", status: "cancelled" }] },
      ] }, content: [{ type: "text", text: "3 todos (1 open)" }] }, time: { created: 0 } },
    ] },
  ]} inbox={[]} running={false} />)
  for (const text of ["3 tasks", "(1 open)", 'class="todo-line in_progress"', 'class="todo-line completed"', 'class="todo-line cancelled"', "Parent", "Child", "Dropped", "padding-left:1.25rem"]) expect(html).toContain(text)
  expect(html).not.toContain("Created a file")
})

test("permissions render first action, resources and approval choices", () => {
  const html = renderToStaticMarkup(<Approvals permissions={[{ id: "p", sessionID: "s", action: "Write file", resources: ["src/main.ts"], message: "Needs access" }]} forms={[{ id: "f", sessionID: "s", title: "Hidden form", fields: [] }]} onPermission={reply} onForm={reply} onCancelForm={reply} />)
  for (const text of ["Write file", "<code>src/main.ts</code>", "Needs access", "Approve once", "Always allow", "Reject", "1 of 2"]) expect(html).toContain(text)
  expect(html).not.toContain("Hidden form")
  expect(renderToStaticMarkup(<Approvals permissions={[]} forms={[]} onPermission={reply} onForm={reply} onCancelForm={reply} />)).toBe("")
})

test("forms render all supported fields, defaults and constraints", () => {
  const html = renderToStaticMarkup(<Approvals permissions={[]} forms={[{ id: "f", sessionID: "s", title: "Configure", fields: [
    { key: "name", type: "string", title: "Project name", placeholder: "Name", default: "demo", required: true },
    { key: "mode", type: "string", title: "Mode", options: [{ value: "safe", label: "Safe" }], custom: true },
    { key: "count", type: "integer", title: "Count", minimum: 1, maximum: 5, default: 2 },
    { key: "ratio", type: "number", title: "Ratio", default: 0.5 },
    { key: "enabled", type: "boolean", title: "Enabled", default: true },
    { key: "tags", type: "multiselect", title: "Tags", options: [{ value: "a", label: "Alpha" }], minItems: 1, maxItems: 1, default: ["a"] },
  ] }]} onPermission={reply} onForm={reply} onCancelForm={reply} />)
  for (const text of ["Configure", "Project name", "Mode", "Count", "Ratio", "Enabled", "Tags", "Alpha", 'value="demo"', 'min="1"', 'max="5"', 'step="1"', 'step="any"', 'checked=""', "Custom value for Mode", "Submit", "Cancel"]) expect(html).toContain(text)
})

test("markdown supports prose and code but never raw HTML or images", () => {
  const html = renderToStaticMarkup(<Markdown text={'# Heading\n\n`inline`\n\n```ts\nconst x = 1\n```\n\n[Link](https://example.com)\n\n![Picture](https://example.com/image.png)\n\n![](https://example.com/empty.png)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n<div class="injected">unsafe</div>'} />)
  for (const text of ['class="prose"', "<h1>Heading</h1>", "<code>inline</code>", '<pre class="code"><code class="language-ts">', 'target="_blank"', 'rel="noopener noreferrer"', 'class="prose-table"', "Picture", "[image]"]) expect(html).toContain(text)
  for (const text of ["<script", 'class="injected"', "<img", "alert(1)"]) expect(html).not.toContain(text)
})

test("composer renders accessible controls without browser globals", () => {
  const html = renderToStaticMarkup(<Composer disabled={false} running model={{ id: "model", providerID: "p", variant: "fast" }} agent="build" draftKey="test/draft" onSend={reply} onInterrupt={reply} onPickModel={() => {}} onPickAgent={() => {}} />)
  for (const text of ["Message redsun", "model fast", "build", "Add attachments", "Stop generation", "Send message", 'accept="image/png,image/jpeg,image/webp,text/plain"']) expect(html).toContain(text)
})
