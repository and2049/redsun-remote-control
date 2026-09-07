type Asset = { body: string; type: string }

export function assets(origin: string, policy: string, files: Readonly<Record<string, Asset>>) {
  return (request: Request) => {
    const url = new URL(request.url)
    const headers = {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": policy,
    }
    if (url.host !== new URL(origin).host || (request.headers.has("host") && request.headers.get("host") !== url.host) || url.search ||
      (request.headers.has("sec-fetch-site") && !["none", "same-origin"].includes(request.headers.get("sec-fetch-site") ?? ""))) return new Response(null, { status: 403, headers })
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } })
    const asset = Object.hasOwn(files, url.pathname) ? files[url.pathname] : undefined
    if (!asset) return new Response(null, { status: 404, headers })
    return new Response(asset.body, { headers: { ...headers, "Content-Type": asset.type } })
  }
}
