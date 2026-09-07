import type {
  ActiveSessions, AgentChoice, Catalog, Delivery, Form, FormValue, InboxItem, Location, Message, ModelChoice, ModelRef, Page, Permission,
  PromptBody, Session, Theme,
} from "./types"

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(0, "Invalid response")
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(0, "Invalid response text")
  return value
}

async function post(path: string, body: unknown = {}, background = false): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(background ? { "X-Redsun-Activity": "background" } : {}) },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  })
  if (!response.ok) throw new ApiError(response.status, describe(response.status))
  return response.status === 204 ? null : response.json()
}

function describe(status: number): string {
  if (status === 401) return "Not signed in"
  if (status === 429) return "Too many requests; wait a moment"
  if (status === 503) return "The backend refused or could not complete the request"
  return `Request failed (${status})`
}

type Query = Record<string, string>
type CallOptions = { query?: Query; body?: unknown; background?: boolean }

async function call<T>(method: "GET" | "POST", path: string, options: CallOptions = {}): Promise<T> {
  const operation = {
    method,
    path,
    ...(options.query ? { query: options.query } : {}),
    ...(options.body === undefined ? {} : { body: options.body }),
  }
  return (await post("/control/request", operation, options.background)) as T
}

function locationQuery(location?: Location): Query {
  return location ? { "location[directory]": location.directory, ...(location.workspaceID ? { "location[workspace]": location.workspaceID } : {}) } : {}
}

async function webauthnCreate(options: unknown): Promise<PublicKeyCredential> {
  if (!PublicKeyCredential.parseCreationOptionsFromJSON) throw new ApiError(0, "This browser lacks WebAuthn JSON support")
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options as PublicKeyCredentialCreationOptionsJSON)
  const credential = await navigator.credentials.create({ publicKey })
  if (!(credential instanceof PublicKeyCredential)) throw new ApiError(0, "Registration cancelled")
  return credential
}

async function webauthnGet(options: unknown): Promise<PublicKeyCredential> {
  if (!PublicKeyCredential.parseRequestOptionsFromJSON) throw new ApiError(0, "This browser lacks WebAuthn JSON support")
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(options as PublicKeyCredentialRequestOptionsJSON)
  const credential = await navigator.credentials.get({ publicKey })
  if (!(credential instanceof PublicKeyCredential)) throw new ApiError(0, "Login cancelled")
  return credential
}

export const auth = {
  async signedIn(): Promise<boolean> {
    try {
      await post("/auth/session")
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return false
      throw error
    }
  },
  async register(): Promise<{ requestID: string; fingerprint: string }> {
    await post("/auth/binding")
    const value = record(await post("/auth/register/options"))
    const credential = await webauthnCreate(value.options)
    const proof = record(await post("/auth/register/verify", { requestID: value.requestID, response: credential.toJSON() }))
    return { requestID: text(proof.requestID), fingerprint: text(proof.fingerprint) }
  },
  async login(): Promise<void> {
    await post("/auth/binding")
    const value = record(await post("/auth/login/options"))
    const credential = await webauthnGet(value.options)
    await post("/auth/login/verify", { ceremonyID: value.ceremonyID, response: credential.toJSON() })
  },
  logout: () => post("/auth/logout"),
}

export const api = {
  sessions: (query: Query = {}, background = false) => call<Page<Session>>("GET", "/api/session", { query, background }),
  session: (id: string, background = false) => call<{ data: Session }>("GET", `/api/session/${id}`, { background }),
  messages: (id: string, query: Query = {}, background = false) => call<Page<Message>>("GET", `/api/session/${id}/message`, { query, background }),
  inbox: (id: string, background = false) => call<{ data: InboxItem[] }>("GET", `/api/session/${id}/inbox`, { background }),
  permissions: (id: string, background = false) => call<{ data: Permission[] }>("GET", `/api/session/${id}/permission`, { background }),
  forms: (id: string, background = false) => call<{ data: Form[] }>("GET", `/api/session/${id}/form`, { background }),
  active: (background = false) => call<{ data: ActiveSessions }>("GET", "/api/session/active", { background }),
  agents: (location?: Location) => call<Catalog<AgentChoice>>("GET", "/api/remote/agent", { query: locationQuery(location) }),
  models: (location?: Location) => call<Catalog<ModelChoice>>("GET", "/api/remote/model", { query: locationQuery(location) }),
  location: (directory: string) => call<Location>("GET", "/api/location", { query: locationQuery({ directory }) }),
  theme: () => call<Theme>("GET", "/api/remote/theme", { background: true }),
  create: (body: { id: string; title?: string; agent?: string; model?: ModelRef; location?: Location }) =>
    call<{ data: Session }>("POST", "/api/session", { body }),
  prompt: (id: string, body: PromptBody) => call<unknown>("POST", `/api/session/${id}/prompt`, { body }),
  interrupt: (id: string) => call<{ interrupted: boolean }>("POST", `/api/session/${id}/interrupt`, { body: {} }),
  move: (id: string, location: Location, delivery?: Delivery) =>
    call<null>("POST", `/api/session/${id}/move`, { body: { ...location, ...(delivery ? { delivery } : {}) } }),
  agent: (id: string, agent: string) => call<null>("POST", `/api/session/${id}/agent`, { body: { agent } }),
  model: (id: string, model: ModelRef) => call<null>("POST", `/api/session/${id}/model`, { body: { model } }),
  permissionReply: (id: string, requestID: string, reply: "once" | "always" | "reject", message?: string) =>
    call<null>("POST", `/api/session/${id}/permission/${requestID}/reply`, { body: { reply, ...(message ? { message } : {}) } }),
  formReply: (id: string, formID: string, answer: Record<string, FormValue>) =>
    call<null>("POST", `/api/session/${id}/form/${formID}/reply`, { body: { answer } }),
  formCancel: (id: string, formID: string) => call<null>("POST", `/api/session/${id}/form/${formID}/cancel`, { body: {} }),
}

export type RefreshFrame = { backendID: string; revision: number }

export async function events(onRefresh: (frame: RefreshFrame) => void, signal: AbortSignal): Promise<never> {
  const response = await fetch("/control/events", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", credentials: "same-origin", signal,
  })
  if (!response.ok || !response.body) throw new ApiError(response.status, describe(response.status))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) throw new ApiError(0, "Connection closed")
      buffer += decoder.decode(part.value, { stream: true })
      let end: number
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (!frame.startsWith("data: ")) continue
        const value = record(JSON.parse(frame.slice(6)))
        if (typeof value.revision !== "number") throw new ApiError(0, "Invalid event stream")
        onRefresh({ backendID: text(value.backendID), revision: value.revision })
      }
      if (buffer.length > 16384) throw new ApiError(0, "Invalid event stream")
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}
