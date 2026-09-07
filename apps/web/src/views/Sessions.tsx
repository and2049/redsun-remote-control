import { PlusIcon } from "../icons"
import { bucketSessions, directoryName, relativeTime, sessionTitle } from "../state"
import type { ActiveSessions, Session } from "../types"

export type Connection = { state: "connecting" | "connected" | "disconnected"; message?: string }

type Props = {
  sessions: Session[]
  active: ActiveSessions
  selected: string | undefined
  connection: Connection
  onSelect: (id: string) => void
  onNew: () => void
}

export function Sessions({ sessions, active, selected, connection, onSelect, onNew }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Redsun</h1>
        <button className="icon-button" aria-label="New session" onClick={onNew}><PlusIcon /></button>
      </div>
      <div className="session-list">
        {sessions.length === 0 && <p className="notice" style={{ padding: "0.5rem 0.75rem" }}>No sessions yet.</p>}
        {bucketSessions(sessions).map((bucket) => (
          <div key={bucket.label}>
            <div className="session-group">{bucket.label}</div>
            {bucket.sessions.map((session) => (
              <button key={session.id} className={`session-row${session.id === selected ? " selected" : ""}`} onClick={() => onSelect(session.id)}>
                <span className="title">{session.id in active && <span className="running" />}{sessionTitle(session)}</span>
                <span className="time">{relativeTime(session.time.updated)}</span>
                <span className="meta">{directoryName(session.location.directory)}{session.agent ? ` · ${session.agent}` : ""}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <span><span className={`status-dot ${connection.state === "connected" ? "connected" : connection.state === "disconnected" ? "error" : ""}`} />{connection.message ?? connection.state}</span>
      </div>
    </aside>
  )
}
