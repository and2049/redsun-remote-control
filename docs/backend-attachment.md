# Passive backend attachment

After explicitly enrolling and importing a backend handoff, check attachment with:

```text
bun run apps/companion/src/cli.ts check-backend
```

This loads the protected `backend.json` in the normal per-user companion data
directory, reads only its configured password-free discovery path, and performs
one scoped `GET /api/remote`. It validates durable backend identity, registration
process identity, supported version, enrollment and enabled policy. The network
request has a five-second deadline. Success means scoped status access worked at
that instant, not that remote browser operations or Tailscale are ready.

The command does not start a listener, send a heartbeat, enable remote control,
create enrollment, change Tailscale, or start/stop/replace redsun. It prints no
credential, discovery path, backend URL or backend response body. It accepts no
arbitrary endpoint argument. A failed check exits nonzero without retries.

## Discovery protection

`apps/companion/src/backend/discovery.ts` uses the same bounded, protected local
file reader as handoff import. Ownership and owner-only permissions are required;
symlink/reparse-point paths and ordinary registrations containing passwords are
rejected. JSON must be UTF-8 and match the exact password-free registration schema.
The endpoint is validated before any credential can be sent. Discovery never tries
fallback files, environment URLs, DNS aliases or the ordinary registration.

Missing, unreadable or insufficiently protected files yield a fixed unavailable
error without exposing filesystem details. Malformed JSON/schema and invalid
endpoints fail separately. No file permissions are automatically repaired.

The pinned redsun registration publisher uses `mode: 0600`. That provides the
intended Unix mode but does not itself establish a Windows owner-only ACL. Live
Windows setup must verify the published discovery file meets the companion's
protection requirement. This has not been checked against the user's runtime file;
do not weaken validation or change runtime permissions silently to make a check pass.

## Supervisor core

`apps/companion/src/backend/supervisor.ts` is an Effect-scoped core mounted by explicit
`serve --backend` mode. Its inputs explicitly specify request timeout,
heartbeat interval, retry delay, a trusted browser-connection predicate and an
idempotent invalidation effect. Heartbeat interval plus timeout must be below the
backend's thirty-second lease; approximately ten-second heartbeats are the contract's
recommended operating cadence. There is no implicit production timing configuration.

Each attempt rereads discovery, attaches and validates status, then sends an initial
heartbeat before publishing readiness. It sends subsequent heartbeats sequentially;
requests do not overlap. Only unavailable failures retry, after the configured delay
and fresh discovery. Refusal, identity mismatch, invalid contract or invalid endpoint
stop that supervisor instance. A caller must explicitly create a new instance rather
than silently adopting a different identity or overriding authorization refusal.

Each ready generation has an AbortSignal. Losing the connection aborts it and calls
the supplied invalidation effect before retry. Scope shutdown cancels pending HTTP
requests, stops heartbeats and invalidates the generation. The callback may run more
than once and must be idempotent. These signals are intended for browser resources,
never for interrupting admitted agent execution. Readiness exposes only state, stable
backend ID, process ID and that signal; no credential or network endpoint.

Heartbeat polling is supplemented by scoped SSE closure/status hints in operational
mode. Browser session invalidation, request authorization and subscribe-before-snapshot
refresh are wired there. Browser connection reporting counts authenticated control
streams, not merely cookies. Background traffic does not extend login idle lifetime.

## Path to a phone test

The companion-side diagnostic slice is implemented. Before exposure, real-redsun
integration and Windows discovery permissions still need verification, followed by
explicit approval of live enrollment/enablement, HTTPS origin, port and Serve mapping.
See [phone-test preflight](phone-test.md) for the exact mode, API limits and remaining
verification. Plain `bun dev` remains health-only; no automatic service setup or
Tailscale change is performed.
