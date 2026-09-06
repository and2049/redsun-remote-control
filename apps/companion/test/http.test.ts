import { describe, expect, test } from "bun:test"
import { handleRequest } from "../src/http"

describe("foundation HTTP surface", () => {
  test("reports foundation status without backend or device information", async () => {
    const response = handleRequest(new Request("http://localhost/health"))
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await response.json()).toEqual({
      service: "redsun-remote-control",
      protocolVersion: 1,
      stage: "foundation",
    })
  })

  test("rejects unsupported methods", () => {
    const response = handleRequest(new Request("http://localhost/health", { method: "POST" }))
    expect(response.status).toBe(405)
    expect(response.headers.get("Allow")).toBe("GET")
  })

  test.each(["/", "/api/session", "/api/event", "/auth/register", "/auth/login", "/health/", "/health/extra"])(
    "does not expose %s",
    (path) => expect(handleRequest(new Request(`http://localhost${path}`)).status).toBe(404),
  )
})
