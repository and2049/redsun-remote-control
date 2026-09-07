# Packaging the companion as `redsun-remote-control`

`apps/companion` is the publishable npm package. redsun depends on it so a host can
run the companion (`redsun remote companion ...`) and enroll from the TUI without a
temporary handoff file. The rest of the workspace (the React web app, tests, scripts)
is build input only.

## What the package contains

`bun run build` inside `apps/companion` produces `dist/`:

1. `script/build.ts` bundles the web app (`apps/web/src/main.tsx`) and the diagnostic
   page script with `Bun.build` and writes them as string constants to
   `src/generated/assets.ts` (gitignored). It then bundles `src/index.ts` into a
   single `dist/index.js` for the Bun target with all node_modules packages external
   and copies `src/cli.ts` as the `dist/cli.js` shim. Code splitting stays off:
   redsun's compiled-binary build rejects prebuilt chunks with duplicate output paths.
2. `tsc -p tsconfig.build.json` emits declarations next to the bundle.

`files` restricts the tarball to `dist`. `prepack` runs the build, so `npm pack` and
`npm publish` never ship stale output. Verify with `npm pack --dry-run`.

Runtime dependencies stay `effect` and `@simplewebauthn/server`; redsun already pins
the same Effect release, so one copy is shared in-process.

## Why assets are embedded

The companion no longer calls `Bun.build` at startup. Inside redsun's compiled
binary there are no sources to build from and no files next to `import.meta.url`.
`src/embedded.ts` first imports `./generated/assets`; when that module is absent
(a source checkout) it falls back to building from source, so `bun test` and
`bun run dev` keep working without a build step. `src/generated/assets.d.ts` is
committed so the import typechecks either way.

The Windows private-file helper is embedded the same way: `src/storage/powershell.ts`
imports `private-file.ps1` as text and launches Windows PowerShell with
`-EncodedCommand`. Lock mode is selected with the `REDSUN_PRIVATE_FILE_LOCK=1`
environment variable instead of a script parameter.

## Programmatic API

`src/index.ts` exports:

- `main(args, { signal, name? })`: the full CLI (`serve`, `import-backend`,
  `check-backend`, `recover --confirm`, `--help`). `name` is used in usage text so a
  host can present it as `redsun remote companion`. Returns the exit code.
- `serveCompanion({ origin, port, backend?, directory? })`: scoped Effect that
  validates the origin and port exactly like the CLI, starts the loopback listener
  and yields `command(line)` for the local approval commands.
- `importHandoff(handoff, directory?)`: in-process enrollment. Validates the v1
  handoff object and creates `backend.json` with the private-file rules. It never
  overwrites an existing handoff; the caller must revoke or remove it first.
- `serveCompanion` also yields `local`, the structured approval API (`open`, `pending`,
  `approve(requestID, fingerprint)`, `cancel`, `recover`) so a host can drive phone
  registration from its own UI instead of the stdin commands.
- `inspectTailscale(port)`: runs `tailscale status --json` and `tailscale serve status
  --json` and reports the MagicDNS host, the HTTPS origin, whether certificates are
  enabled and whether the Serve mapping for the port is `missing`, `ready` or
  `conflict`. `applyServe(port)` applies `tailscale serve --bg --https=443
  http://127.0.0.1:<port>` only when the mapping is missing and certificates exist;
  it refuses conflicts. `serveCommand(port)` is the display string. Both accept an
  injectable runner for tests and never reset existing Serve configuration.
- `importHandoffFile(path, directory?)`, `checkBackend(directory?)`,
  `recoverBrowser(directory?)`, `dataDirectory()`, `parseCommand`, `validateServe`,
  `StorageError`, and the `Health` type.

The `directory` override exists for host tests. Production callers omit it so the
per-user data directory is used.

## Publishing

Push a `v<version>` tag matching `apps/companion/package.json`. The
`Publish` workflow (`.github/workflows/publish.yml`) installs, typechecks, tests,
builds and runs `npm publish --provenance` from `apps/companion`. It relies on npm
trusted publishing (OpenID Connect), which must be configured for the package on
npmjs.com; the first release can be published manually with `npm publish` from
`apps/companion` if the package does not exist yet.

Local verification against redsun before publishing: `npm pack` in
`apps/companion`, then `bun add <tarball>` in the consuming redsun package. Restore
the pinned version before committing on the redsun side.
