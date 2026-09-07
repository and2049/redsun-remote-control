import { useState } from "react"
import { MenuIcon, PlusIcon, SearchIcon } from "../icons"
import { directoryName, relativeTime, sessionTitle } from "../state"
import type { ActiveSessions, Session } from "../types"

export type Connection = { state: "connecting" | "connected" | "disconnected"; message?: string }

type Props = {
  sessions: Session[]
  active: ActiveSessions
  selected: string | undefined
  connection: Connection
  onSelect: (id: string) => void
  onNew: () => void
  onMenu: () => void
}

export function matchesSearch(session: Session, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return `${sessionTitle(session)} ${session.location.directory} ${session.agent ?? ""}`.toLowerCase().includes(needle)
}

export function sessionMeta(session: Session, now = Date.now()): string {
  const parts = [relativeTime(session.time.updated, now), directoryName(session.location.directory), session.agent]
  return parts.filter((part) => part).join(" · ")
}

export function Sessions({ sessions, active, selected, connection, onSelect, onNew, onMenu }: Props) {
  const [query, setQuery] = useState<string>()
  const visible = sessions.filter((session) => matchesSearch(session, query ?? ""))
  return (
    <aside className="sidebar">
      <header className="floating-header list-header">
        <button className="icon-button" aria-label="Menu" onClick={onMenu}>
          <MenuIcon />
          <span className={`badge ${connection.state}`} aria-label={connection.message ?? connection.state} />
        </button>
        <h1>redsun</h1>
        <button className={`icon-button${query === undefined ? "" : " active"}`} aria-label="Search sessions" onClick={() => setQuery(query === undefined ? "" : undefined)}><SearchIcon /></button>
      </header>
      {query !== undefined && <input className="search" type="search" placeholder="Search sessions" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />}
      <div className="session-list">
        <div className="section-label">Sessions</div>
        {visible.length === 0 && <p className="notice">{sessions.length === 0 ? "No sessions yet." : "No matching sessions."}</p>}
        {visible.map((session) => (
          <button key={session.id} className={`session-row${session.id === selected ? " selected" : ""}`} onClick={() => onSelect(session.id)}>
            <span className={`dot${session.id in active ? " running" : ""}`} aria-label={session.id in active ? "Running" : undefined} />
            <span className="row-text">
              <span className="title">{sessionTitle(session)}</span>
              <span className="meta">{sessionMeta(session)}</span>
            </span>
          </button>
        ))}
      </div>
      <button className="fab" onClick={onNew}><PlusIcon /> New session</button>
    </aside>
  )
}
