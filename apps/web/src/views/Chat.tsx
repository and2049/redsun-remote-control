import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Approvals } from "../components/Approvals"
import { Composer } from "../components/Composer"
import { Timeline } from "../components/Timeline"
import { BackIcon, DownIcon, MoreIcon } from "../icons"
import { modelLabel, sessionTitle } from "../state"
import type { Attachment, FormValue, PromptBody, SessionSnapshot } from "../types"

export type PendingState = { body: PromptBody; unconfirmed: boolean }

type Props = {
  snapshot: SessionSnapshot
  pending: PendingState | undefined
  draftKey: string
  onBack: () => void
  onMenu: () => void
  onSend: (text: string, files: Attachment[]) => Promise<void>
  onInterrupt: () => Promise<void>
  onPickModel: () => void
  onPickAgent: () => void
  onDiscardPending: () => void
  onPermission: (id: string, reply: "once" | "always" | "reject") => Promise<void>
  onForm: (id: string, answer: Record<string, FormValue>) => Promise<void>
  onCancelForm: (id: string) => Promise<void>
}

export function Chat(props: Props) {
  const { snapshot, pending } = props
  const scroller = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const lastMessage = snapshot.messages[snapshot.messages.length - 1]
  const contentKey = `${snapshot.session.id}:${snapshot.messages.length}:${lastMessage?.id ?? ""}:${snapshot.inbox.length}:${pending?.body.id ?? ""}:${snapshot.running}`

  function scrollToBottom() {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }

  useLayoutEffect(() => {
    if (atBottom) scrollToBottom()
  }, [contentKey])

  useEffect(() => {
    setAtBottom(true)
    scrollToBottom()
  }, [snapshot.session.id])

  function onScroll() {
    const element = scroller.current
    if (!element) return
    setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 48)
  }

  return (
    <section className="chat">
      <header className="chat-header">
        <button className="icon-button back" aria-label="Back to sessions" onClick={props.onBack}><BackIcon /></button>
        <div className="heading">
          <strong>{sessionTitle(snapshot.session)}</strong>
          <small>{snapshot.session.agent ?? modelLabel(snapshot.session.model)}</small>
        </div>
        <button className="icon-button" aria-label="Session menu" onClick={props.onMenu}><MoreIcon /></button>
      </header>
      <div className="transcript" ref={scroller} onScroll={onScroll}>
        <div className="transcript-column">
          <Timeline messages={snapshot.messages} inbox={snapshot.inbox} running={snapshot.running} {...(pending ? { pending: pending.body } : {})} />
        </div>
      </div>
      <div className="composer-dock">
        {!atBottom && <button className="icon-button scroll-to-bottom" aria-label="Scroll to latest" onClick={() => { setAtBottom(true); scrollToBottom() }}><DownIcon /></button>}
        <div className="composer-column">
          {pending?.unconfirmed && (
            <div className="pending-notice">
              <span>The last prompt was not confirmed. It is retained until it appears in history.</span>
              <button className="button-secondary" onClick={props.onDiscardPending}>Discard</button>
            </div>
          )}
          <Approvals permissions={snapshot.permissions} forms={snapshot.forms} onPermission={props.onPermission} onForm={props.onForm} onCancelForm={props.onCancelForm} />
          <Composer
            disabled={pending !== undefined}
            running={snapshot.running}
            model={snapshot.session.model}
            agent={snapshot.session.agent}
            draftKey={props.draftKey}
            onSend={props.onSend}
            onInterrupt={props.onInterrupt}
            onPickModel={props.onPickModel}
            onPickAgent={props.onPickAgent}
          />
        </div>
      </div>
    </section>
  )
}
