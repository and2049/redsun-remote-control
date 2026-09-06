# Redsun backend remote-control integration

## Task

Implement the redsun-side foundations for a separate `redsun-remote-control`
companion. Inspect the current redsun code and applicable repository instructions
before editing. This document specifies behavior, not assumed service names or
endpoint paths. Reuse existing architecture where possible.

The companion repository currently contains only a strict TypeScript/Bun workspace,
an Effect-managed loopback health listener, and tests. It has no browser UI,
authentication, backend attachment, or Tailscale exposure yet.

Deliver backend changes, tests, and an integration contract the companion agent can
implement against. Do not implement the companion or browser application here.

## Approved product decisions

- Initial scope: one redsun host and one remote controlling device. Leave reasonable
  room for future multiple controllers/hosts without implementing a gateway.
- Connectivity uses installed Tailscale and private Tailscale Serve HTTPS, never
  Funnel or a public endpoint. Do not change Tailscale configuration in this task.
- Browser control uses backend APIs, not terminal mirroring.
- Remote access is independent of the TUI lifetime and active session. It must work
  from Home, with no session, and continue if the TUI exits while the server survives.
- RC is disabled before the user explicitly enables it.
- Enabled state survives backend restarts as a configuration-file preference.
- Ordinary disablement preserves enrollment. Re-enabling does not require pairing
  again. Credential revocation is a distinct operation.
- Disabling remote access disconnects remote control, but does not cancel agent
  tasks already admitted by the backend.
- RC policy is server-wide, not session- or workspace-specific. `/cd` does not change it.
- Browser navigation is independent of TUI navigation. Moving an existing session
  changes shared backend state; selecting a workspace on Home is client-local.

## Ownership and security boundaries

Redsun owns authoritative RC policy, companion authorization, session operations,
normal tool permissions, and TUI controls/status. The companion owns the browser UI,
browser authentication/enrollment, browser session revocation, and the remote HTTP
gateway. Provider credentials and agent history remain in redsun.

Tailscale membership grants network reachability, not automatic permission to
control redsun. A network address or caller-supplied header is not authentication.

The threat model includes unauthorized browsers/tailnet peers and a compromised
remote client attempting operations beyond the permitted API surface. The companion
is a trusted local process handling sensitive material. A scoped backend credential
limits protocol authority; it does not sandbox a malicious process running as the
same OS user or prevent that process reading other user-owned credential files.

Remote prompts retain normal agent tool permissions. Directory selection limits
alone are not an OS sandbox. Do not claim multi-user or filesystem isolation.

## Required implementation

### 1. Persistent server-wide policy

Add a typed configuration preference for RC enablement, default false. Use existing
config schemas, normalization, persistence, and state-service conventions where
appropriate. Ensure the field actually reaches runtime state.

Choose a configuration source that is global to the intended backend installation,
not merged from the selected project. Project files, plugins, or a remote request
must not silently turn RC on by changing workspace configuration. Inspect existing
global/service configuration facilities before proposing a new file.

The local toggle persists its change and updates effective state. Report persistence
failure honestly. Disabling must take effect in the running backend even if writing
the preference fails; report that restart persistence was not updated in that case.
Enabling must not claim persistent success when writing fails.

If existing channel/config precedence makes the intended scope ambiguous, ask the
user before selecting behavior. Document which server installations share the setting.

### 2. Companion-specific authorization

Introduce a distinct authenticated companion credential/principal rather than
using the unrestricted local/TUI credential as the companion's ongoing credential.

- Issue through a trusted local operation after explicit user authorization.
- Keep credential material out of browser responses, URLs, process arguments,
  status events, and logs. Do not emit secrets to ordinary terminal output.
- Bind credentials to the intended backend identity and make them revocable.
- Preserve valid enrollment through ordinary disable/enable and backend restart.
- Identify companion traffic from validated authentication, never a spoofable header.
- Restrict companion access to an explicit supported API surface.
- Deny RC policy changes, credential issuance, debug/admin operations, and provider
  credential administration through companion authorization.
- Do not implicitly expose plugin RPC or future endpoints via wildcard permissions.
- Preserve existing local authentication behavior for the TUI and normal clients.

Audit existing middleware and authentication services first. Do not invent an
independent authentication stack if a scoped principal fits the existing one.
Ask before implementing a bootstrap mechanism that requires exposing credentials,
weakening existing local authentication, or broadening remote authority.

Separate revocation invalidates the companion credential and active connections.
It need not delete browser enrollment in the separate companion, but that enrollment
must no longer authorize access to the revoked backend connection.

### 3. Enforcement and connection invalidation

Check effective RC policy and companion authority for every companion request.
Disabled or revoked companion access must fail closed for reads and writes.

Disabling or revoking also closes active event streams and any other long-lived
remote connections. Do not merely block the next reconnect. Ensure concurrent
requests cannot bypass the policy check through stale cached authorization.

Define the admission boundary precisely: work admitted before disablement can
continue, but new remote operations cannot be admitted after effective disablement.
Do not roll back execution or promise cancellation of work already running.

Local clients and local event streams remain unaffected. Reconnect cannot bypass
disabled policy. Do not require a functioning companion to disable RC.

### 4. Supported attachment and compatibility contract

Provide a documented way for an external companion to:

1. Locate the intended already-running backend.
2. Verify its instance identity, readiness, and compatible API capabilities.
3. Enroll locally and obtain companion-specific authorization securely.
4. Attach using that authorization without starting or replacing a server.
5. Reattach after restart while respecting current policy and revocation.

Existing areas worth inspecting, not prescriptions to import private internals:

- `packages/client/src/promise/service.ts`: registration-based discovery;
  `ensure()` can stop/replace servers and is unsuitable for passive attachment.
- `packages/cli/src/services/service-config.ts`: channel-specific registration and
  configuration paths; do not assume upstream default ports/paths.
- `packages/cli/src/server-process.ts`: service registration and lifecycle.

Do not hard-code machine paths, read or print real user credentials during tests,
or add a sibling-repository source dependency. Prefer stable published/generated
contracts over requiring the companion to import redsun's whole workspace closure.

Document the supported schema/API version or capabilities explicitly. Regenerate
clients using the repository's normal workflow after protocol changes.

### 5. Status with expiring companion liveness

Represent persistent policy separately from transient status:

| State | Meaning |
| --- | --- |
| Disabled | Backend refuses companion operations |
| Enabled, unavailable | Policy allows RC, but no live companion is known |
| Ready | Companion is live, with no authenticated browser reported connected |
| Connected | Live companion reports an authenticated browser connection |

Use an authenticated, bounded heartbeat/lease for companion liveness. Expiry must
clear stale connection status after companion failure. Only an authorized companion
may update its own status. Do not persist transient status across backend restarts.

The status is companion-reported observation, not proof that the phone can reach
the host or that Tailscale is healthy. Browser-connected must mean an authenticated
application connection, not just a TCP connection.

Status bookkeeping must not create a hidden remote-control exception while disabled.
If heartbeats are refused while disabled, the companion can retry after re-enablement;
document the reconnection behavior and lease timing.

Publish status changes through the existing event mechanism where appropriate.
Expose no secrets or unnecessary device details in status responses/events.

### 6. TUI controls and indicator

Add a local TUI command such as `/remote` opening status and enable/disable controls.
It must not submit a model prompt or rely on an active session.

- Show RC status on both Home and session routes using the existing dense layout.
- Clearly distinguish enabled-but-unavailable from connected.
- Keep disable accessible if the companion is missing or unresponsive.
- Offer credential revocation separately from normal disablement, with clear wording.
- Use the backend's effective state rather than a TUI-only preference.
- Preserve state and indicator semantics across `/cd` and session navigation.
- Do not install Tailscale, change Serve/Funnel settings, download the companion, or
  make companion lifecycle depend on the TUI process.

Follow existing branding, configuration, command, and TUI layout conventions.

## Permitted remote API audit

Inventory the minimum operations needed for the companion's initial vertical slice:

- Backend readiness and compatible capabilities, without secrets.
- Resolve workspace/location and list relevant sessions.
- Create/read sessions and history.
- Submit prompts, interrupt execution, and move a session's directory.
- Read/select supported agents and models through existing mechanisms.
- Read/reply to session questions/forms and tool permission requests.
- Subscribe to the events required to synchronize those operations.

This list is a functional target, not authorization to expose every existing route
in those domains. Audit response fields and events as well as mutations. Deny
unrecognized routes by default. Keep configuration documents, provider secrets,
arbitrary filesystem access, shell/PTY administration, plugin RPC, server shutdown,
and credential/policy management out unless separately justified and approved.

Do not change `/cd`, prompt deduplication, or event replay speculatively. Inspect
the existing contracts, document what the companion can rely on, and flag missing
capabilities. In particular, uncertain prompt submission must not be blindly retried;
report whether supplied message IDs support reconciliation/idempotency.

## Testing and acceptance criteria

Include unit tests plus integration tests through the real authenticated API seam:

1. Default policy is disabled.
2. Explicit enable/disable persists across backend restart.
3. Project selection/configuration and `/cd` cannot alter server-wide policy.
4. Policy/status work with no active session.
5. Ordinary disable preserves enrollment; re-enable accepts it again.
6. Revoked credentials remain invalid after re-enable and restart.
7. Companion credentials cannot authenticate as unrestricted local clients.
8. Disabled companion reads and writes are rejected.
9. Unknown/admin/credential/policy routes are refused for companion principals.
10. Disable/revoke closes already-open companion streams while local streams survive.
11. A request racing disablement respects the documented admission boundary.
12. A companion cannot spoof status for another principal or bypass auth with headers.
13. Lease expiry and restart clear transient connected status.
14. TUI closure leaves backend policy and companion operation intact.
15. Disabling does not cancel an already-admitted agent run.
16. Failed persistence is visible and follows the specified fail-closed behavior.
17. Secrets are absent from status, events, errors, and logs.
18. Generated clients and relevant typechecks pass.

Use isolated temporary credentials and fixtures, never the developer's actual
service registration, Tailscale network, or provider credentials. Remove temporary
files after verification. Do not stop/restart the user's real backend for tests.

## Out of scope

- Browser UI, browser passkeys/TOTP, recovery, and browser enrollment implementation.
- Tailscale installation/configuration or public network exposure.
- Multi-host gateway, host aggregation, or multi-user roles.
- Automatic companion distribution, installation, or process supervision.
- Duplicating redsun session storage or implementing another agent runtime.
- OS sandboxing or unconditional remote auto-approval.

## Deliverables for the remote-control agent

Provide a concise return document with:

- Implemented config key, file scope, persistence, and hot-update behavior.
- Local setup/enrollment/revocation commands or APIs and secure credential handoff.
- Discovery contract, instance identity, compatibility/version checks, and restart
  behavior. Distinguish durable backend identity from ephemeral process identity.
- Exact HTTP routes, authentication format, schemas, status/error codes, and allowed
  companion capabilities. Explain stream invalidation and request admission ordering.
- Heartbeat/status schema, lease timing, and event names.
- Existing session/location/form/permission APIs needed by the companion and any
  limitations discovered in prompt reconciliation or reconnect behavior.
- Supported way to consume generated types/client code from a separate repository.
- Changed files, verification commands/results, known gaps, and unresolved decisions.

Update redsun's own project memory to describe shipped behavior. Do not mark an
unimplemented companion/browser feature complete. Ask the user when an unresolved
choice changes product limitations, trust boundaries, or everyday behavior.
