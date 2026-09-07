import { expect, test } from "bun:test"
import { makeScheduler, type RefreshResult } from "../src/refresh"

function harness(results: RefreshResult[] = []) {
  let time = 0
  const timers: { at: number; callback: () => void }[] = []
  const runs: boolean[] = []
  const resolvers: ((result: RefreshResult) => void)[] = []
  const scheduler = makeScheduler(
    (background) => {
      runs.push(background)
      return new Promise<RefreshResult>((resolve) => {
        const queued = results.shift()
        if (queued) resolve(queued)
        else resolvers.push(resolve)
      })
    },
    {
      intervalMs: 4000,
      retryMs: 2000,
      now: () => time,
      schedule: (callback, ms) => {
        const entry = { at: time + ms, callback }
        timers.push(entry)
        return entry
      },
      cancel: (handle) => {
        const index = timers.indexOf(handle as { at: number; callback: () => void })
        if (index >= 0) timers.splice(index, 1)
      },
    },
  )
  async function advance(ms: number) {
    time += ms
    for (const entry of [...timers].filter((candidate) => candidate.at <= time)) {
      timers.splice(timers.indexOf(entry), 1)
      entry.callback()
    }
    await Promise.resolve()
    await Promise.resolve()
  }
  async function finish(result: RefreshResult = "ok") {
    resolvers.shift()?.(result)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { scheduler, runs, advance, finish, timers }
}

test("frames during a running refresh coalesce into one follow-up after the interval", async () => {
  const { scheduler, runs, finish, advance } = harness()
  scheduler.request(true)
  scheduler.request(true)
  scheduler.request(true)
  expect(runs).toEqual([true])
  await finish()
  expect(runs).toEqual([true])
  await advance(4000)
  expect(runs).toEqual([true, true])
  await finish()
  await advance(10_000)
  expect(runs).toHaveLength(2)
})

test("background refreshes respect the minimum interval and foreground refreshes do not", async () => {
  const { scheduler, runs, finish, advance } = harness()
  scheduler.request(true)
  await finish()
  await advance(1000)
  scheduler.request(true)
  expect(runs).toHaveLength(1)
  scheduler.request(false)
  expect(runs).toEqual([true, false])
  await finish()
  await advance(5000)
  expect(runs).toHaveLength(2)
})

test("a coalesced foreground request wins over background ones", async () => {
  const { scheduler, runs, finish } = harness()
  scheduler.request(true)
  scheduler.request(true)
  scheduler.request(false)
  await finish()
  expect(runs).toEqual([true, false])
})

test("throttled refreshes retry after the retry delay instead of immediately", async () => {
  const { scheduler, runs, advance } = harness(["throttled", "ok"])
  scheduler.request(false)
  await advance(0)
  expect(runs).toEqual([false])
  await advance(1000)
  expect(runs).toHaveLength(1)
  await advance(1000)
  expect(runs).toEqual([false, false])
})

test("deferred background refresh runs once the interval elapses", async () => {
  const { scheduler, runs, finish, advance } = harness()
  scheduler.request(true)
  await finish()
  await advance(500)
  scheduler.request(true)
  scheduler.request(true)
  expect(runs).toHaveLength(1)
  await advance(3500)
  expect(runs).toEqual([true, true])
})

test("dispose cancels pending timers", async () => {
  const { scheduler, runs, finish, advance, timers } = harness()
  scheduler.request(true)
  await finish()
  scheduler.request(true)
  expect(timers).toHaveLength(1)
  scheduler.dispose()
  expect(timers).toHaveLength(0)
  await advance(10_000)
  expect(runs).toHaveLength(1)
})
