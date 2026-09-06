import { containsPrompt, pendingPromptKey } from "./diagnostic-state"

function element(id: string): HTMLElement {
  const value = document.getElementById(id)
  if (!value) throw new Error("Missing diagnostic element")
  return value
}
function input(id: string): HTMLInputElement | HTMLTextAreaElement {
  const value = element(id)
  if (!(value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement)) throw new Error("Invalid input")
  return value
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response")
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid response text")
  return value
}
function show(value: unknown): void { element("output").textContent = JSON.stringify(value, null, 2) }
function notice(message: string): void { element("notice").textContent = message }
async function post(path: string, body: unknown = {}, background = false): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json", ...(background ? { "X-Redsun-Activity": "background" } : {}) },
    body: JSON.stringify(body), cache: "no-store", credentials: "same-origin",
  })
  if (!response.ok) throw new Error(`Request failed (${response.status}). A write may have been admitted; do not blindly retry.`)
  return response.status === 204 ? null : response.json()
}
const call = (method: "GET" | "POST", path: string, body?: unknown, background = false) => post("/control/request", {
  method, path, ...(body === undefined ? {} : { body }),
}, background)
let backendID = ""
let stream: AbortController | undefined
let refreshing = false
let dirty = false
function session(): string {
  const id = input("session").value.trim()
  if (!/^ses_[A-Za-z0-9_-]+$/.test(id)) throw new Error("Enter a session ID")
  return id
}
function pendingKey(): string {
  return pendingPromptKey(backendID, session())
}
async function snapshot(background = false): Promise<void> {
  if (refreshing) { dirty = true; return }
  refreshing = true
  try {
    do {
      dirty = false
      const selected = input("session").value.trim()
      if (!selected) { show(await call("GET", "/api/session", undefined, background)); continue }
      const path = `/api/session/${session()}`
      const values: Record<string, unknown> = {}
      for (const name of ["message", "inbox", "permission", "form"]) values[name] = await call("GET", `${path}/${name}`, undefined, background)
      show(values)
    } while (dirty)
  } finally { refreshing = false }
}
async function connect(): Promise<void> {
  stream?.abort()
  const controller = new AbortController()
  stream = controller
  const response = await fetch("/control/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal })
  if (!response.ok || !response.body) throw new Error(`Stream unavailable (${response.status}); log in and reconnect`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) throw new Error("Connection closed. Log in and reconnect; pending writes are retained.")
      buffer += decoder.decode(part.value, { stream: true })
      let end: number
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = record(JSON.parse(frame.slice(6)))
        const id = text(event.backendID)
        if (backendID && id !== backendID) { input("session").value = ""; input("prompt").value = "" }
        backendID = id
        notice(`Connected to backend ${id}. Pending prompts are retained per backend and session.`)
        void snapshot(true).catch((error: unknown) => notice(error instanceof Error ? error.message : "Refresh failed"))
      }
      if (buffer.length > 16384) throw new Error("Invalid event stream")
    }
  } finally { await reader.cancel().catch(() => {}) }
}
function action(id: string, run: () => Promise<void>): void {
  element(id).addEventListener("click", () => {
    void run().catch((error: unknown) => notice(error instanceof Error ? error.message : "Operation failed"))
  })
}
action("register", async () => {
  await post("/auth/binding")
  const value = record(await post("/auth/register/options"))
  if (!PublicKeyCredential.parseCreationOptionsFromJSON) throw new Error("This diagnostic requires a browser with WebAuthn JSON support")
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(value.options as PublicKeyCredentialCreationOptionsJSON)
  const credential = await navigator.credentials.create({ publicKey })
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Registration cancelled")
  const proof = await post("/auth/register/verify", { requestID: value.requestID, response: credential.toJSON() })
  notice(`Compare and approve locally, then log in:\n${JSON.stringify(proof, null, 2)}`)
})
action("login", async () => {
  await post("/auth/binding")
  const value = record(await post("/auth/login/options"))
  if (!PublicKeyCredential.parseRequestOptionsFromJSON) throw new Error("This diagnostic requires a browser with WebAuthn JSON support")
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(value.options as PublicKeyCredentialRequestOptionsJSON)
  const credential = await navigator.credentials.get({ publicKey })
  if (!(credential instanceof PublicKeyCredential)) throw new Error("Login cancelled")
  await post("/auth/login/verify", { ceremonyID: value.ceremonyID, response: credential.toJSON() })
  notice("Logged in. Select Connect / refresh to subscribe before loading state.")
})
action("logout", async () => { await post("/auth/logout"); stream?.abort(); show(null); notice("Logged out") })
action("connect", connect)
action("list", async () => show(await call("GET", "/api/session")))
action("snapshot", () => snapshot())
action("interrupt", async () => show(await call("POST", `/api/session/${session()}/interrupt`, {})))
action("create", async () => {
  if (!backendID) throw new Error("Connect to a verified backend first")
  const key = `redsun-diagnostic/${backendID}/creating`
  const previous = sessionStorage.getItem(key)
  if (previous) {
    const result = record(await call("GET", `/api/session/${previous}`))
    input("session").value = text(record(result.data).id)
    sessionStorage.removeItem(key)
    show(result)
    return
  }
  const id = `ses_${crypto.randomUUID().replaceAll("-", "")}`
  sessionStorage.setItem(key, id)
  const result = await call("POST", "/api/session", { id, location: { directory: input("directory").value } })
  input("session").value = id
  sessionStorage.removeItem(key)
  show(result)
})
action("send", async () => {
  const key = pendingKey()
  const previous = sessionStorage.getItem(key)
  if (previous) throw new Error(`Reconcile the previous prompt first: ${previous}`)
  const body = { id: `msg_${crypto.randomUUID().replaceAll("-", "")}`, text: input("prompt").value }
  sessionStorage.setItem(key, JSON.stringify(body))
  notice(`Submitting ${body.id}; retained until acknowledgement or reconciliation`)
  show(await call("POST", `/api/session/${session()}/prompt`, body))
  sessionStorage.removeItem(key)
  input("prompt").value = ""
})
action("reconcile", async () => {
  const key = pendingKey()
  const pending = sessionStorage.getItem(key)
  if (!pending) { notice("No retained pending prompt for this backend/session"); return }
  const id = text(record(JSON.parse(pending)).id)
  const path = `/api/session/${session()}`
  const inbox = record(await call("GET", `${path}/inbox`))
  const history = record(await call("GET", `${path}/message`))
  const found = containsPrompt(id, [inbox.data, history.data])
  if (found) sessionStorage.removeItem(key)
  notice(found ? `Confirmed ${id}; no resend was made` : `Still uncertain: ${id}. Inspect additional history pages or local redsun; do not replace its ID.`)
  show({ inbox, history })
})
action("execute", async () => show(await post("/control/request", JSON.parse(input("operation").value))))
window.addEventListener("pagehide", () => stream?.abort())
