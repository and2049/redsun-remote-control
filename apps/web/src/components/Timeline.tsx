import { useState } from "react"
import { flattenTodos, openTodos, timelineEntries, toolOutput, toolSubject, workGroupLabel, type Entry, type TodoItem, type ToolPart } from "../timeline"
import type { InboxItem, Message, PromptBody } from "../types"
import { Markdown } from "./Markdown"

function Output({ text }: { text: string }) {
  const [all, setAll] = useState(false)
  if (!text) return null
  return <details className="tool-output"><summary>Output</summary><pre>{all ? text : text.slice(0, 2000)}</pre>
    {text.length > 2000 && <button type="button" onClick={() => setAll(!all)}>{all ? "Show less" : "Show all"}</button>}
  </details>
}

function Tool({ tool }: { tool: ToolPart }) {
  const subject = toolSubject(tool)
  const running = tool.state.status === "running" || tool.state.status === "streaming"
  return <div className="tool-row"><div className="tool-heading">
    {running && <span className="pulse-dot" role="status" aria-label="Tool running" />}
    <span>{tool.name}</span>{subject && <code className="tool-subject" title={subject}>{subject}</code>}
  </div><Output text={toolOutput(tool)} /></div>
}

const todoGlyphs: Record<string, string> = { pending: "\u25FB", in_progress: "\u25D0", completed: "\u25FC", cancelled: "\u2717" }

function TodoLine({ todo, depth }: { todo: TodoItem; depth: number }) {
  return <>
    <li className={`todo-line ${todo.status}`} style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <span className="todo-glyph" aria-hidden="true">{todoGlyphs[todo.status] ?? todoGlyphs.pending}</span>
      <span>{todo.content}</span>
    </li>
    {todo.children.map((child, index) => <TodoLine key={`${depth}:${index}:${child.content}`} todo={child} depth={depth + 1} />)}
  </>
}

function Tasks({ todos, running }: { todos: TodoItem[]; running: boolean }) {
  const total = flattenTodos(todos).length
  const open = openTodos(todos)
  return <details className="tasks" open>
    <summary>{running && <span className="pulse-dot" role="status" aria-label="Updating tasks" />}Tasks<span className="tasks-count">{total} task{total === 1 ? "" : "s"} ({open} open)</span></summary>
    {todos.length > 0 && <ul className="todo-list">{todos.map((todo, index) => <TodoLine key={`${index}:${todo.content}`} todo={todo} depth={0} />)}</ul>}
  </details>
}

function Bubble({ text, caption }: { text: string; caption?: string }) {
  return <div className="user-entry"><div className="user-bubble">{text}</div>{caption && <small className="bubble-caption">{caption}</small>}</div>
}

function RenderEntry({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "user": return <Bubble text={entry.text} />
    case "assistant-text": return <Markdown text={entry.text} />
    case "reasoning": return <details className="reasoning"><summary>Thinking</summary><div>{entry.text}</div></details>
    case "work": return <details className="work-group"><summary>{workGroupLabel(entry.tools)}</summary>
      {entry.tools.map((tool, index) => <Tool key={`${entry.key}:${index}:${tool.id}`} tool={tool} />)}
    </details>
    case "tasks": return <Tasks todos={entry.todos} running={entry.running} />
    case "shell": return <div className="shell-entry"><code>{entry.command}</code><Output text={entry.output} /></div>
    case "switch": return <div className="switch-entry"><span>{entry.text}</span></div>
    case "note": return <div className="timeline-note" title={entry.text}>{entry.text}</div>
    case "error": return <div className="component-error" role="alert">{entry.text}</div>
  }
}

function inboxText(item: InboxItem): string {
  if (item.type === "move") return `Move to ${item.payload.location.directory}`
  if (item.type === "compaction") return "Compact conversation"
  return item.payload.text
}

export function Timeline(props: { messages: Message[]; inbox: InboxItem[]; running: boolean; pending?: PromptBody }) {
  return <div className="timeline">
    {timelineEntries(props.messages).map((entry) => <RenderEntry key={entry.key} entry={entry} />)}
    {props.inbox.map((item) => <Bubble key={`inbox:${item.id}`} text={inboxText(item)} caption={item.delivery === "steer" ? "Steering" : "Queued"} />)}
    {props.pending && <Bubble key={`pending:${props.pending.id}`} text={props.pending.text} caption="Sending" />}
    {props.running && <div className="running-indicator" role="status" aria-label="Agent running"><span className="pulse-dot" /><span className="pulse-dot" /><span className="pulse-dot" /></div>}
  </div>
}
