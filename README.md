# Redsun Remote Control

A private, browser-based remote interface for an existing background redsun server,
using Tailscale for connectivity. Initially: one host and one remote controller.

**Backend in progress:** local approval, passkey authentication HTTP endpoints,
session cookies, credential persistence and browser recovery are implemented. There
is no web interface, operational redsun connection, or remote control yet.
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

## Local backend handoff import

```text
bun run apps/companion/src/cli.ts import-backend <absolute-private-handoff-file>
```

This validates and copies an existing redsun v1 handoff into `backend.json` under
`%LOCALAPPDATA%\redsun-remote-control` on Windows or
`${XDG_DATA_HOME:-$HOME/.local/share}/redsun-remote-control` on Linux. The parent
application-data directory must already exist. Windows requires Windows PowerShell
and owner-only ACLs; Linux requires owner-only permissions. Existing nonprivate
files/directories and symlink/reparse-point paths are refused, not repaired.

Import never overwrites an existing attachment, prints credentials, enables RC,
starts redsun, or opens a listener. It always preserves the source handoff; an
explicit source-deletion option remains pending. Import success verifies storage
and the handoff format, not backend readiness. No live service enrollment has been
performed by this project. Windows import is fixture-tested; Linux needs a live
verification run before deployment.

## Structure

- `apps/companion`: local service and eventual authenticated backend gateway.
  Its `src/auth` modules implement passkey verification, single-use challenges, and
  scoped session lifetimes, local enrollment approval, and authenticated HTTP routes.
  Its `src/backend` modules validate the pinned redsun RC contract and provide scoped
  status/heartbeat attachment. Its `src/storage` modules provide protected backend
  handoff import, serialized credential counter updates, and local browser recovery.
  Automatic reconnection is not implemented; no backend credentials
  are loaded by the development command.
- `apps/web`: reserved browser application boundary, pending upstream UI audit.
- `packages/protocol`: browser-safe companion contracts.
- `.redsun/memory.md`: live progress, architecture decisions, and open questions.

See [authentication backend operation and HTTP contract](docs/authentication.md)
for the explicit authenticated serve mode, local approval/recovery commands, security
limits and remaining deployment work. No-argument development mode remains health-only.
