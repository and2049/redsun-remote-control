import { modelLabel } from "./state"
import type { AssistantPart, Message } from "./types"

export type ToolPart = Extract<AssistantPart, { type: "tool" }>
export type TodoItem = { content: string; status: string; children: TodoItem[] }
export type Entry = { key: string } & (
  | { kind: "user" | "assistant-text" | "reasoning" | "switch" | "note" | "error"; text: string }
  | { kind: "work"; tools: ToolPart[] }
  | { kind: "tasks"; todos: TodoItem[]; running: boolean }
  | { kind: "shell"; command: string; output: string }
)

export function isTaskTool(name: string): boolean {
  return name === "todowrite" || name === "TodoWrite"
}

export function todoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): TodoItem[] => {
    if (typeof item !== "object" || item === null) return []
    const { content, status, children } = item as Record<string, unknown>
    if (typeof content !== "string" || typeof status !== "string") return []
    return [{ content, status, children: todoItems(children) }]
  })
}

export function flattenTodos(todos: readonly TodoItem[]): TodoItem[] {
  return todos.flatMap((todo) => [todo, ...flattenTodos(todo.children)])
}

export function openTodos(todos: readonly TodoItem[]): number {
  return flattenTodos(todos).filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length
}

function taskEntry(key: string, tool: ToolPart): Entry {
  const input = tool.state.status === "streaming" ? undefined : tool.state.input
  return { key, kind: "tasks", todos: todoItems(input?.todos), running: tool.state.status === "streaming" || tool.state.status === "running" }
}

const actions: Record<string, readonly [string, string, string]> = {
  write: ["created", "a file", "files"],
  edit: ["edited", "a file", "files"], patch: ["edited", "a file", "files"], multiedit: ["edited", "a file", "files"],
  bash: ["ran", "a command", "commands"], shell: ["ran", "a command", "commands"],
  read: ["read", "a file", "files"],
  glob: ["searched", "files", "times"], grep: ["searched", "files", "times"], list: ["searched", "files", "times"],
  webfetch: ["fetched", "a page", "pages"], websearch: ["fetched", "a page", "pages"],
  task: ["ran", "a subagent", "subagents"], agent: ["ran", "a subagent", "subagents"],
}

export function workGroupLabel(tools: ToolPart[]): string {
  const groups = new Map<string, { action: readonly [string, string, string] | undefined; count: number }>()
  for (const tool of tools) {
    const action = actions[tool.name]
    const key = action ? `${action[0]} ${action[1]}` : tool.name
    groups.set(key, { action, count: (groups.get(key)?.count ?? 0) + 1 })
  }
  const label = [...groups].map(([name, { action, count }]) => {
    if (!action) return count === 1 ? name : `${name} ${count} times`
    if (count === 1) return `${action[0]} ${action[1]}`
    if (action[0] === "searched") return `searched files ${count} times`
    return `${action[0]} ${count} ${action[2]}`
  }).join(", ")
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function toolSubject(tool: ToolPart): string | undefined {
  if (tool.state.status === "streaming") return tool.state.input || undefined
  const input = tool.state.input
  for (const key of ["command", "filePath", "path", "pattern", "url", "description"]) {
    if (typeof input[key] === "string" && input[key]) return input[key]
  }
  return Object.values(input).find((value): value is string => typeof value === "string" && value.length > 0)
}

export function toolOutput(tool: ToolPart): string {
  if (tool.state.status === "error") return tool.state.error.message
  if (tool.state.status === "completed") return tool.state.content.map((part) => part.text).join("\n")
  return ""
}

export function timelineEntries(messages: Message[]): Entry[] {
  return messages.flatMap((message): Entry[] => {
    const key = `${message.id}:0`
    if (message.type === "assistant") {
      const entries: Entry[] = []
      message.content.forEach((part, index) => {
        const key = `${message.id}:${index}`
        const previous = entries[entries.length - 1]
        if (part.type === "tool" && isTaskTool(part.name)) entries.push(taskEntry(key, part))
        else if (part.type === "tool") {
          if (previous?.kind === "work") entries[entries.length - 1] = { ...previous, tools: [...previous.tools, part] }
          else entries.push({ key, kind: "work", tools: [part] })
        } else entries.push({ key, kind: part.type === "text" ? "assistant-text" : "reasoning", text: part.text })
      })
      if (message.error) entries.push({ key: `${message.id}:${message.content.length}`, kind: "error", text: message.error.message })
      return entries
    }
    if (message.type === "user") return [{ key, kind: "user", text: message.text }]
    if (message.type === "shell") return [{ key, kind: "shell", command: message.command, output: message.output?.output ?? "" }]
    if (message.type === "agent-switched") return [{ key, kind: "switch", text: `Switched to agent ${message.agent}` }]
    if (message.type === "model-switched") return [{ key, kind: "switch", text: `Switched to model ${modelLabel(message.model)}` }]
    if (message.type === "location-switched") return [{ key, kind: "switch", text: `Moved to ${message.location.directory}` }]
    if (message.type === "compaction") return [{ key, kind: "note", text: `Compaction ${message.status}: ${message.summary ?? message.reason}` }]
    if (message.type === "skill") return [{ key, kind: "note", text: `${message.name}: ${message.text}` }]
    return [{ key, kind: "note", text: message.type === "synthetic" ? message.description ?? message.text : message.text }]
  })
}
