import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { decodeHandoff } from "../../src/backend/contract"
import { discover } from "../../src/backend/discovery"
import { createPrivateFile, ensurePrivateDirectory } from "../../src/storage/private-file"
import { handoff, status } from "./fixture"

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), process.platform === "win32" ? "redsun/discovery-" : "redsun-discovery-"))
  const directory = path.join(root, "redsun-remote-control")
  await Effect.runPromise(ensurePrivateDirectory(directory))
  const registration = path.join(directory, "service.remote")
  return {
    root, directory, registration,
    enrollment: decodeHandoff({ ...handoff, registration }),
    write: (value: unknown) => Effect.runPromise(createPrivateFile(registration, Buffer.from(JSON.stringify(value)))),
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

const registration = { id: status.processID, version: "fixture", pid: process.pid, url: "http://127.0.0.1:12345" }

test("discovery reads only the protected path from the enrollment, without any network calls", async () => {
  await using data = await fixture()
  await data.write(registration)
  expect(await Effect.runPromise(discover(data.enrollment))).toEqual(registration)
}, 10000)

test.each([
  { ...registration, password: "synthetic-private-password" },
  { ...registration, url: "https://127.0.0.1" },
  { ...registration, url: "http://example.com" },
  { ...registration, url: "http://127.0.0.1/path" },
  { ...registration, pid: 0 },
])("discovery rejects unsafe or ordinary registrations", async (record) => {
  await using data = await fixture()
  await data.write(record)
  const error = await Effect.runPromise(discover(data.enrollment).pipe(Effect.flip))
  expect(["invalid-contract", "invalid-endpoint"]).toContain(error.reason)
  expect(String(error)).not.toContain("synthetic-private-password")
  expect(String(error)).not.toContain(data.registration)
}, 10000)

test("missing or nonprivate discovery fails safely without repairing the file", async () => {
  await using data = await fixture()
  expect((await Effect.runPromise(discover(data.enrollment).pipe(Effect.flip))).reason).toBe("unavailable")
  const outside = path.join(data.root, "unprotected.remote")
  await writeFile(outside, JSON.stringify(registration), { mode: 0o644 })
  const enrollment = decodeHandoff({ ...handoff, registration: outside })
  expect((await Effect.runPromise(discover(enrollment).pipe(Effect.flip))).reason).toBe("unavailable")
}, 10000)

test("CLI backend check loads protected enrollment and sends only one scoped status request", async () => {
  await using data = await fixture()
  const requests: string[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(request.headers.get("authorization")).toBe(`Bearer rc1.${handoff.credentialID}.${handoff.token}`)
    requests.push(`${request.method} ${new URL(request.url).pathname}`)
    return Response.json(status)
  } })
  try {
    await data.write({ ...registration, url: server.url.origin })
    await Effect.runPromise(createPrivateFile(path.join(data.directory, "backend.json"), Buffer.from(JSON.stringify({ ...handoff, registration: data.registration }))))
    const child = Bun.spawn([process.execPath, "run", fileURLToPath(new URL("../../src/cli.ts", import.meta.url)), "check-backend"], {
      env: { ...process.env, LOCALAPPDATA: data.root, XDG_DATA_HOME: data.root }, stdout: "pipe", stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect(code).toBe(0)
    expect(stdout).toContain("Backend identity and scoped access verified")
    expect(stdout + stderr).not.toContain(handoff.token)
    expect(stdout + stderr).not.toContain(data.registration)
    expect(requests).toEqual(["GET /api/remote"])
  } finally { await server.stop(true) }
}, 15000)
