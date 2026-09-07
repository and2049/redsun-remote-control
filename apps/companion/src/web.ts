import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { assets } from "./assets"

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>Redsun</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js" defer></script></body></html>`

export function web(origin: string) {
  return Effect.tryPromise({
    try: async () => {
      const build = await Bun.build({
        entrypoints: [fileURLToPath(new URL("../../web/src/main.tsx", import.meta.url))],
        target: "browser", minify: true, define: { "process.env.NODE_ENV": '"production"' },
      })
      const script = build.outputs.find((output) => output.kind === "entry-point" && output.path.endsWith(".js"))
      const style = build.outputs.find((output) => output.path.endsWith(".css"))
      if (!build.success || !script || !style) throw new Error("Web build failed")
      return assets(origin, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", {
        "/": { body: html, type: "text/html; charset=utf-8" },
        "/app.js": { body: await script.text(), type: "text/javascript; charset=utf-8" },
        "/app.css": { body: await style.text(), type: "text/css; charset=utf-8" },
      })
    },
    catch: () => new Error("Web build failed"),
  })
}
