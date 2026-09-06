import { fileURLToPath } from "node:url"
import { Effect } from "effect"

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
  return Effect.tryPromise(async () => {
    const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./diagnostic-browser.ts", import.meta.url))], target: "browser" })
    if (!build.success || !build.outputs[0]) throw new Error("Diagnostic build failed")
    const script = await build.outputs[0].text()
    return (request: Request) => {
      const url = new URL(request.url)
      const headers = {
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      }
      if (url.host !== new URL(origin).host || (request.headers.has("host") && request.headers.get("host") !== url.host) || url.search ||
        (request.headers.has("sec-fetch-site") && !["none", "same-origin"].includes(request.headers.get("sec-fetch-site") ?? ""))) return new Response(null, { status: 403, headers })
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } })
      if (url.pathname !== "/" && url.pathname !== "/diagnostic.js") return new Response(null, { status: 404, headers })
      return new Response(url.pathname === "/" ? html : script, { headers: { ...headers, "Content-Type": url.pathname === "/" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8" } })
    }
  })
}
