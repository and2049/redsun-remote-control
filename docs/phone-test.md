# Phone diagnostic preflight and smoke test

The companion now has an explicit diagnostic mode with passkey authentication,
allowlisted remote operations, scoped backend events and browser-stream revocation.
In `serve --backend` mode, the product web app is served at `/` and the diagnostic
page remains available at `/diagnostic`.
Its end-to-end CLI tests use signed authenticator fixtures and a synthetic redsun
HTTP/SSE server. On 2026-09-06 an iPhone using Safari connected through Tailscale Serve,
registered a passkey, received local fingerprint approval, logged in and reached
"Connected to backend" against the local source redsun service on Windows. This
verifies connection and authentication, not every operation or deployment platform.

## Preflight requiring local authorization

1. Verify the running redsun has the pinned v1 remote-control integration, or review
   an updated compatible contract. Do not start, stop or replace the installed service
   as an implicit setup step. Source-branch integration is not proof the installed
   service contains it.
2. Explicitly enroll/enable RC on that service and import the private handoff using
   the commands in the backend attachment guide. No enrollment or enablement was
   performed during companion implementation.
3. Run `bun run dev check-backend`. This must pass before exposing the companion.
   Redsun commit `a02bda3a0b` publishes the `.remote` discovery sidecar with a protected
   owner-only ACL; a service started from an older checkout inherits the state
   directory's Windows ACL and fails discovery as unavailable. Do not silently repair
   files or relax companion checks; fix the backend and restart it explicitly.
4. Select the HTTPS origin supplied by the redsun host and an unused IPv4 loopback
   port. The host owns the public listener: its OpenTunnel route terminates TLS in the
   redsun service process and forwards plain HTTP to the companion on loopback.
   Verify that route separately. The companion never configures networking.

New deployments and additional live policy/service changes still need these approvals
and environment checks; the first phone connection has completed this preflight.
No machine-specific settings, handoffs or private hostnames belong in this repository.

## Automated host-side run

```text
bun run phone-test --origin https://host.example [--port <loopback-port>]
```

The script requires an explicit HTTPS origin and defaults to port 43123. It runs
`check-backend`, starts `serve --backend` on IPv4 loopback and prints phone steps.
It does not inspect or configure the host's tunnel, TLS, public listener, service
policy or backend lifecycle. Set up and verify the host route and backend separately,
with explicit local authorization. The host must preserve the configured Host and
browser Origin headers.

While the companion runs, the script relays typed local commands. On first use it
sends `enroll` and polls `pending`, then prints the exact
`approve <requestID> <fingerprint>` line. Compare the complete fingerprint with the
phone before typing it; the script never approves on its own. Typing `enroll`
reopens the five-minute window. Ctrl+C stops the companion.

## Foreground diagnostic run

Substitute the selected origin and port:

```text
bun run dev serve --origin https://host.example --port 43123 --backend
```

Keep this process and its local stdin open. It loads protected backend enrollment,
subscribes to scoped events, verifies status and sends heartbeats every ten seconds.
Network operations and initial event readiness have five-second deadlines. Transient
unavailability retries after three seconds with fresh discovery. Authorization,
identity or contract failure stops that supervisor instance: correct the problem
locally and restart the companion, without implicitly restarting redsun.

Plain `bun run dev` still exposes only loopback health. `serve` without `--backend`
still provides authentication only. No mode configures TLS, a tunnel, a public listener or redsun.

The redsun host must forward its HTTPS route to `http://127.0.0.1:43123`
(or the chosen port), preserving the configured Host and browser Origin. The
companion intentionally rejects mismatches and never binds off loopback.

## Phone sequence

1. Reach the host HTTPS origin and open `/diagnostic` at the selected HTTPS origin. A modern
   browser supporting WebAuthn JSON helpers (`parseCreationOptionsFromJSON`,
   `parseRequestOptionsFromJSON`, and credential `toJSON`) is required by this testing
   page. Unsupported browsers receive a diagnostic error; no insecure login fallback
   exists. This flow has worked on iPhone Safari; broader browser support is unverified.
2. At local companion stdin enter `enroll`. On the phone choose **Register passkey**.
3. Compare the complete fingerprint displayed on the phone with local `pending`.
   Enter `approve <requestID> <fingerprint>` locally only for that exact request.
4. Choose **Log in**, then **Connect / refresh**. This opens an authenticated stream
   before fetching authoritative state. The displayed backend ID scopes retained
   pending prompt state. If the connection closes, explicitly log in/reconnect;
   reconnect never resubmits a mutation.
5. List sessions, enter a session ID, and fetch history/inbox/permissions/forms.
   Alternatively enter an absolute host directory and create a disposable session.
   Host directory selection may load project plugins and is not an OS sandbox.
6. Submit a harmless prompt. Confirm it appears in inbox/history and execution works.
   Phone/TUI closure must not cancel admitted execution. **Interrupt** is an explicit
   separate action. Prompts retain their `msg_` ID before submission; a lost response
   is uncertain, not permission to generate a replacement ID.
7. Exercise logout, local recovery and backend RC disable separately. They must close
   browser authorization/streams, not interrupt admitted agent work. Backend disable
   is a real policy change and needs explicit local authorization.

The diagnostic stores uncertain prompt text/IDs in this tab's sessionStorage, keyed
by backend and session. This is local browser data, not another server history store.
Reconcile checks only the loaded inbox/history page. If not found, inspect additional
pages or local redsun; it never blindly resends. An uncertain create similarly retains
its session ID and checks it on the next Create action. There is no automatic retry
or polished resolution UI. Closing the tab can discard sessionStorage; record an
uncertain ID before closing it. Structured raw controls do not provide this helper;
retain IDs yourself when using them for mutations.

## Browser API and limits

Only two remote-control endpoints are mounted, both POST-only with exact Origin/Host,
same-origin Fetch Metadata when supplied, secure session cookie and bounded JSON:

- `/control/request`: `{method:"GET"|"POST",path,query?,body?}`. The path is a
  strictly allowlisted redsun API path, never a URL. Administrative routes, arbitrary
  methods, extra fields, raw file attachments and backend heartbeat/status/event paths
  are denied. GET has no body; empty mutations use `{}`. Query keys are allowlisted;
  redsun performs canonical query/domain validation and ownership checks.
- `/control/events`: `{}`. A fetch-readable SSE stream containing only
  `{backendID,revision}` refresh hints. No backend event payload or credential is
  forwarded. Streams share the concurrency budget, close on revocation/disconnect,
  and fail closed under backpressure. They report an authenticated browser connection
  for heartbeats but never extend login idle expiry.

Requests cover session list/create/get/active/history/inbox, prompts, interruption,
moves, agent/model selection/catalogs, location resolution, permissions and supported
forms. The structured-operation box supports these without dedicated UI widgets.
Example permission reply:

```json
{"method":"POST","path":"/api/session/ses_example/permission/per_example/reply","body":{"reply":"once"}}
```

The user-approved phone-test safeguards are 6 MiB request bodies, four prompt files,
16 MiB backend JSON responses, eight concurrent requests including streams, and a
process-wide authenticated bucket of burst 60/refill two per second. Authentication
has its separate existing limits. Oversized history must use smaller pages. Error
bodies and backend headers are not forwarded; mutations are never retried. 400/404/409
operation failures remain distinguishable; backend availability failures return 503.

Backend success JSON is bounded and decoded as JSON, then relayed from the pinned
scoped projections; the companion does not vendor every upstream response schema or
perform content DLP. Query semantics, form field constraints and session ownership
remain authoritative in redsun. Upgrading redsun requires reviewing these projections.

Refresh hints are coalesced at 250 ms with five-second periodic refresh as a backstop.
Background snapshot reads send `X-Redsun-Activity: background`, which only suppresses
idle extension; it cannot grant access. User-triggered requests refresh idle normally.
Backend connection failures revoke the affected generation and browser sessions; transient
reattachment does not resurrect prior cookies. The page renders responses as text,
uses a restrictive CSP, and contains no third-party script or frontend dependency.

## Remaining verification

The first connection verified real Windows discovery ACLs, scoped attachment,
historical Tailscale Serve Host/Origin preservation and Safari WebAuthn. Next exercise session creation,
prompts, history, interruption, moves, models/agents, permissions/forms and reconnect
with uncertain submissions. Verify logout/recovery/backend disable or revocation close
authorization without cancelling admitted work. Policy changes need local approval.

Frontend design can proceed against the current scoped APIs. Background companion
operation and local enrollment/recovery access need an operational workflow before
unattended deployment; automatic service installation is not approved scope. Ubuntu
runtime and wider browser/authenticator coverage remain unverified. Rich uncertain-write
reconciliation is frontend work, not permission to retry backend mutations blindly.
