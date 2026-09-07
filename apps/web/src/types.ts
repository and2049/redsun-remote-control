export type Location = { directory: string; workspaceID?: string }
export type ModelRef = { id: string; providerID: string; variant?: string }
export type Delivery = "steer" | "queue"

export type Session = {
  id: string
  parentID?: string
  title?: string
  agent?: string
  model?: ModelRef
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number; archived?: number }
  location: Location
  subpath?: string
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

export type Page<T> = { data: T[]; cursor?: { previous?: string; next?: string } }
export type ActiveSessions = Record<string, { type: "running" }>

export type ToolContent = { type: "text"; text: string }
export type ToolState =
  | { status: "streaming"; input: string }
  | { status: "running"; input: Record<string, unknown> }
  | { status: "completed"; input: Record<string, unknown>; content: ToolContent[] }
  | { status: "error"; input: Record<string, unknown>; error: { type: string; message: string } }

export type AssistantPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; state: ToolState; executed?: boolean; time: { created: number; ran?: number; completed?: number } }

type Base = { id: string; time: { created: number } }
export type Message =
  | (Base & { type: "user"; text: string })
  | (Base & { type: "assistant"; agent?: string; model?: ModelRef; finish?: string; error?: { type: string; message: string }; content: AssistantPart[] })
  | (Base & { type: "synthetic"; text: string; description?: string })
  | (Base & { type: "system"; text: string })
  | (Base & { type: "skill"; name: string; text: string })
  | (Base & { type: "shell"; command: string; status: string; exit?: number; output?: { output: string; truncated: boolean } })
  | (Base & { type: "agent-switched"; agent: string; previous?: string })
  | (Base & { type: "model-switched"; model: ModelRef; previous?: ModelRef })
  | (Base & { type: "location-switched"; location: Location })
  | (Base & { type: "compaction"; status: "running" | "completed" | "failed"; reason: string; summary?: string })

export type InboxItem = { id: string; sessionID: string; timeCreated: number; delivery: Delivery } & (
  | { type: "user"; payload: { text: string } }
  | { type: "synthetic"; payload: { text: string; description?: string } }
  | { type: "compaction"; payload: Record<string, never> }
  | { type: "move"; payload: { location: Location } }
)

export type Permission = {
  id: string
  sessionID: string
  action: string
  resources: string[]
  save?: string[]
  message?: string
}

export type FormOption = { value: string; label: string; description?: string }
export type FormField = { key: string; title?: string; description?: string; required?: boolean } & (
  | { type: "string"; placeholder?: string; default?: string; options?: FormOption[]; custom?: boolean }
  | { type: "number" | "integer"; minimum?: number; maximum?: number; default?: number }
  | { type: "boolean"; default?: boolean }
  | { type: "multiselect"; options: FormOption[]; minItems?: number; maxItems?: number; default?: string[] }
)
export type FormValue = string | number | boolean | string[]
export type Form = { id: string; sessionID: string; title: string; fields: FormField[] }

export type AgentChoice = { id: string; name: string; mode: string }
export type ModelChoice = { id: string; providerID: string; name: string; variants: { id: string }[] }
export type Catalog<T> = { location: Location; data: T[] }

export type Attachment = { uri: string; name?: string }
export type PromptBody = { id: string; text: string; files?: Attachment[]; delivery?: Delivery }

export type SessionSnapshot = {
  session: Session
  messages: Message[]
  inbox: InboxItem[]
  permissions: Permission[]
  forms: Form[]
  running: boolean
}

type Hex = string
type Feedback = { error: Hex; warning: Hex; success: Hex; info: Hex }
type Actions = { primary: Hex; secondary: Hex; destructive: Hex }
export type Theme = {
  name: string
  mode: "light" | "dark"
  colors: {
    text: { default: Hex; subdued: Hex; action: Actions; status: { running: Hex; question: Hex; permission: Hex; unread: Hex }; feedback: Feedback }
    background: { default: Hex; offset: Hex; overlay: Hex; action: Actions; feedback: Feedback }
    border: { default: Hex }
    diff: { added: Hex; removed: Hex }
    markdown: Record<"text" | "heading" | "link" | "linkText" | "code" | "blockQuote" | "emphasis" | "strong" | "horizontalRule" | "listItem" | "listEnumeration" | "image" | "imageText" | "codeBlock", Hex>
  }
}
