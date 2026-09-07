import { useRef, useState } from "react"
import type { Form, FormField, FormValue, Permission } from "../types"

type Props = {
  permissions: Permission[]; forms: Form[]
  onPermission: (id: string, reply: "once" | "always" | "reject") => Promise<void>
  onForm: (id: string, answer: Record<string, FormValue>) => Promise<void>
  onCancelForm: (id: string) => Promise<void>
}

function initialAnswers(form: Form): Record<string, FormValue> {
  return Object.fromEntries(form.fields.flatMap((field): [string, FormValue][] => {
    if (field.default !== undefined) return [[field.key, field.default]]
    if (field.type === "boolean") return [[field.key, false]]
    if (field.type === "multiselect") return [[field.key, []]]
    return []
  }))
}

function validateField(field: FormField, value: FormValue | undefined): string | undefined {
  const title = field.title ?? field.key
  const missing = value === undefined || value === "" || (Array.isArray(value) && value.length === 0)
  if (missing) {
    if (field.required || (field.type === "multiselect" && (field.minItems ?? 0) > 0)) return `${title} is required.`
    return undefined
  }
  if (field.type === "number" || field.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) return `${title} must be a valid ${field.type}.`
    if (field.minimum !== undefined && value < field.minimum) return `${title} must be at least ${field.minimum}.`
    if (field.maximum !== undefined && value > field.maximum) return `${title} must be at most ${field.maximum}.`
  }
  if (field.type === "string") {
    if (typeof value !== "string" || (field.required && !value.trim())) return `${title} is required.`
    if (field.options && !field.custom && !field.options.some((option) => option.value === value)) return `Choose an option for ${title}.`
  }
  if (field.type === "multiselect") {
    if (!Array.isArray(value) || value.some((item) => !field.options.some((option) => option.value === item))) return `Choose valid options for ${title}.`
    if (value.length < (field.minItems ?? 0)) return `Choose at least ${field.minItems} options for ${title}.`
    if (field.maxItems !== undefined && value.length > field.maxItems) return `Choose at most ${field.maxItems} options for ${title}.`
  }
  return undefined
}

function Field({ field, value, onChange }: { field: FormField; value: FormValue | undefined; onChange: (value: FormValue) => void }) {
  const title = field.title ?? field.key
  if (field.type === "boolean") return <label className="approval-checkbox"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span>{title}{field.description && <small>{field.description}</small>}</span></label>
  if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : []
    return <fieldset className="approval-multiselect"><legend>{title}{field.required ? " *" : ""}</legend>
      {field.description && <p>{field.description}</p>}
      {field.options.map((option) => <label className="approval-checkbox" key={option.value}>
        <input type="checkbox" checked={selected.includes(option.value)} disabled={!selected.includes(option.value) && field.maxItems !== undefined && selected.length >= field.maxItems} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value))} />
        <span>{option.label}{option.description && <small>{option.description}</small>}</span>
      </label>)}
    </fieldset>
  }
  if (field.type === "string" && field.options) {
    const text = typeof value === "string" ? value : ""
    const selected = field.options.some((option) => option.value === text) ? text : ""
    return <div className="approval-field"><label><span>{title}{field.required ? " *" : ""}</span>
      <select value={selected} required={field.required && !field.custom} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose an option</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      {field.custom && <label><span>Custom value for {title}</span><input type="text" value={text} placeholder={field.placeholder} required={field.required} onChange={(event) => onChange(event.target.value)} /></label>}
      {field.description && <small>{field.description}</small>}
    </div>
  }
  return <label className="approval-field"><span>{title}{field.required ? " *" : ""}</span>
    {field.type === "string" ? <input type="text" value={typeof value === "string" ? value : ""} required={field.required} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} /> :
      <input type="number" value={typeof value === "number" ? value : ""} required={field.required} min={field.minimum} max={field.maximum} step={field.type === "integer" ? 1 : "any"} onChange={(event) => onChange(event.target.value === "" ? "" : event.target.valueAsNumber)} />}
    {field.description && <small>{field.description}</small>}
  </label>
}

function FormReply({ form, busy, submit, cancel }: { form: Form; busy: boolean; submit: (answer: Record<string, FormValue>) => void; cancel: () => void }) {
  const [answer, setAnswer] = useState(() => initialAnswers(form))
  const [error, setError] = useState("")
  return <form onSubmit={(event) => {
    event.preventDefault()
    const issue = form.fields.map((field) => validateField(field, answer[field.key])).find((issue) => issue !== undefined)
    setError(issue ?? "")
    if (!issue) submit(Object.fromEntries(Object.entries(answer).filter(([, value]) => value !== "")))
  }}>
    <h2>{form.title}</h2><fieldset className="approval-fields" disabled={busy}>
      {form.fields.map((field) => <Field key={field.key} field={field} value={answer[field.key]} onChange={(value) => setAnswer((current) => ({ ...current, [field.key]: value }))} />)}
    </fieldset>
    {error && <div className="component-error" role="alert">{error}</div>}
    <div className="approval-actions"><button type="submit" className="approval-primary" disabled={busy}>Submit</button><button type="button" className="approval-secondary" disabled={busy} onClick={cancel}>Cancel</button></div>
  </form>
}

function ApprovalCard({ permission, form, count, ...props }: Omit<Props, "permissions" | "forms"> & { permission: Permission | undefined; form: Form | undefined; count: number }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const locked = useRef(false)
  async function reply(action: () => Promise<void>): Promise<void> {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    try { await action() }
    catch (error) { setError(error instanceof Error ? error.message : "Could not submit reply") }
    finally { locked.current = false; setBusy(false) }
  }
  return <section className="approval-card" aria-label="Approval required" aria-busy={busy}>
    {count > 1 && <div className="approval-counter">1 of {count}</div>}
    {permission ? <><h2>{permission.action}</h2><ul className="approval-resources">{permission.resources.map((resource, index) => <li key={`${index}:${resource}`}><code>{resource}</code></li>)}</ul>
      {permission.message && <p>{permission.message}</p>}
      <div className="approval-choices">
        <button type="button" className="approval-choice primary" disabled={busy} onClick={() => void reply(() => props.onPermission(permission.id, "once"))}><strong>Approve once</strong><span>Allow only this request</span></button>
        <button type="button" className="approval-choice" disabled={busy} onClick={() => void reply(() => props.onPermission(permission.id, "always"))}><strong>Always allow</strong><span>Do not ask again for this rule</span></button>
        <button type="button" className="approval-choice danger" disabled={busy} onClick={() => void reply(() => props.onPermission(permission.id, "reject"))}><strong>Reject</strong><span>Deny this request</span></button>
      </div></> : form && <FormReply key={form.id} form={form} busy={busy} submit={(answer) => void reply(() => props.onForm(form.id, answer))} cancel={() => void reply(() => props.onCancelForm(form.id))} />}
    {error && <div className="component-error" role="alert">{error}</div>}
  </section>
}

export function Approvals(props: Props) {
  const permission = props.permissions[0]
  const form = props.forms[0]
  if (!permission && !form) return null
  return <ApprovalCard key={permission ? `permission:${permission.id}` : `form:${form?.id}`} permission={permission} form={form} count={props.permissions.length + props.forms.length} onPermission={props.onPermission} onForm={props.onForm} onCancelForm={props.onCancelForm} />
}
