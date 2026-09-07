import { Effect } from "effect"
import { assets } from "./assets"
import { embedded } from "./embedded"

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redsun diagnostic</title>
<body><h1>Redsun phone diagnostic</h1><p>Private trusted-owner control. Directory selection may load host plugins. This is not a filesystem sandbox.</p>
<button id="register">Register passkey</button><button id="login">Log in</button><button id="logout">Log out</button><button id="connect">Connect / refresh</button>
<pre id="notice" role="status"></pre><p>Compare the entire registration fingerprint on this page with the host before local approval. Registration alone does not log in.</p>
<label>Host directory <input id="directory"></label><button id="create">Create session</button><button id="list">List sessions</button>
<p><label>Session ID <input id="session"></label><button id="snapshot">History / inbox / permissions / forms</button><button id="interrupt">Interrupt</button></p>
<label>Prompt <textarea id="prompt" rows="5" cols="40"></textarea></label><button id="send">Send prompt</button><button id="reconcile">Reconcile pending prompt</button>
<p>Never blindly resend an uncertain prompt. Its retained ID is shown below; reconciliation checks the loaded inbox/history page.</p>
<details><summary>Structured operation (allowlisted APIs only)</summary><p>Use for pagination, location resolution, models/agents, moves, permissions and forms. Mutations affect shared backend state.</p>
<textarea id="operation" rows="8" cols="50">{"method":"GET","path":"/api/remote/agent","query":{}}</textarea><button id="execute">Execute operation</button></details>
<pre id="output"></pre><script src="/diagnostic.js" defer></script></body></html>`

export function diagnostic(origin: string) {
  return embedded.pipe(Effect.map((built) => assets(origin, "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", {
    "/diagnostic": { body: html, type: "text/html; charset=utf-8" },
    "/diagnostic.js": { body: built.diagnostic.script, type: "text/javascript; charset=utf-8" },
  })))
}
