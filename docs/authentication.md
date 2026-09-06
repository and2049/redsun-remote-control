# Companion authentication backend

The authentication flow is implemented without frontend pages. Backend session/prompt
routes and Tailscale deployment remain unavailable. Do not expose the listener yet:
backend policy supervision and route/event authorization are still pending.

## Local operation

```text
bun run apps/companion/src/cli.ts serve --origin https://host.example.ts.net --port 43123
```

Use your explicitly selected HTTPS origin and unused loopback port, not the example
hostname. The listener binds only `127.0.0.1`; it does not terminate TLS, configure
Serve, or start redsun. An occupied port fails instead of choosing another port.
Configuration is supplied through these explicit arguments; the saved owner record
pins its origin and refuses an origin change until local recovery.

The foreground process reads these commands from its local stdin:

| Command | Behavior |
| --- | --- |
| `enroll` | Open a five-minute window, only when no owner is enrolled. |
| `pending` | List verified request IDs and their 32-character fingerprints. |
| `approve <requestID> <fingerprint>` | Persist the exact verified enrollment. Compare the entire fingerprint with the browser first. |
| `cancel` | Close the enrollment window; do not revoke an existing owner. |
| `recover confirm` | Invalidate browser sessions and ceremonies, remove owner enrollment, and permit fresh enrollment. Leave backend credentials unchanged. |

No HTTP route provides these local controls. Closing stdin does not stop the
listener. Noninteractive background enrollment control/IPC is not implemented;
use a foreground setup process for enrollment. Installation is not automatic.

With the companion stopped, browser recovery is also available as:

```text
bun run apps/companion/src/cli.ts recover --confirm
```

Offline recovery refuses to operate while another companion owns the store. It
does not stop that process. A persistent `owner.lock` file is normal: its existence
does not mean the store is locked, and it should not be deleted to bypass a live
lease. Windows uses Windows PowerShell/.NET exclusive sharing; Linux uses the
standard `/usr/bin/flock` utility and an inherited file descriptor. Linux runtime
verification remains pending; no utility was installed by this work.

## HTTP contract

All routes below require `POST`, the exact configured `Origin`, a matching Host,
and `Content-Type: application/json`. If `Sec-Fetch-Site` is present it must be
`same-origin`. There is no CORS allowance. Bodies are limited to 64 KiB and five
seconds of reading; compressed bodies are refused. Empty bodies in the table mean
the JSON object `{}`, not an absent body. Unknown request fields are rejected.

| Route | Body | Result |
| --- | --- | --- |
| `/auth/binding` | `{}` | Issue/reuse a server-generated browser-binding cookie; `{ready:true}`. |
| `/auth/register/options` | `{}` | With a valid binding and local enrollment window, return `{requestID,options}`. |
| `/auth/register/verify` | `{requestID,response}` | Verify WebAuthn registration and return `{requestID,fingerprint}`. No session is issued. |
| `/auth/login/options` | `{}` | With a valid binding and enrolled owner, return `{ceremonyID,options}`. |
| `/auth/login/verify` | `{ceremonyID,response}` | Verify authentication, persist the counter, then set the session cookie and return `{authenticated:true}`. |
| `/auth/session` | `{}` | Require a valid session; return `{authenticated:true}` and refresh idle activity. |
| `/auth/logout` | `{}` | Require a valid session; revoke it, expire its cookie, and return 204. |

`response` is the corresponding WebAuthn JSON response. Optional browser extension
results and response hints are bounded/validated but do not grant authority; only
the credential, signed ceremony data and registration transports are passed to the
verification core. Credential IDs and raw IDs must agree.

Cookies are `__Host-redsun-binding` (five-minute absolute lifetime) and
`__Host-redsun-session` (24-hour absolute/one-hour idle lifetime). Both use Path=/,
Secure, HttpOnly, SameSite=Strict and no Domain. Duplicate or malformed relevant
cookies are rejected. Tokens are not returned in JSON. Sessions and bindings are
in memory and do not survive restart. Reauthentication replaces the presented
session after a successful durable counter update.

The authentication surface has a process-wide token bucket: burst 30, replenishing
one request every two seconds. It does not trust forwarded IP headers as a rate-limit
identity. This bounds work for the initial single-controller scope, but a tailnet
peer can consume the shared budget; it is not per-device fairness. Binding capacity
is 128, login challenge capacity 128, pending enrollment capacity 32, session capacity
64. No backend credentials or owner public-key records are returned by these routes.

Failures have empty bodies and fixed statuses: malformed input 400, failed auth 401,
origin/host rejection 403, unknown route 404, wrong method 405, body timeout 408,
oversize 413, unsupported body type 415, rate limit 429, oversize Cookie header 431,
closed handler 503. Replies are no-store and carry no CORS permission.

## Persistence and recovery guarantees

All operational owner mutations share an exclusive store lease and an in-process
semaphore. Counter updates compare the current enrollment and counter with the
verified snapshot, allow valid zero-counter synced passkeys, and never change the
credential identity/key. Complete replacement files are flushed before atomic
publication. Windows executes owner mutations in the same process that holds the
lease, including when the parent dies during an operation.

Recovery invalidates sessions and in-flight login generations before waiting for
serialized deletion. A login cannot issue a session after recovery invalidates its
generation, even if a counter write had already started. Persistence failures do
not issue sessions; storage failure and lease loss fail closed. Uncertain filesystem
outcomes are not automatically retried. This does not claim simulated power-loss
or filesystem fault certification.

The auth service also has a fail-closed disable hook that invalidates sessions.
Recovery does not override that disabled state. Redsun policy events are not wired
to it yet; no real backend or phone/browser authenticator was used in these tests.
