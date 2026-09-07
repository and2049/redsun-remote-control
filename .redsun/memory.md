# Redsun Remote Control — Project Memory

## Purpose and approved scope

Build a private mobile/desktop browser interface for an existing redsun background
server. Tailscale is the selected transport; no public exposure, custom VPN, or
always-available gateway. Start with one host and one remote controller. Preserve
room for multiple hosts/controllers without implementing aggregation now.

The browser is a separate agent client, not terminal mirroring. Closing or crashing
the TUI must not stop remote work if the backend remains alive. Agent state and
credentials belong to redsun, not a second backend/database in this repository.

## Working rules

Readability comes before line count. Write only necessary code, but do not compress
functions into cryptic expressions. No design-decision comments in code; record
decisions here. Test new logic. Ask before adding dependencies or resolving an open
decision that changes functional limitations or security behavior. Update this file
as work progresses; never describe planned features as implemented.
Commits are authorized when useful. Use concise titles, optionally `[topic]`-prefixed,
with no commit-body description. Do not include unrelated user work.

## Implemented foundation

- Bun workspace with `apps/companion`, `packages/protocol` and `apps/web`, the React
  browser client described in the web app section below.
- Strict TypeScript configuration and Bun tests.
- Effect-scoped Bun listener, hard-bound to IPv4 loopback. Development uses an
  ephemeral port; authenticated serve mode requires explicit HTTPS origin/port.
- No-argument development mode exposes only `GET /health`. It reports foundation
  status/protocol version, not backend readiness. Authenticated mode additionally
  mounts the narrowly defined authentication routes documented below.
- Scope release stops the listener. CLI interruption aborts the scope.
- Passkey verification, session cookies, local approval/recovery CLI controls,
  protected credential/counter storage, and authentication HTTP wiring exist.
  Explicit `serve --backend` now mounts protected backend loading, scoped supervision,
  allowlisted operations, browser refresh streams and a dependency-free diagnostic
  page. The first Windows/iPhone connection through Tailscale is verified below;
  broader operations and deployment coverage remain pending. The product web app is
  implemented and served at `/`; live phone use of it remains unverified.

Approved dependencies: Effect, TypeScript, Bun types. Initial exact pins match the
locally inspected redsun toolchain: Effect 4.0.0-rc.112, TypeScript 5.8.2, Bun types
1.3.13; runtime Bun 1.4.0. Subsequently approved: `@simplewebauthn/server` 14.0.1
(MIT). Frontend (2026-09-07, user approved): `react` and `react-dom` 19.2.8,
`react-markdown` 10.1.0, `remark-gfm` 4.0.1 (all MIT), plus `@types/react` 19.2.18 and
`@types/react-dom` 19.2.7. No Tailwind, Vite, router or state library; the alternatives
considered were a zero-dependency vanilla client and mirroring inkwash's full stack.

## Passkey core

`apps/companion/src/auth/passkeys.ts` wraps SimpleWebAuthn using Effect. It generates
registration/authentication options and verifies responses against one explicitly
configured HTTPS origin and that origin's hostname as RP ID. It does not infer the
origin from request headers, allow origin aliases, or supply an insecure development
bypass. Actual origin selection remains part of deployment setup.

User presence and verification are required. No platform-only authenticator filter
is set; security keys and platform authenticators are both eligible. Attestation
preference is none. The core uses the library's default supported algorithms;
generated ES256, RS256, and Ed25519 credentials were all verified on Bun 1.4.0 using
real signatures in isolated tests. This proves runtime crypto compatibility, not
phone/browser/Ubuntu usability or authenticator hardware certification.

Challenges (`auth/challenges.ts`) are random, bounded, browser-bound, purpose-bound,
single-use, and expire against a monotonic clock. Lifetime and capacity are required
inputs rather than product defaults chosen silently. Capacity rejection is not a
substitute for HTTP rate limiting. Expired entries are reclaimed on issuance; no
background timer or persisted challenge state exists. Wrong-browser attempts do not
consume another browser's challenge. A matching-browser verification attempt consumes
it before awaiting cryptography, even on failure. Concurrent reuse is rejected.

The wrapper also rejects cross-origin ceremonies explicitly, including cases with no
`topOrigin`; the library's authentication verifier allows some such cases by default,
and registration does not provide the same iframe check. Credential ID/user handle,
RP ID, origin, challenge, signature, and counter checks are enforced. Zero counters
used by synced passkeys remain valid. Verification errors are deliberately generic
and do not retain potentially sensitive library messages.

`invalidate` clears outstanding challenges and changes a generation counter so
in-flight option generation/verification cannot succeed after invalidation. It is
wired to local recovery and auth revocation hooks. Operational backend loss and policy
events now invalidate browser authorization through supervision.

### Authentication invariants and exposure responsibilities

- This is a cryptographic core, not enrollment authorization. Require explicit local
  approval for the exact browser/registration being accepted. Do not expose
  `registrationOptions`/`verifyRegistration` as open account creation routes.
- Supply a server-issued browser binding, not a caller-selected request-body string.
- Validate/bound untrusted HTTP JSON, require the configured Origin, prevent CSRF,
  and rate-limit requests before calling the typed core. Shared TS types are not
  runtime request validation.
- Persist the owner user ID and verified public credential securely. No authenticating
  browser private key is held here. Protect the separate backend scoped credential.
- Load current enrollment/counter state at verification time. Serialize or use
  compare-and-swap for counter updates and recheck enrollment revocation before
  issuing a session. Returned counter updates do not mutate or persist input state.
- Commit local approval and enrollment together; do not leave an approved credential
  behind when persistence fails. Registration proof alone must not create a session.
- Add browser session expiration, secure cookies, logout/revocation, stream teardown,
  and local-only recovery. Invalidate in-flight ceremonies during relevant revocations.

Authentication HTTP/CLI wiring is implemented in the explicit serve mode described
below; no-argument mode remains health-only. Legacy `/auth/register` and `/auth/login`
paths stay unavailable. `serve --backend` separately mounts the allowlisted control
surface described below. Before Tailscale exposure, complete real-redsun and permission
preflight and obtain explicit local deployment authorization.

### Browser session lifetime core

`auth/sessions.ts` issues random 256-bit bearer tokens and retains only SHA-256
token digests. Sessions are bounded by caller-supplied capacity and use monotonic
24-hour absolute / one-hour idle deadlines. Successful authentication refreshes
idle expiry, never absolute expiry. Timers expire authorization even without new
requests; each session exposes an AbortSignal for future browser-stream teardown.
Timer callbacks recheck the deadline rather than assuming timers fire precisely.
Revocation aborts one session; clear invalidates all current sessions. The Effect
factory closes the store on scope release, aborting signals and cancelling timers;
a closed store cannot issue new sessions. No sessions persist across restart.

`auth/service.ts` wires this to cookies/login through `auth/http.ts`, durable counter
updates, local recovery and revocation hooks. Operational backend failures/events now
revoke browser sessions and streams. Signals are for browser resources, never agent execution.
Stream keepalives must not call authenticate merely to extend idle lifetime.

### Local enrollment coordinator and initial owner persistence

`auth/enrollment.ts` is an Effect-scoped coordinator around the passkey core.
Only its local `open` method starts a five-minute enrollment window. Browser-facing
options and proof verification require an open, unexpired window and a server-issued
binding supplied by the future HTTP layer. Capacity counts in-flight options and
pending proofs together. Wrong-browser attempts do not consume the matching request;
matching verification attempts are single-use. Cancellation/new windows/scope exit
invalidate outstanding ceremonies, including cryptography already in flight.

Verified requests expose a 128-bit hexadecimal fingerprint derived from origin,
random request ID, browser binding, owner user ID and verified credential identity/key.
Local pending-request inspection returns only request IDs/fingerprints. Approval
requires both to match; proof alone never creates an enrollment or browser session.
The local open/cancel/approve methods are serialized. Once approval is admitted,
its persistence is uninterruptible and cancellation waits; cancelling an enrollment
window is not revoking a committed owner. Approval closes the window and succeeds
only after persistence returns. Failures return fixed safe errors and cannot retry
the same proof. Successful enrollment prevents reopening that coordinator.

`storage/owner.ts` stores the approved fingerprint and credential together in a
single initially no-overwrite `owner.json` under the protected companion directory. The strict
v1 schema stores canonical HTTPS origin, user ID, public key, credential ID/counter
and optional transports. Base64url must be canonical and counters fit WebAuthn uint32.
Origin mismatch fails closed on load. No browser private key is stored. As with
backend import, ambiguous filesystem publication failures require local inspection,
not silent overwrite or assuming the destination was never published.

The auth service loads existing owner state before opening enrollment and wires the
coordinator to local stdin commands and browser proof endpoints. No-overwrite creation
remains the final defense against replacement. Local recovery can reset the coordinator
only after protected owner deletion. Real signed fixtures exercise the HTTP/CLI flow
on Windows; no real browser or hardware authenticator was enrolled.

### Operational authentication, counter updates and recovery

`storage/lease.ts` provides an exclusive OS-backed owner-store lease. Windows holds
an owner-only `owner.lock` FileStream with FileShare.None in a private PowerShell
helper. That same process executes owner-file mutations under the lease, so a parent
crash cannot leave a separate mutation helper writing after the lease is released.
Linux uses `/usr/bin/flock --nonblock` on an inherited protected file descriptor;
the parent retains the open-file-description lock. Linux runtime verification remains
pending. No package/utility was installed. `owner.lock` remains on disk; never delete
it to bypass a live lock. Scope release/process death releases the OS lock.

`makeOwnerStore` serializes reads/enrollment/counter updates/reset. Counter writes
check the current identity and counter against the verified snapshot, preserve the
public key/credential identity, and permit valid zero-to-zero synced passkey counters.
Windows uses flushed temporary files and File.Replace; Linux uses rename and parent
directory fsync. Stale or concurrent updates cannot overwrite a winning revision.
This has not been certified against simulated power loss or filesystem faults.

`auth/service.ts` serializes login and local approval. Tokens are issued only after
counter persistence and generation/lease rechecks. Recovery invalidates sessions and
pending login generations before waiting for owner deletion, preventing in-flight
login from issuing a session after revocation begins. Storage errors and lease loss
fail closed. The disable hook clears authorization and remains disabled even after
local recovery. Operational supervision uses the separate nonpermanent `revoke` hook
to clear sessions/ceremonies on backend loss; stopped supervisors still deny operations.

`auth/http.ts` mounts POST-only `/auth/binding`, `/auth/register/options`,
`/auth/register/verify`, `/auth/login/options`, `/auth/login/verify`, `/auth/session`
and `/auth/logout` in authenticated mode. Require exact configured Origin and Host,
same-origin Fetch Metadata when present, JSON, and no compressed bodies. Bodies are
bounded to 64 KiB and five seconds; relevant duplicate/malformed cookies are rejected.
Empty requests must be exactly `{}` (Effect's empty Struct does not enforce that).
Schemas bound WebAuthn JSON; optional extension results/hints are not trusted as
authority. Server-issued binding cookies are verified against an in-memory store.

Cookies use __Host- prefixes, Path=/, Secure, HttpOnly, SameSite=Strict, no Domain.
Bindings last five minutes; sessions use the approved 24-hour absolute/one-hour idle
policy. Tokens never appear in JSON. Auth replies are no-store with generic errors
and no CORS allowance. The process-wide auth bucket allows burst 30 and refills one
request per two seconds, ignoring spoofable forwarded IP headers. This is bounded
single-controller admission, not per-device fairness; peers can exhaust the budget.
Capacities: 128 bindings/login challenges, 32 enrollment requests, 64 sessions.

CLI: `serve --origin <https-origin> --port <port>` explicitly mounts authentication
on loopback with a fixed nonzero port (no substitution), without TLS/Serve/backend
setup. Local stdin commands are `enroll`, `pending`, `approve <requestID> <fingerprint>`,
`cancel`, and `recover confirm`. Closing stdin does not stop the listener; background
local-control IPC is not implemented. `recover --confirm` is offline browser recovery,
refused while a companion holds the lease. Recovery never revokes backend credentials.
Origin changes require recovery and re-enrollment. Configuration is supplied through
explicit CLI arguments; no operational configuration-file loader exists yet.

`docs/authentication.md` defines these commands, routes, limits and failure semantics.
The optional `--backend` extension adds operational attachment and a diagnostic page.
The first real Tailscale/iPhone connection is recorded in the phone-test section below.

## Architecture direction

Browser → private Tailscale HTTPS/Serve → loopback companion → authenticated local
redsun server. Serve, not Funnel. One origin for assets and APIs. Do not expose an
unauthenticated backend proxy. Route and event authorization must precede exposure.
Backend credentials never reach the browser. Tailscale membership alone is not
application enrollment.

Keep backend access behind the companion's backend module when it is added. Do not
put redsun URLs or credentials in shared/browser contracts. Introduce stable host
identity before persisting browser state; scope session IDs, drafts, and caches to
it. Do not add a gateway, remote-host registry, or generic transport framework now.

Navigation is client-local; moving an existing session changes shared backend state.
Resolve directory paths on the host. Reconnect must reload authoritative state;
redsun's event stream is volatile, not a durable replay feed. Never blindly retry
uncertain prompt submissions. Disconnecting a browser must not cancel execution.

## Verified integration findings

### Finalized redsun RC contract

Pinned redsun commit: `73478ccdfd` (`feat: expose resolved host theme to remote control`,
feature branch, 2026-09-07) on top of `fa65c5f530e78509e53793a608e4a0654996b21e`
(`feat: add managed remote-control integration foundations`). Canonical handoff is
redsun's `specs/remote-control-integration.md`. Reviewed it alongside schemas,
authorization, status handlers, persistence, registration, and export code.

Redsun commit `a02bda3a0b` (feature branch) additionally publishes the `.remote` sidecar
through its protected private-file helper; the wire contract is unchanged. Earlier
checkouts inherit the Windows state-directory ACL and fail companion discovery.

The user approved a narrow maintained adapter instead of vendoring the full generated
client. No sibling-source dependency or additional package was added. Update the pin
and review schemas/capabilities when upgrading; never infer authority from the full
upstream API surface.

- RC is managed-service-only. `remote_control.enabled`, durable identity, and
  enrollment persist in the channel's service configuration, not the session DB.
  Disabled by default; restart preserves enrollment and policy. Project configuration
  and `/cd` cannot change it. Manual config edits require backend restart.
- Ordinary disable preserves credentials. Revocation removes them separately. A
  failed persistence result must not be treated as durable disable/revocation.
- Companion enrollment command: `redsun remote enroll --handoff <new-private-file>`.
  It does not enable RC; `redsun remote enable` is separate. No such command was run
  against the user's service here.
- The handoff contains version 1, durable backendID, absolute password-free discovery
  path, 32-character lowercase-hex credentialID, and 43-character base64url token.
  Scoped auth is `Bearer rc1.<credentialID>.<token>`, never local Basic auth.
- Discovery file is `<ordinary-registration>.remote` with exactly id/version/url/pid;
  no unrestricted password. It can be stale. `/api/remote` must report supported,
  enabled, enrolled, version 1, matching durable backendID and registration processID.
- Lease is 30 seconds; the supervisor's caller should heartbeat roughly every 10 seconds.
  `connected:false` means companion-ready, not an authenticated browser. Operational
  connection reporting now counts authenticated browser control streams.
- **Scoped SSE is hints only**: server.connected, remote.status, remote.sync. No raw
  token deltas. Subscribe then resnapshot, coalesce hints, and periodically refresh.
  The ordinary redsun Solid event reducer cannot consume this as its normal feed.
- Workspace selection matches trusted-owner local behavior and may load plugins.
  Prompt attachments are restricted data URIs (not file/HTTP URIs), 4 files and 6 MiB
  request maximum. Project roots are not an OS sandbox. Response projections omit
  administrative metadata/provider internals, not secrets already written in text.
- Prompt IDs must be retained across uncertain responses; reconcile inbox/history,
  never blindly generate a replacement ID. A queued move's 204 is not proof it has
  already changed the session directory.

### Companion adapter implementation

`apps/companion/src/backend/contract.ts` strictly decodes the consumed handoff,
password-free registration, and status fields with Effect Schema. Handoffs are wrapped
in Redacted; schema errors are replaced with fixed safe errors. Unknown fields and
versions fail closed, including accidental ordinary registrations containing passwords.
Handoff decoding validates data only; it does NOT validate a file's ownership/ACL.

`backend/attachment.ts` accepts an already locally validated enrollment and discovery
object in an Effect scope, verifies `/api/remote`, and returns status/heartbeat methods.
Every result is checked against both identities and current enabled/supported state.
Any failure closes the handle; a supervisor must rediscover and attach again explicitly.
Scope exit or close aborts pending requests. The supervisor/discovery cores described
below wrap attachment with passive retry and heartbeat scheduling. The attachment now
also owns allowlisted requests and scoped event subscriptions, cancelled on close.

`backend/transport.ts` is intentionally limited to status and heartbeat, not a generic
proxy. Uses Node HTTP directly so environment HTTP/HTTPS/ALL_PROXY settings cannot
route scoped credentials elsewhere. Redirects are refused without visiting targets.
Endpoints must be HTTP root origins with no credentials/query/fragment, literal
127/8 or ::1; localhost is rewritten to 127.0.0.1 without DNS. Other aliases and mapped
IPv6 addresses are rejected. If a deployment needs additional address forms, review
them explicitly rather than weakening validation. No browser input supplies an endpoint.

Status responses are capped at 16 KiB and require JSON content type. The caller must
provide an explicit timeout; it covers headers and streamed body, not merely idle time.
No retries or backend error-body forwarding. Return errors distinguish invalid contract,
invalid endpoint, refusal, unavailability, identity mismatch, and a closed handle.

Identity validation occurs on the first authenticated status response, as required by
the redsun contract. It cannot authenticate a malicious same-user local process before
sending the credential; local OS-user trust and protected discovery/import are necessary.

### Protected discovery and supervision

`backend/discovery.ts` reads only the imported handoff's registration path through
the existing bounded protected-file reader. It strictly decodes UTF-8 JSON and the
password-free registration schema, then validates the loopback endpoint before any
network request. No fallback to ordinary registrations or endpoint inference exists.
Missing/unreadable/nonprivate files map to safe unavailable errors; malformed contracts
and invalid endpoints remain distinct. Permissions are never silently repaired.

`backend/supervisor.ts` is an Effect-scoped core with explicit timeout, heartbeat and
retry intervals, a trusted connected predicate and an idempotent invalidation effect.
It rereads discovery on every attempt, validates status, and sends an initial heartbeat
before publishing readiness. Subsequent heartbeats are sequential. Timeout plus
heartbeat interval must be below thirty seconds. Only unavailable failures retry;
refusal, identity mismatch and invalid contracts/endpoints stop the instance. No
silent re-enrollment or adoption of another backend occurs.

Ready snapshots expose stable backend/process IDs and a generation AbortSignal, not
credentials or endpoints. Failure aborts the generation and runs invalidation before
retry; scope release cancels pending HTTP and stops heartbeats. Callbacks must be
idempotent. These are browser-resource signals, never agent interruption. Tests cover
fresh-process rediscovery, refusal/identity failure, timing validation and shutdown
during a stalled heartbeat. In operational mode it also waits for the first validated
scoped event before publishing ready, and monitors SSE alongside heartbeats. SSE
closure, invalid status/identity and authorization refusal invalidate browser access.
The attachment retains its first backend failure before cancelling sibling requests.
Supervision uses that original cause rather than a consequent closed/aborted transport:
temporary operation outages retry; refusal and invalid contracts remain terminal.
Late requests from an older attachment cannot invalidate a newer connection.

CLI `check-backend` loads protected enrollment/discovery and makes one scoped status
request with a five-second network deadline. It prints fixed success/failure text,
not paths, credentials or response bodies. It sends no heartbeat and starts no listener,
backend, enrollment or policy change. An actual CLI subprocess is fixture-tested.
See `docs/backend-attachment.md` for the contract and phone-test prerequisites.

Windows live-integration finding (2026-09-06): the pinned publisher's `mode: 0600`
sidecar inherited SYSTEM/Administrators/sandbox-group ACEs from the state directory,
which the companion's owner-only reader rejects. Fixed in redsun `a02bda3a0b`, verified
by its CLI test on Windows. Do not weaken companion validation or silently repair
runtime files. No live credential file was inspected.

### Operational control and phone diagnostic

Operational control details are documented in `docs/phone-test.md`. `operational.ts`
loads protected enrollment and configures a five-second network deadline, ten-second
heartbeat and three-second passive retry. Its supervisor invalidation effect clears
browser sessions and pending ceremonies, but never sends an agent interrupt.

`backend/operations.ts` validates a finite route/method/query-key/payload allowlist
for the pinned v1 capability table: sessions/history/inbox/active, prompts, interrupt,
moves, location resolution, model/agent selection/catalogs, permissions and supported
forms. Administrative methods, backend URLs, status/heartbeat/event proxying, unknown
fields and file/HTTP attachments are refused. Canonical query/domain validation and
ownership remain redsun's responsibility. `backend/request.ts` uses direct Node HTTP,
refuses redirects, bounds request/response bytes and time, never retries mutations and
never forwards backend error bodies/headers. Successful JSON relies on the pinned
scoped response projections, not a vendored full response schema or content DLP.

`backend/events.ts` incrementally bounds/parses only pinned scoped SSE data/comment
frames and validates status events. Backend events are not forwarded to browsers.
`control.ts` provides POST-only `/control/request` and `/control/events`, authenticated
with exact Origin/Host and existing secure cookies. Browser refresh frames contain
only backendID/revision, coalesced at 250 ms with a five-second periodic backstop.
Backpressure, session expiry/logout/recovery and backend-generation loss close streams.
Heartbeat connected reporting counts active authenticated streams, never mere cookies.
Background stream/snapshot authorization does not extend idle expiry; the diagnostic
marks background reads with `X-Redsun-Activity: background`, which only suppresses idle
extension and cannot grant authority. Ordinary user activity retains existing expiry rules.

The user explicitly approved phone-test limits: 6 MiB request bodies, four prompt files,
16 MiB backend JSON responses, eight concurrent requests including streams, and a shared
authenticated burst 60/refill two-per-second bucket. Auth endpoints retain their separate
limits. Oversized history needs smaller pages. Caller cancellation does not invalidate
an otherwise healthy backend attachment; no cancellation undoes admitted agent work.

The user approved a dependency-free diagnostic page, separate from the deferred product
UI. `diagnostic.ts` builds its browser TypeScript with Bun at startup and serves only
fixed assets under restrictive CSP/Host checks. The page uses native WebAuthn JSON helpers,
text-only output rendering, explicit reconnect and subscribe-before-snapshot refresh.
It has list/create/prompt/history/inbox/interrupt controls plus structured allowlisted
operations for forms/permissions/moves/catalogs. Modern browser support is required;
iPhone Safari was verified in the first phone connection. Uncertain prompt IDs/text are retained in tab sessionStorage,
scoped by backend and session; reconciliation checks loaded history/inbox pages without
resending. Uncertain creates retain their session ID. Raw controls and additional history
pages require manual reconciliation; no polished uncertain-write UX is claimed.

Operational CLI subprocess tests use real signed passkey fixtures and a synthetic
HTTP/SSE backend. They verify authorized reads, denied administrative/unauthenticated
access, diagnostic assets and backend disable revoking cookies/streams. Additional tests
cover payload allowlisting, malformed events, bounded/redirect-free transport, mutation
nonretry, concurrency/rate limits and background idle expiry. Initial implementation
used fixtures without changing live services; the subsequent authorized phone run below
verified real attachment, Tailscale Host preservation, discovery ACLs and browser login.

### Phone-test automation

`apps/companion/script/phone-test.ts` (`bun run phone-test`) automates the host side of
the phone test; pure helpers live in `phone-test-lib.ts` with unit tests. It is a plain
Bun child-process script rather than Effect because it only sequences external CLIs and
relays an interactive stdin. It gates on the MagicDNS name appearing in Tailscale's
certificate domains, refuses unrelated Serve mappings, asks once, then restarts the local
source service if it lacks RC, enrolls/imports when `backend.json` is absent (deleting the
temporary handoff after import), enables policy, runs `check-backend`, applies the
tailnet-only Serve mapping, and runs `serve --backend` with automatic `enroll`/`pending`
polling. Fingerprint approval remains a typed human step.

Live host findings on 2026-09-06: two managed services exist, the installed release
binary (the user's main one) and a source checkout `serve --service` (channel local,
separate DB). Only the local one is the RC target; it had been started from `dev` before
the RC commit and must be restarted from the feature branch. The redsun source CLI must
run with `packages/cli` as working directory. The tailnet had MagicDNS enabled but no
HTTPS certificates (empty `CertDomains`), which blocks the origin until the user enables
them in the admin console.

First real phone test succeeded on 2026-09-06 via `bun run phone-test`: the user enabled
tailnet HTTPS certificates, the script restarted the local source service, enrolled,
imported, enabled RC, passed `check-backend` and applied the Serve mapping; an iPhone
(Safari) registered a passkey, was approved by typed fingerprint, logged in and reached
"Connected to backend" after Connect / refresh. This verifies Tailscale Serve preserving
Host/Origin, browser WebAuthn JSON helpers, real discovery ACLs and live scoped attachment
on Windows. Operations beyond connect, logout/recovery/disable teardown, background
companion lifecycle and Ubuntu remain unverified live.

### Web app

`apps/web` is the product UI; `docs/web-app.md` documents layout, data flow, prompt
retention, attachment limits and known gaps. `apps/companion/src/web.ts` bundles
`apps/web/src/main.tsx` once at startup with `Bun.build` (production React, minified)
and serves `/`, `/app.js`, `/app.css` through the shared `assets.ts` guard (exact host,
no query, same-origin fetch metadata, GET only) with CSP `style-src 'self'` and
`img-src 'self' data:`; the diagnostic moved to `/diagnostic`. Browser code never
imports companion modules and talks only to `/auth/*` and `/control/*`.

Design decisions: the visual reference is the user's earlier inkwash-2 project
(React, Tailwind, many dependencies) and the Claude mobile app screenshot; only the
look was borrowed (light surface `#f9f9f7`, ink `#2d2d2b`, terracotta accent `#cc7d5e`,
serif transcript prose, sans chrome, dark scheme via `prefers-color-scheme`). Mobile
(below 48rem) is stack navigation (list, chat with back button, bottom sheets); desktop
is sidebar plus chat. The browser client is plain async/await rather than Effect,
following the diagnostic precedent and keeping the bundle small. Refreshes are driven
by the companion's revision frames with a 30-second backstop and run with the
background activity header so they never extend idle expiry; user actions refresh in
the foreground. Live phone use on 2026-09-07 exposed two request-storm bugs: the
new-session sheet queried catalogs per keystroke (each partial path is resolved by the
backend and may load plugins; the resulting stall timed out the heartbeat and the
supervisor's invalidate-before-retry policy signed the phone out), and each 250 ms
revision frame during an agent turn triggered a seven-request refresh that exhausted
the shared bucket, leaving the UI frozen on 429s. Fixed by committing the directory on
blur only and by `apps/web/src/refresh.ts`: coalesced, serialized refreshes at most every
four seconds in the background (six requests each), quiet retry two seconds after a 429,
immediate foreground refreshes. The supervisor still revokes browser sessions on any
transient attachment failure, including a single five-second heartbeat timeout; that
policy is unchanged and worth revisiting if sign-outs recur. Prompt IDs are retained in
tab sessionStorage before sending; only 400
and 429 drop retention, any other failure marks the prompt unconfirmed with a Discard
control, and each refresh reconciles against inbox and history. Prompts sent while the
agent runs use the backend's default delivery (queued); steer is not exposed yet. The
newest 200 messages are shown without pagination, and because the scoped stream has no
token deltas, assistant text appears at refresh cadence rather than streaming.

Host theme (2026-09-07, user request): the web app matches the host's redsun TUI theme
and no longer consults the browser's light/dark preference. Redsun gained scoped
`GET /api/remote/theme` (v1 table, no query) returning `{name, mode, colors}` with hex
colors resolved from the TUI's persisted selection in global `cli.json` (fallback `dusk`)
plus global `themes/*.json`; project `.redsun/themes` and plugin-installed themes are not
consulted. The built-in theme assets moved from the TUI package into `packages/theme` so
the server does not depend on the TUI. The companion allowlists the read; `apps/web/src/theme.ts`
maps tokens to the stylesheet custom properties, sets `color-scheme` from the mode, caches
the last theme in localStorage, and the app refetches it on connect and every 60 s.
Derived tokens use `color-mix`. The host currently has no theme configured, so it reports
`dusk` (dark, yellow primary). Live phone verification of the theme is the user's next step.

Restart procedure while the user works remotely: after companion changes, stop the running
`serve --backend` process tree and start it detached (PowerShell `Start-Process`, hidden,
logs in `%TEMP%edsun-companion.log`) with the same origin/port the phone-test run used;
after redsun backend changes, `bun src/index.ts service restart` from `packages/cli`, which
signs the phone out once through supervisor invalidation. Never commit the private origin.

Verification on 2026-09-07 used a throwaway mock harness (scratchpad only, not in the
repository) rendering the bundle in Chrome for desktop and a 390px phone frame: session
list, transcript with markdown/tables/code/tool groups, queued inbox bubble, permission
and form cards, menu and picker sheets, new-session sheet, sign-in screen and a send
round trip with retention clearing. Raw HTML in markdown is not emitted. Real phone
use through Tailscale, light scheme screenshots and WebAuthn in the React sign-in
screen have not been exercised live yet; the diagnostic remains available for that.
The Chrome extension dropped some physical clicks during the check; that was tooling,
not an app defect (programmatic clicks behaved).

### Protected local backend import implementation

`storage/private-file.ts` and its Windows PowerShell helper implement bounded
16-KiB reads and no-overwrite file publication. Windows uses native .NET owner-only
ACLs at creation and checks ownership/access rules on the opened read handle.
Unix uses owner-only modes, fstat ownership/type checks, O_NOFOLLOW, and rejects
multiply linked input files. Both reject symbolic-link/reparse-point path components;
Windows also rejects UNC, drive-relative, device and alternate-stream paths.
Existing nonprivate files/directories are refused, never silently chmod/ACL-repaired.
Same-user processes and local administrators remain trusted; this is permission
protection, not encryption or a sandbox against concurrent same-user manipulation.

Writes use a private temporary sibling, flush file contents, and publish without
replacement (Windows File.Move; Unix link/unlink plus parent directory fsync).
Ordinary failures clean owned temporary files. Forced termination can leave a private
temporary file or an already-published destination; reruns still never overwrite it.
Windows subprocess execution is bounded to 15 seconds with fixed safe errors and
no credential-bearing command arguments. Secret data travels only over pipes.

`storage/backend.ts` strictly decodes protected handoffs and loads the stored
Redacted enrollment. The CLI's `import-backend <absolute-private-handoff-file>`
stores `backend.json` in `%LOCALAPPDATA%/redsun-remote-control` or
`${XDG_DATA_HOME:-$HOME/.local/share}/redsun-remote-control`. The base application-data
directory must exist; only the final private directory is created. No arbitrary
destination CLI option exists. The source is always preserved; explicit optional
source deletion remains pending. Import performs no network requests, backend
enrollment, enablement, listener startup, or Tailscale changes. Invalid handoffs are
rejected before creating the destination. No-argument CLI remains health-only.

Windows permission and CLI behavior is tested with disposable synthetic fixtures
outside the repository. Linux implementation is typechecked but has not run on Linux;
do not describe cross-platform deployment as verified. Owner creation, atomic counter
updates and recovery exist; protected discovery and explicit CLI probe loading now
exist. Operational serve-mode backend loading now exists behind explicit `--backend`.

### Earlier discovery audit

Inspected the adjacent redsun source without reading runtime credential files:

- `packages/client/src/promise/service.ts` exports discovery of a healthy registered
  service. Its `ensure()` can stop/replace services and must not be used casually.
- `packages/cli/src/services/service-config.ts` selects registration paths by channel
  under the redsun state directory; do not assume upstream fallback paths or ports.
- `packages/cli/src/server-process.ts` keeps the service process independent of the
  TUI and registers an endpoint with authentication. Prefer discovery-only attachment
  initially; do not start, stop, replace, or migrate the backend during setup.
- The local client workspace depends on redsun schema/protocol workspaces. Do not
  assume the npm upstream client matches redsun or silently add sibling-directory
  dependencies. Distribution of the compatible client requires a decision.

Tailscale was confirmed running on the development host, version 1.102.3, with no
Serve configuration. Its CLI was absent from the session PATH but found in the normal
Windows installation location. No networking configuration was changed. Phone login
was reported by the user; phone-to-host connectivity has not been verified.

## Live roadmap

1. Foundation: complete. Frozen install and strict typecheck pass; 8 tests pass,
   including a real loopback listener and scope-release check.
2. Integration audit: finalized v1 backend contract reviewed and pinned; narrow adapter
   chosen. Focused redsun RC tests pass. Frontend/UI audit remains explicitly deferred.
3. Local vertical slice: protected attachment, operational supervision, scoped events,
   allowlisted operations and diagnostic browser assets implemented and fixture-tested
   on Windows. Real attachment and Safari login are verified; live operation and
   teardown coverage remain pending.
4. Security: passkeys, local approval, protected counters, browser sessions, recovery,
   HTTP validation/rate limits and CLI/auth route wiring implemented and tested on
   Windows. Policy/event teardown and control authorization are wired and tested with
   synthetic servers. Deployment preflight remains required before private exposure.
5. Private deployment: first real phone connection verified 2026-09-06 through
   `bun run phone-test` and Tailscale Serve. Independent background companion lifecycle
   and live exercise of operations/teardown remain pending.
6. Mobile completion: the React web app covers sessions, transcript, prompts with
   attachments, interrupt, permissions, forms, moves and model/agent pickers with
   retained-ID reconciliation. Pending: live phone verification of the web app, message
   pagination, steer delivery, session archive/rename, and streaming text.

## Approved backend completion policies

- Complete the companion backend while deferring frontend UI. The redsun integration
  branch need not be merged into dev for isolated integration work. If a genuine
  upstream blocker needs delegation, the user permits `claude -p`, but requires
  verification of the requested Fable 5.1 model rather than a default Opus fallback.
- Support Windows and Ubuntu with per-user application-data storage outside the
  repository. Enforce Windows ACLs or Unix owner-only permissions and fail closed
  when protection cannot be verified. Store no agent history or provider credentials.
- Import backend handoffs explicitly through the local CLI; never silently overwrite
  an attachment. Preserve the source unless explicit deletion is requested after a
  successful import.
- Local CLI opens a five-minute enrollment window. Require passkey proof and explicit
  host approval of the exact registration, with a matching fingerprint displayed on
  host and browser. No remote replacement of an enrolled controller.
- Browser sessions use Secure, HttpOnly, SameSite=Strict cookies, a 24-hour absolute
  lifetime and one-hour idle timeout. Keep sessions in memory; restart requires login.
  Logout, local revocation and backend disable invalidate relevant sessions and close
  browser streams, without cancelling agent execution.
- Configure HTTPS origin and loopback port explicitly; no hostname inference or port
  substitution. Origin changes require local reset/re-enrollment. Provide foreground
  operation and background-install instructions, not automatic service installation
  or Tailscale changes.
- Challenge windows are five minutes, with bounded pending requests and tested auth
  rate limits. These are approved direction, not implemented end-to-end behavior.

## Open decisions — ask before implementation

- Browser authentication: passkeys with required user verification and local-only
  recovery are approved. Platform and security-key authenticators are allowed.
  Ubuntu as a host needs no passkey keychain; Ubuntu as a controller depends on
  browser/authenticator support and needs live verification. An alternative login
  method may be considered later, not implemented now.
- Backend adapter selection is settled (narrow adapter).
- Frontend: stack settled (React, react-markdown, Bun bundling, plain CSS). Further
  UI dependencies still need approval.
- Actual deployment origin/port and any live installation or Tailscale changes still
  require explicit local setup authorization.

## Redsun handoff

`docs/redsun-remote-control-handoff.md` is the implementation brief for the separate
redsun agent. The user will transfer it manually; no redsun files were modified.

Approved after foundation work: backend RC enablement survives restart through a
configuration-file preference; ordinary disable preserves enrollment. Revocation
is separate. The handoff requests server-wide policy, companion-specific scoped
authorization, stream invalidation, stable attachment/compatibility contracts,
expiring status reporting, and a local TUI toggle/indicator. These backend changes
are now implemented in the separately pinned redsun commit described above. Our initial
brief remains a historical handoff, not the canonical wire contract.

The user authorized backend-independent work while the redsun agent finished, then
authorized review and integration after it completed.
The finalized contract supersedes the provisional schemas inspected earlier. The
frontend was implemented on 2026-09-07 after the user chose inkwash-2 as the reference.
`@simplewebauthn/server` 14.0.1 (MIT) is approved for authentication. The initial
crypto-only step exposed no routes; the subsequent explicitly configured serve mode
now exposes the tested authentication surface, still without Tailscale deployment.

## Verification

Run from repository root: `bun install --frozen-lockfile`, `bun run typecheck`,
`bun test`. Development: `bun run dev` (ephemeral loopback health listener only).
Current verification: frozen install and typecheck pass; 239 tests, 0 failures,
including real WebAuthn registration and signed authentication for three algorithms,
negative security cases, concurrency, invalidation, listener cleanup, and scoped
attachment fixtures (redirect refusal, proxy isolation, identity/restart checks,
HTTP refusal, response bounds, timeout, and cancellation). Session tests cover idle
and absolute deadlines, autonomous expiry signals, capacity reclamation, revocation,
restart isolation, immutable policy capture, and Effect scope cleanup.
Storage tests cover Windows ACL rejection, bounded reads/writes, linked-path
rejection, no-overwrite publication and races, source preservation, strict handoff
decoding, and actual CLI subprocess imports without credential output or listeners.
Enrollment tests cover proof-before-approval, exact fingerprint matching, window
expiry, cancellation/in-flight invalidation, concurrent capacity/approval, persistence
failure and ordering, scope release, strict owner decoding and signed login after reload.
New auth integration tests cover the actual HTTP/local CLI sequence, durable counters,
concurrent/stale writers, restart session invalidation, local recovery of active and
in-flight authorization, CSRF/Host validation, request limits, rate limits, lease
exclusion, and lock release after an actual synthetic companion process is killed.
Discovery/supervision tests cover protected-file rejection, passive CLI status-only
requests, heartbeat reporting, fresh-process retry, terminal refusal/identity failures,
and cancellation of stalled requests on scope release. Phone-test helper tests cover
origin/certificate/Serve-state parsing, pending approval lines and option parsing. The
web app tests cover pure state/timeline/attachment helpers and static rendering of
the timeline, approvals and markdown. The full suite now makes 872 assertions across
29 files (270 tests) on Windows.
Redsun verification run separately from its core directory:
`bun run test ../server/test/remote-control.test.ts ../server/test/remote-admission.test.ts ../server/test/remote-projection.test.ts`
passed 8 tests / 145 assertions. These use its isolated test harness, not the installed
service. Automated companion network tests use isolated fixture servers; actual redsun
attachment was separately verified during the first phone connection.
Graceful CLI signal handling remains unverified end to end on Windows; forced process
termination/lease release and service-scope listener cleanup are integration-tested.
A real phone connected to the real local redsun backend on 2026-09-06; see the
phone-test automation section for what that run did and did not verify.
Do not store credentials, private device names, or machine-specific setup files in
the repository. No source from OpenCode has been copied; licensing selection for
this repository remains open before importing upstream code or distributing it.
