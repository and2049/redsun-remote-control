import { expect, test } from "bun:test"
import { Effect } from "effect"
import { web } from "../src/web"

test("web assets build for production and enforce host, method and CSP boundaries", async () => {
  const origin = "https://host.example.ts.net"
  const handle = await Effect.runPromise(web(origin))
  const page = handle(new Request(origin))
  expect(page.status).toBe(200)
  expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8")
  expect(page.headers.get("cache-control")).toBe("no-store")
  expect(page.headers.get("x-content-type-options")).toBe("nosniff")
  expect(page.headers.get("referrer-policy")).toBe("no-referrer")
  expect(page.headers.get("content-security-policy")).toContain("style-src 'self'")
  expect(page.headers.get("content-security-policy")).toContain("img-src 'self' data:")
  expect(page.headers.get("content-security-policy")).not.toContain("unsafe-inline")
  const html = await page.text()
  expect(html).toContain("/app.js")
  expect(html).toContain("/app.css")
  expect(html).toContain('id="root"')
  const script = handle(new Request(origin + "/app.js"))
  expect(script.status).toBe(200)
  expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
  expect(await script.text()).not.toContain("jsx-dev-runtime")
  const style = handle(new Request(origin + "/app.css"))
  expect(style.status).toBe(200)
  expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8")
  expect(handle(new Request("https://attacker.example/")).status).toBe(403)
  expect(handle(new Request(origin, { headers: { Host: "attacker.example" } })).status).toBe(403)
  expect(handle(new Request(origin + "/?query=1")).status).toBe(403)
  for (const site of ["cross-site", "same-site"]) {
    expect(handle(new Request(origin, { headers: { "Sec-Fetch-Site": site } })).status).toBe(403)
  }
  for (const site of ["none", "same-origin"]) {
    expect(handle(new Request(origin, { headers: { "Sec-Fetch-Site": site } })).status).toBe(200)
  }
  const post = handle(new Request(origin, { method: "POST" }))
  expect(post.status).toBe(405)
  expect(post.headers.get("allow")).toBe("GET")
  expect(handle(new Request(origin + "/private.json")).status).toBe(404)
})
