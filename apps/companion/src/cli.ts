#!/usr/bin/env bun
import { main } from "./main"

const controller = new AbortController()
const stop = () => controller.abort()
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
try {
  process.exitCode = await main(process.argv.slice(2), { signal: controller.signal })
} finally {
  process.removeListener("SIGINT", stop)
  process.removeListener("SIGTERM", stop)
}
