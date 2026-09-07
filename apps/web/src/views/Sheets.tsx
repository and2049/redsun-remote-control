import { useEffect, useState, type ReactNode } from "react"
import { api } from "../api"
import { CloseIcon } from "../icons"
import type { AgentChoice, ModelChoice, ModelRef } from "../types"

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export type MenuItem = { label: string; description?: string; danger?: boolean; action: () => void }

export function Menu({ title, items, onClose }: { title: string; items: MenuItem[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="menu">
        {items.map((item) => (
          <button key={item.label} style={item.danger ? { color: "var(--danger)" } : undefined} onClick={() => { onClose(); item.action() }}>
            {item.label}
            {item.description && <small>{item.description}</small>}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

type Choice = { id: string; label: string; description?: string }

export function Picker({ title, choices, selected, loading, error, onPick, onClose }: {
  title: string; choices: Choice[]; selected: string | undefined; loading: boolean; error: string | undefined
  onPick: (id: string) => void; onClose: () => void
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      {loading && <p className="notice">Loading…</p>}
      {error && <p className="notice error">{error}</p>}
      <div className="menu">
        {choices.map((choice) => (
          <button key={choice.id} className={choice.id === selected ? "selected" : ""} onClick={() => onPick(choice.id)}>
            {choice.label}
            {choice.description && <small>{choice.description}</small>}
          </button>
        ))}
      </div>
    </Sheet>
  )
}

export function DirectoryPrompt({ title, action, initial, recent, onSubmit, onClose }: {
  title: string; action: string; initial: string; recent: string[]; onSubmit: (directory: string) => Promise<void>; onClose: () => void
}) {
  const [directory, setDirectory] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  async function submit() {
    setBusy(true)
    setError(undefined)
    try {
      await onSubmit(directory.trim())
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Request failed")
      setBusy(false)
    }
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <label className="field"><span>Host directory</span><input value={directory} onChange={(event) => setDirectory(event.target.value)} list="recent-directories" autoFocus /></label>
      <datalist id="recent-directories">{recent.map((path) => <option key={path} value={path} />)}</datalist>
      <p className="notice">Paths are resolved on the host. Selecting a directory may load that project's plugins.</p>
      {error && <p className="notice error">{error}</p>}
      <div className="actions">
        <button className="button-secondary" onClick={onClose}>Cancel</button>
        <button className="button-primary" disabled={busy || !directory.trim()} onClick={submit}>{action}</button>
      </div>
    </Sheet>
  )
}

export type NewSessionInput = { directory: string; title?: string; agent?: string; model?: ModelRef }

export function NewSession({ recent, onCreate, onClose }: { recent: string[]; onCreate: (input: NewSessionInput) => Promise<void>; onClose: () => void }) {
  const [directory, setDirectory] = useState(recent[0] ?? "")
  const [title, setTitle] = useState("")
  const [agent, setAgent] = useState("")
  const [model, setModel] = useState("")
  const [agents, setAgents] = useState<AgentChoice[]>([])
  const [models, setModels] = useState<ModelChoice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    const location = directory.trim() ? { directory: directory.trim() } : undefined
    Promise.all([api.agents(location), api.models(location)])
      .then(([agentCatalog, modelCatalog]) => {
        if (cancelled) return
        setAgents(agentCatalog.data)
        setModels(modelCatalog.data)
      })
      .catch(() => { if (!cancelled) { setAgents([]); setModels([]) } })
    return () => { cancelled = true }
  }, [directory])

  async function submit() {
    setBusy(true)
    setError(undefined)
    try {
      const chosen = models.find((candidate) => `${candidate.providerID}/${candidate.id}` === model)
      await onCreate({
        directory: directory.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(agent ? { agent } : {}),
        ...(chosen ? { model: { id: chosen.id, providerID: chosen.providerID } } : {}),
      })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the session")
      setBusy(false)
    }
  }

  return (
    <Sheet title="New session" onClose={onClose}>
      <label className="field"><span>Host directory</span><input value={directory} onChange={(event) => setDirectory(event.target.value)} list="recent-directories" placeholder="C:\projects\app" autoFocus /></label>
      <datalist id="recent-directories">{recent.map((path) => <option key={path} value={path} />)}</datalist>
      <label className="field"><span>Title (optional)</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="field"><span>Agent</span>
        <select value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="">Default</option>
          {agents.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
        </select>
      </label>
      <label className="field"><span>Model</span>
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          <option value="">Default</option>
          {models.map((choice) => <option key={`${choice.providerID}/${choice.id}`} value={`${choice.providerID}/${choice.id}`}>{choice.name}</option>)}
        </select>
      </label>
      {error && <p className="notice error">{error}</p>}
      <div className="actions">
        <button className="button-secondary" onClick={onClose}>Cancel</button>
        <button className="button-primary" disabled={busy || !directory.trim()} onClick={submit}>Create</button>
      </div>
    </Sheet>
  )
}
