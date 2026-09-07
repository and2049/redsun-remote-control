import { useCallback, useEffect, useRef, useState } from "react"
import { api, ApiError, auth, type RefreshFrame } from "./api"
import { useConnection } from "./connection"
import { makeScheduler, type RefreshResult, type Scheduler } from "./refresh"
import { applyTheme, rememberTheme, restoreTheme } from "./theme"
import { containsPrompt, creatingKey, newID, pendingPromptKey, readPending } from "./state"
import type { ActiveSessions, AgentChoice, Attachment, FormValue, Location, ModelChoice, ModelRef, PromptBody, Session, SessionSnapshot } from "./types"
import { Auth } from "./views/Auth"
import { Chat, type PendingState } from "./views/Chat"
import { Sessions } from "./views/Sessions"
import { DirectoryPrompt, Menu, NewSession, Picker, type NewSessionInput } from "./views/Sheets"

type Phase = "checking" | "signed-out" | "signed-in"
type Sheet = { kind: "new" } | { kind: "list" } | { kind: "menu" } | { kind: "move" } | { kind: "model" } | { kind: "agent" }
type CatalogState = { agents: AgentChoice[]; models: ModelChoice[]; loading: boolean; error?: string }

const backstopMs = 30_000
const refreshIntervalMs = 4000
const throttleRetryMs = 2000
const themeIntervalMs = 60_000

async function loadSnapshot(id: string, listed: Session | undefined, running: boolean, background: boolean): Promise<SessionSnapshot> {
  const [session, messages, inbox, permissions, forms] = await Promise.all([
    listed ? Promise.resolve({ data: listed }) : api.session(id, background),
    api.messages(id, { limit: "200", order: "desc" }, background),
    api.inbox(id, background),
    api.permissions(id, background),
    api.forms(id, background),
  ])
  return { session: session.data, messages: [...messages.data].reverse(), inbox: inbox.data, permissions: permissions.data, forms: forms.data, running }
}

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : "Something went wrong"
}

export function App() {
  const [phase, setPhase] = useState<Phase>("checking")
  const [sessions, setSessions] = useState<Session[]>([])
  const [active, setActive] = useState<ActiveSessions>({})
  const [selected, setSelected] = useState<string>()
  const [showingChat, setShowingChat] = useState(false)
  const [snapshot, setSnapshot] = useState<SessionSnapshot>()
  const [pending, setPending] = useState<PendingState>()
  const [sheet, setSheet] = useState<Sheet>()
  const [catalog, setCatalog] = useState<CatalogState>({ agents: [], models: [], loading: false })
  const [toast, setToast] = useState<string>()
  const selectedRef = useRef<string | undefined>(undefined)
  const backendRef = useRef("")
  const revisionRef = useRef(-1)
  const lastRefreshRef = useRef(0)
  const schedulerRef = useRef<Scheduler | undefined>(undefined)
  const themeAtRef = useRef(0)

  const report = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) {
      setPhase("signed-out")
      return
    }
    setToast(describe(failure))
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(undefined), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const cached = restoreTheme()
    if (cached) applyTheme(cached)
    auth.signedIn().then((signedIn) => setPhase(signedIn ? "signed-in" : "signed-out")).catch(report)
  }, [report])

  const syncTheme = useCallback(() => {
    themeAtRef.current = Date.now()
    api.theme().then((theme) => {
      applyTheme(theme)
      rememberTheme(theme)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (phase !== "signed-out") return
    selectedRef.current = undefined
    setSelected(undefined)
    setSnapshot(undefined)
    setPending(undefined)
    setSessions([])
    setSheet(undefined)
  }, [phase])

  const reconcile = useCallback((id: string, loaded: SessionSnapshot) => {
    const retained = readPending(sessionStorage, pendingPromptKey(backendRef.current, id))
    if (!retained) {
      setPending(undefined)
      return
    }
    if (containsPrompt(retained.id, [loaded.inbox, loaded.messages])) {
      sessionStorage.removeItem(pendingPromptKey(backendRef.current, id))
      setPending(undefined)
      return
    }
    setPending((previous) => ({ body: retained, unconfirmed: previous?.body.id === retained.id ? previous.unconfirmed : true }))
  }, [])

  const load = useCallback(async (background: boolean): Promise<RefreshResult> => {
    lastRefreshRef.current = Date.now()
    try {
      const [list, running] = await Promise.all([api.sessions({ parentID: "null", limit: "100" }, background), api.active(background)])
      setSessions(list.data)
      setActive(running.data)
      const id = selectedRef.current
      if (!id) return "ok"
      const loaded = await loadSnapshot(id, list.data.find((session) => session.id === id), id in running.data, background)
      if (selectedRef.current !== id) return "ok"
      setSnapshot(loaded)
      reconcile(id, loaded)
      return "ok"
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 429) return "throttled"
      report(failure)
      return "ok"
    }
  }, [reconcile, report])

  const loadRef = useRef(load)
  loadRef.current = load

  const refresh = useCallback(async (background: boolean) => {
    schedulerRef.current ??= makeScheduler((mode) => loadRef.current(mode), { intervalMs: refreshIntervalMs, retryMs: throttleRetryMs })
    schedulerRef.current.request(background)
  }, [])

  useEffect(() => () => schedulerRef.current?.dispose(), [])

  const select = useCallback((id: string | undefined) => {
    selectedRef.current = id
    setSelected(id)
    setSnapshot(undefined)
    setPending(undefined)
    setShowingChat(id !== undefined)
    if (id) void refresh(false)
  }, [refresh])

  const onFrame = useCallback((frame: RefreshFrame) => {
    if (backendRef.current && frame.backendID !== backendRef.current) select(undefined)
    backendRef.current = frame.backendID
    const changed = frame.revision !== revisionRef.current
    revisionRef.current = frame.revision
    if (changed || Date.now() - lastRefreshRef.current > backstopMs) void refresh(true)
    if (Date.now() - themeAtRef.current > themeIntervalMs) syncTheme()
  }, [refresh, select, syncTheme])

  const connection = useConnection(phase === "signed-in", onFrame, () => setPhase("signed-out"))

  async function send(text: string, files: Attachment[]): Promise<void> {
    const id = selectedRef.current
    if (!id) return
    const key = pendingPromptKey(backendRef.current, id)
    if (readPending(sessionStorage, key)) throw new Error("Wait for the previous prompt to be confirmed, or discard it")
    const body: PromptBody = { id: newID("msg"), text, ...(files.length ? { files } : {}) }
    sessionStorage.setItem(key, JSON.stringify(body))
    setPending({ body, unconfirmed: false })
    try {
      await api.prompt(id, body)
      sessionStorage.removeItem(key)
      setPending(undefined)
    } catch (failure) {
      const rejectedBeforeSending = failure instanceof ApiError && (failure.status === 400 || failure.status === 429)
      if (rejectedBeforeSending) {
        sessionStorage.removeItem(key)
        setPending(undefined)
        throw failure
      }
      setPending({ body, unconfirmed: true })
      report(failure)
    } finally {
      void refresh(false)
    }
  }

  function discardPending() {
    const id = selectedRef.current
    if (!id) return
    sessionStorage.removeItem(pendingPromptKey(backendRef.current, id))
    setPending(undefined)
  }

  async function create(input: NewSessionInput): Promise<void> {
    const key = creatingKey(backendRef.current)
    const previous = sessionStorage.getItem(key)
    if (previous) {
      const existing = await api.session(previous).catch(() => undefined)
      sessionStorage.removeItem(key)
      if (existing) {
        select(existing.data.id)
        return
      }
    }
    const id = newID("ses")
    sessionStorage.setItem(key, id)
    const { directory, ...rest } = input
    await api.create({ id, location: { directory }, ...rest })
    sessionStorage.removeItem(key)
    select(id)
  }

  async function act(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
    } catch (failure) {
      report(failure)
      throw failure
    } finally {
      void refresh(false)
    }
  }

  function openCatalog(kind: "model" | "agent", location: Location) {
    setSheet({ kind })
    setCatalog({ agents: [], models: [], loading: true })
    Promise.all([api.agents(location), api.models(location)])
      .then(([agents, models]) => setCatalog({ agents: agents.data, models: models.data, loading: false }))
      .catch((failure: unknown) => setCatalog({ agents: [], models: [], loading: false, error: describe(failure) }))
  }

  if (phase === "checking") return <div className="empty"><p>Loading…</p></div>
  if (phase === "signed-out") return <Auth onSignedIn={() => setPhase("signed-in")} />

  const recent = [...new Set(sessions.map((session) => session.location.directory))].slice(0, 8)
  const current = snapshot?.session
  const selectedModel = current?.model ? `${current.model.providerID}/${current.model.id}` : undefined

  return (
    <div className={`shell ${showingChat ? "showing-chat" : "showing-list"}`}>
      <Sessions sessions={sessions} active={active} selected={selected} connection={connection} onSelect={select} onNew={() => setSheet({ kind: "new" })} onMenu={() => setSheet({ kind: "list" })} />
      <main className="main">
        {snapshot ? (
          <Chat
            snapshot={snapshot}
            pending={pending}
            draftKey={`redsun/${backendRef.current}/${snapshot.session.id}/draft`}
            onBack={() => setShowingChat(false)}
            onMenu={() => setSheet({ kind: "menu" })}
            onSend={send}
            onInterrupt={() => act(() => api.interrupt(snapshot.session.id))}
            onPickModel={() => openCatalog("model", snapshot.session.location)}
            onPickAgent={() => openCatalog("agent", snapshot.session.location)}
            onDiscardPending={discardPending}
            onPermission={(id, reply) => act(() => api.permissionReply(snapshot.session.id, id, reply))}
            onForm={(id, answer: Record<string, FormValue>) => act(() => api.formReply(snapshot.session.id, id, answer))}
            onCancelForm={(id) => act(() => api.formCancel(snapshot.session.id, id))}
          />
        ) : selected ? (
          <div className="empty"><p>Loading session…</p></div>
        ) : (
          <div className="empty"><div><h2>Redsun</h2><p>Pick a session or start a new one.</p></div></div>
        )}
      </main>
      {sheet?.kind === "new" && <NewSession recent={recent} onCreate={create} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === "list" && (
        <Menu
          title={connection.message ?? connection.state}
          onClose={() => setSheet(undefined)}
          items={[
            { label: "Diagnostic page", description: "Raw operations and reconciliation", action: () => window.location.assign("/diagnostic") },
            { label: "Sign out", danger: true, action: () => void auth.logout().finally(() => setPhase("signed-out")) },
          ]}
        />
      )}
      {sheet?.kind === "menu" && current && (
        <Menu
          title="Session"
          onClose={() => setSheet(undefined)}
          items={[
            { label: "Change directory", description: current.location.directory, action: () => setSheet({ kind: "move" }) },
            { label: "Interrupt", description: "Stop the current execution", action: () => void act(() => api.interrupt(current.id)).catch(() => {}) },
            { label: "Diagnostic page", description: "Raw operations and reconciliation", action: () => window.location.assign("/diagnostic") },
            { label: "Sign out", danger: true, action: () => void auth.logout().finally(() => setPhase("signed-out")) },
          ]}
        />
      )}
      {sheet?.kind === "move" && current && (
        <DirectoryPrompt
          title="Change directory"
          action="Move"
          initial={current.location.directory}
          recent={recent}
          onSubmit={(directory) => act(() => api.move(current.id, { directory }))}
          onClose={() => setSheet(undefined)}
        />
      )}
      {sheet?.kind === "model" && current && (
        <Picker
          title="Model"
          loading={catalog.loading}
          error={catalog.error}
          selected={selectedModel}
          choices={catalog.models.map((choice) => ({ id: `${choice.providerID}/${choice.id}`, label: choice.name, description: choice.providerID }))}
          onPick={(id) => {
            const choice = catalog.models.find((candidate) => `${candidate.providerID}/${candidate.id}` === id)
            setSheet(undefined)
            if (!choice) return
            const model: ModelRef = { id: choice.id, providerID: choice.providerID }
            void act(() => api.model(current.id, model)).catch(() => {})
          }}
          onClose={() => setSheet(undefined)}
        />
      )}
      {sheet?.kind === "agent" && current && (
        <Picker
          title="Agent"
          loading={catalog.loading}
          error={catalog.error}
          selected={current.agent}
          choices={catalog.agents.map((choice) => ({ id: choice.id, label: choice.name, description: choice.mode }))}
          onPick={(id) => {
            setSheet(undefined)
            void act(() => api.agent(current.id, id)).catch(() => {})
          }}
          onClose={() => setSheet(undefined)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
