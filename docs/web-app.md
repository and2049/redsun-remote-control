# Web app architecture

The product UI is served by `serve --backend` at `/` with `/app.js` and `/app.css`; the
older dependency-free diagnostic remains at `/diagnostic`. Both share the same request
guards (exact host, no query string, same-origin fetch metadata, GET only) and a strict
Content Security Policy with no inline script or style. React ships its production build;
the bundle is built once per companion start, so a source change needs a restart.

## Layout

Mobile (below 48rem) uses stack navigation like a chat app: the session list is a full
screen, opening a session shows the chat with a back button, and sheets slide up from the
bottom. Desktop shows the session list as a sidebar next to the chat. Safe-area insets
are respected for notched phones. Prose uses a serif stack, chrome uses the system sans
stack, code uses monospace. Colors follow the light and dark schemes automatically.

## Authentication

`Auth` offers sign-in and registration with passkeys through the native WebAuthn JSON
helpers. Registration shows the request ID and fingerprint that must be compared and
approved on the host; it never signs the browser in. Any 401 from the control routes
returns the app to the sign-in screen.

## Data flow

The client subscribes to `/control/events` before loading state. Frames carry only a
backend ID and a revision. A changed revision requests a background refresh (session list,
active map, and for the selected session its latest 200 messages, inbox, pending
permissions and forms; session info comes from the list). Unchanged frames trigger a
refresh only as a 30-second backstop. A scheduler (`src/refresh.ts`) serializes refreshes,
coalesces hints that arrive while one runs, keeps background refreshes at least four
seconds apart so a busy agent turn stays within the companion's shared rate budget
(burst 60, two per second), and retries quietly after two seconds when a request is
rate limited. User actions refresh immediately.
Background refreshes carry `X-Redsun-Activity: background` so they do not extend session
idle expiry; user actions refresh in the foreground. The stream reconnects with
exponential backoff between two and thirty seconds. A backend ID change clears the
selection and retained state.

Sessions are listed newest first, top-level only (`parentID=null`), grouped by recency.
Directories from listed sessions feed the recent-directory suggestions.

## Prompts and uncertainty

Every prompt gets a client-generated `msg_` ID stored in tab `sessionStorage` under a key
scoped by backend and session before the request is sent. The composer is disabled while
a prompt is retained. On success the key is cleared. A 400 or 429 means the companion
rejected the request before contacting the backend, so the retention is dropped and the
error is shown. Any other failure keeps the prompt as unconfirmed: each refresh checks the
loaded inbox and history page for that ID and clears it when found, and the chat shows a
notice with a Discard action. Nothing is ever resent automatically. Session creation uses
the same pattern with a retained `ses_` ID; a retained ID that resolves to an existing
session is reopened instead of recreated.

## Attachments

The composer accepts up to four files of type PNG, JPEG, WebP or plain text, encoded as
base64 data URIs, and refuses selections whose encoded size would approach the 6 MiB
request limit. Nothing is fetched by URL or read from the host filesystem.

## Session actions

The header menu offers changing the host directory (a queued move that is confirmed by
the next snapshot, not by the 204), interrupting execution, opening the diagnostic page and
signing out. The composer pills open model and agent pickers loaded from the scoped
catalogs for the session location. Pending permissions and supported forms render above
the composer one at a time. The new-session sheet queries catalogs only when the directory
field is committed (blur), never per keystroke, because each location query makes the
backend resolve that path and possibly load project plugins.

## Limits

No message pagination beyond the newest 200; no session archive, fork, rename or delete;
no delivery selection (prompts sent while running are queued by the backend default); no
push notifications. The scoped event stream carries no message deltas, so streaming text
appears at the refresh cadence rather than token by token.
