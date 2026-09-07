export type Health = {
  readonly service: "redsun-remote-control"
  readonly protocolVersion: 1
  readonly stage: "foundation"
}

export function handleRequest(request: Request): Response {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }
  if (new URL(request.url).pathname !== "/health") {
    return new Response(null, { status: 404, headers })
  }
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } })
  }
  const health: Health = {
    service: "redsun-remote-control",
    protocolVersion: 1,
    stage: "foundation",
  }
  return Response.json(health, { headers })
}
