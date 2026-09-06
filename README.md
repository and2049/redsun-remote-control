# Redsun Remote Control

A private, browser-based remote interface for an existing background redsun server,
using Tailscale for connectivity. Initially: one host and one remote controller.

**Foundation only:** a tested passkey verification core exists, but there is no web
interface, usable login/enrollment flow, operational backend connection, or remote access yet.
Do not expose this development listener through Tailscale Serve,
Funnel, a LAN binding, or a public proxy.

## Development

Requires Bun 1.4.0.

```text
bun install --frozen-lockfile
bun run typecheck
bun test
bun run dev
```

The development command prints an ephemeral loopback URL exposing only `GET /health`.
Ctrl+C stops the listener. No backend or networking configuration is changed.

## Structure

- `apps/companion`: local service and eventual authenticated backend gateway.
  Its `src/auth` modules implement passkey verification and single-use challenges,
  not browser sessions or local enrollment approval.
  Its `src/backend` modules validate the pinned redsun RC contract and provide scoped
  status/heartbeat attachment. Protected file import and automatic reconnection are
  not implemented; no backend credentials are loaded by the development command.
- `apps/web`: reserved browser application boundary, pending upstream UI audit.
- `packages/protocol`: browser-safe companion contracts.
- `.redsun/memory.md`: live progress, architecture decisions, and open questions.
