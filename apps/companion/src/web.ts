import { Effect } from "effect"
import { assets } from "./assets"
import { embedded } from "./embedded"

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><title>redsun</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js" defer></script></body></html>`

export function web(origin: string) {
  return embedded.pipe(Effect.map((built) => assets(origin, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", {
    "/": { body: html, type: "text/html; charset=utf-8" },
    "/app.js": { body: built.web.script, type: "text/javascript; charset=utf-8" },
    "/app.css": { body: built.web.style, type: "text/css; charset=utf-8" },
  })))
}
