import { expect, test } from "bun:test"
import { Effect } from "effect"
import { serve } from "../src/server"

test("binds loopback, serves health, and releases its listener", async () => {
  const server = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* serve(0)
        expect(server.hostname).toBe("127.0.0.1")
        const response = yield* Effect.promise(() => fetch(new URL("/health", server.url)))
        expect(response.status).toBe(200)
        yield* Effect.promise(() => response.text())
        return server
      }),
    ),
  )
  await expect(fetch(new URL("/health", server.url))).rejects.toThrow()
})
