import { useState } from "react"
import { auth } from "../api"

type Registration = { requestID: string; fingerprint: string }

export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [registration, setRegistration] = useState<Registration>()

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <h1>redsun</h1>
        <p>Sign in with the passkey enrolled for this host.</p>
        <button className="button-primary" disabled={busy} onClick={() => run(async () => { await auth.login(); onSignedIn() })}>Sign in with passkey</button>
        <button className="button-secondary" disabled={busy} onClick={() => run(async () => setRegistration(await auth.register()))}>Register this device</button>
        {registration && (
          <div className="fingerprint">
            <p>Compare this fingerprint with the host, then approve it there. Registration alone does not sign you in.</p>
            <div className="mono">{registration.requestID}</div>
            <div className="mono">{registration.fingerprint}</div>
          </div>
        )}
        {error && <p className="notice error">{error}</p>}
      </div>
    </div>
  )
}
