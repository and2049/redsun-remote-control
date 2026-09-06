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

- Bun workspace with `apps/companion` and `packages/protocol`; `apps/web` is a
  documented boundary, not a frontend scaffold with speculative dependencies.
- Strict TypeScript configuration and Bun tests.
- Effect-scoped Bun listener, hard-bound to IPv4 loopback. Development uses an
  ephemeral port; fixed operational port/origin selection is not decided.
- Only `GET /health` exists. It reports foundation status and protocol version,
  not backend readiness. Other paths return 404; unsupported health methods 405.
- Scope release stops the listener. CLI interruption aborts the scope.
- Passkey verification, in-memory session lifetime, backend attachment cores, and
  protected backend handoff import exist, but no usable login/enrollment flow or operational backend connection,
  UI, or Tailscale configuration exists.

Approved dependencies: Effect, TypeScript, Bun types. Initial exact pins match the
locally inspected redsun toolchain: Effect 4.0.0-rc.112, TypeScript 5.8.2, Bun types
1.3.13; runtime Bun 1.4.0. Subsequently approved: `@simplewebauthn/server` 14.0.1
(MIT). Frontend dependencies remain unapproved.

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
not yet wired to any CLI, HTTP endpoint, backend disable event, or browser session.

### Required caller responsibilities before exposing authentication

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

No auth routes are mounted. `/health` remains the only HTTP surface, and tests pin
that `/auth/register` and `/auth/login` remain unavailable. Do not expose through
Tailscale yet.

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

This is not wired to cookies, login, HTTP routes, backend disable, or actual streams.
Callers must issue tokens only after durable credential/counter updates and current
enrollment checks; use signals for browser resources, never backend agent execution.
Stream keepalives must not call authenticate merely to extend idle lifetime.

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

Pinned redsun commit: `fa65c5f530e78509e53793a608e4a0654996b21e`
(`feat: add managed remote-control integration foundations`). Canonical handoff is
redsun's `specs/remote-control-integration.md`. Reviewed it alongside schemas,
authorization, status handlers, persistence, registration, and export code.

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
- Lease is 30 seconds; the future supervisor should heartbeat roughly every 10 seconds.
  `connected:false` means companion-ready, not an authenticated browser. Browser
  connection reporting is not implemented here yet.
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
Scope exit or close aborts pending requests. No supervisor, automatic retry, heartbeat
timer, discovery reader, session methods, or event stream is implemented yet.

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

### Protected local backend import

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
do not describe cross-platform deployment as verified. Browser enrollment persistence,
atomic updates/recovery, protected discovery, and operational loading remain pending.

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
3. Local vertical slice: scoped in-memory status/heartbeat attachment and protected
   backend handoff import implemented and fixture-tested on Windows. Protected discovery, supervision, sessions/prompts, scoped SSE
   and interruption remain pending. No remote exposure before authentication.
4. Security: passkey crypto/challenge and session lifetime cores implemented and tested. Local approval,
   durable enrollment, HTTP validation/rate limits, browser session wiring, local recovery,
   revocation wiring, and approved route/event surface remain pending.
5. Private deployment: stable HTTPS origin, Serve setup, independent background
   companion lifecycle, real phone test. Pending.
6. Mobile completion: forms/permissions, directory changes, models/agents, reconnect,
   uncertain writes and approval races. Pending.

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
- Frontend: audit a pinned OpenCode v2 browser source set, licenses, dependency
  closure, and native integration removal before adding UI dependencies.
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
Frontend implementation and UI audit are now deferred while the user gathers design
references. The finalized contract supersedes the provisional schemas inspected earlier.
`@simplewebauthn/server` 14.0.1 (MIT) is approved for the authentication core. No
browser-facing auth routes will be exposed during this step.

## Verification

Run from repository root: `bun install --frozen-lockfile`, `bun run typecheck`,
`bun test`. Development: `bun run dev` (ephemeral loopback health listener only).
Current verification: frozen install and typecheck pass; 133 tests, 0 failures,
including real WebAuthn registration and signed authentication for three algorithms,
negative security cases, concurrency, invalidation, listener cleanup, and scoped
attachment fixtures (redirect refusal, proxy isolation, identity/restart checks,
HTTP refusal, response bounds, timeout, and cancellation). Session tests cover idle
and absolute deadlines, autonomous expiry signals, capacity reclamation, revocation,
restart isolation, immutable policy capture, and Effect scope cleanup.
Storage tests cover Windows ACL rejection, bounded reads/writes, linked-path
rejection, no-overwrite publication and races, source preservation, strict handoff
decoding, and actual CLI subprocess imports without credential output or listeners.
Redsun verification run separately from its core directory:
`bun run test ../server/test/remote-control.test.ts ../server/test/remote-admission.test.ts ../server/test/remote-projection.test.ts`
passed 8 tests / 145 assertions. These use its isolated test harness, not the installed
service. The companion adapter has not yet been exercised against an actual redsun
server process; its network tests use isolated Bun fixture servers.
CLI signal handling has not been verified end to end on Windows; the service scope's
listener cleanup is integration-tested. No real backend or phone test has run.
Do not store credentials, private device names, or machine-specific setup files in
the repository. No source from OpenCode has been copied; licensing selection for
this repository remains open before importing upstream code or distributing it.
