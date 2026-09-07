import { useEffect, useRef, useState } from "react"
import { acceptedTypes, attachmentBudget, toDataURI, validateAttachments } from "../composer"
import { modelLabel } from "../state"
import type { Attachment, ModelRef } from "../types"

type Props = {
  disabled: boolean; running: boolean; model: ModelRef | undefined; agent: string | undefined; draftKey: string
  onSend: (text: string, files: Attachment[]) => Promise<void>
  onInterrupt: () => Promise<void>; onPickModel: () => void; onPickAgent: () => void
}

function readDraft(key: string): string {
  try { return sessionStorage.getItem(key) ?? "" } catch { return "" }
}

function storeDraft(key: string, text: string): void {
  try {
    if (text) sessionStorage.setItem(key, text)
    else sessionStorage.removeItem(key)
  } catch {}
}

function readFile(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onabort = () => reject(new Error("File reading cancelled"))
    reader.onload = () => {
      try {
        if (typeof reader.result !== "string" || !reader.result.includes(",")) throw new Error("Invalid file data")
        resolve({ name: file.name, uri: toDataURI(file.type, reader.result.slice(reader.result.indexOf(",") + 1)) })
      } catch (error) { reject(error) }
    }
    reader.readAsDataURL(file)
  })
}

function Icon({ kind }: { kind: "plus" | "send" | "stop" | "remove" }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    {kind === "stop" ? <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" /> :
      <path d={kind === "plus" ? "M12 5v14M5 12h14" : kind === "send" ? "M12 19V5m-6 6 6-6 6 6" : "m6 6 12 12M6 18 18 6"} />}
  </svg>
}

export function Composer(props: Props) {
  return <DraftComposer key={props.draftKey} {...props} />
}

function DraftComposer(props: Props) {
  const [text, setText] = useState(() => readDraft(props.draftKey))
  const [files, setFiles] = useState<Attachment[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [stopping, setStopping] = useState(false)
  const locked = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const unavailable = props.disabled || busy || reading

  useEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = "auto"
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 26
    element.style.height = `${Math.min(element.scrollHeight, lineHeight * 8)}px`
  }, [text])

  function updateText(value: string): void {
    setText(value)
    storeDraft(props.draftKey, value)
  }

  async function send(): Promise<void> {
    if (unavailable || locked.current || !text.trim()) return
    if (new TextEncoder().encode(JSON.stringify({ text, files })).length > attachmentBudget - 1024) {
      setError("Message and attachments exceed the 6 MiB request limit.")
      return
    }
    locked.current = true
    setBusy(true)
    setError("")
    try {
      await props.onSend(text, files)
      updateText("")
      setFiles([])
    } catch (error) { setError(error instanceof Error ? error.message : "Could not send message") }
    finally { locked.current = false; setBusy(false) }
  }

  async function attach(incoming: File[]): Promise<void> {
    if (unavailable || locked.current) return
    const issue = validateAttachments(files, incoming)
    if (issue) { setError(issue); return }
    locked.current = true
    setReading(true)
    setError("")
    try {
      const added = await Promise.all(incoming.map(readFile))
      const combined = [...files, ...added]
      const issue = validateAttachments(combined, [])
      if (issue) setError(issue)
      else setFiles(combined)
    } catch (error) { setError(error instanceof Error ? error.message : "Could not read attachments") }
    finally { locked.current = false; setReading(false) }
  }

  async function interrupt(): Promise<void> {
    if (stopping) return
    setStopping(true)
    setError("")
    try { await props.onInterrupt() }
    catch (error) { setError(error instanceof Error ? error.message : "Could not interrupt") }
    finally { setStopping(false) }
  }

  return <div className="composer-card">
    {files.length > 0 && <div className="attachment-chips">{files.map((file, index) => <div className="attachment-chip" key={`${index}:${file.name}`}>
      {file.uri.startsWith("data:image/") && <img src={file.uri} alt={file.name ?? "Attachment"} />}
      <span>{file.name ?? "Attachment"}</span><button type="button" aria-label={`Remove ${file.name ?? "attachment"}`} disabled={unavailable} onClick={() => setFiles(files.filter((_, position) => position !== index))}><Icon kind="remove" /></button>
    </div>)}</div>}
    <textarea ref={textarea} rows={1} aria-label="Message redsun" placeholder="Message redsun" value={text} disabled={props.disabled || busy} onChange={(event) => updateText(event.target.value)} onKeyDown={(event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
        event.preventDefault()
        void send()
      }
    }} />
    {error && <div className="component-error" role="alert">{error}</div>}
    <div className="composer-toolbar">
      <input ref={fileInput} type="file" hidden multiple accept={acceptedTypes.join(",")} onChange={(event) => { const selected = Array.from(event.target.files ?? []); event.target.value = ""; void attach(selected) }} />
      <button type="button" className="composer-round" aria-label="Add attachments" disabled={unavailable} onClick={() => fileInput.current?.click()}><Icon kind="plus" /></button>
      <button type="button" className="composer-pill" disabled={unavailable} onClick={props.onPickAgent}>{props.agent ?? "Default agent"}</button>
      <button type="button" className="composer-pill composer-model" disabled={unavailable} onClick={props.onPickModel}>{modelLabel(props.model)}</button>
      <div className="composer-actions">
        {props.running && <button type="button" className="composer-round" aria-label="Stop generation" disabled={props.disabled || stopping} onClick={() => void interrupt()}><Icon kind="stop" /></button>}
        <button type="button" className="composer-round composer-send" aria-label="Send message" disabled={unavailable || !text.trim()} onClick={() => void send()}><Icon kind="send" /></button>
      </div>
    </div>
  </div>
}
