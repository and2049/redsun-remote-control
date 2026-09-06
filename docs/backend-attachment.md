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

`apps/companion/src/backend/supervisor.ts` is an Effect-scoped core, not yet mounted
in the authenticated serve command. Its inputs explicitly specify request timeout,
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

Heartbeat polling is not immediate policy notification. Scoped SSE closure/status
hints, browser session invalidation, request authorization, subscribe-before-snapshot
synchronization and actual session/prompt adapters still need operational wiring.
No browser connection count is inferred from a cookie or kept alive by background
stream traffic in this core.

## Path to a phone test

Before exposing the companion through private Tailscale Serve:

1. Wire supervised attachment to browser authorization and policy teardown.
2. Add the restricted session/prompt operations and scoped event synchronization.
3. Add a minimal diagnostic browser page for passkey enrollment/login and smoke
   testing, separate from the deferred product UI.
4. Verify attachment against an isolated real redsun process, then explicitly approve
   the live service enrollment/enablement, HTTPS origin, port and Serve configuration.

Plain `bun dev` remains the loopback health-only development listener. No phone-ready
mode, automatic service setup or Tailscale exposure is implemented by this increment.
