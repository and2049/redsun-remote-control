export type RefreshResult = "ok" | "throttled"

type Options = {
  intervalMs: number
  retryMs: number
  now?: () => number
  schedule?: (callback: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

export type Scheduler = {
  request: (background: boolean) => void
  dispose: () => void
}

export function makeScheduler(run: (background: boolean) => Promise<RefreshResult>, options: Options): Scheduler {
  const now = options.now ?? (() => Date.now())
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms))
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let running = false
  let pending: boolean | undefined
  let lastStart = Number.NEGATIVE_INFINITY
  let timer: unknown
  let disposed = false

  function later(callback: () => void, ms: number) {
    if (timer !== undefined) return
    timer = schedule(() => {
      timer = undefined
      callback()
    }, ms)
  }

  function start(background: boolean) {
    running = true
    pending = undefined
    lastStart = now()
    run(background).then((result) => {
      running = false
      if (disposed) return
      if (result === "throttled") {
        pending = pending === undefined ? background : pending && background
        later(() => flush(), options.retryMs)
        return
      }
      flush()
    })
  }

  function flush() {
    if (pending === undefined) return
    const background = pending
    pending = undefined
    request(background)
  }

  function request(background: boolean) {
    if (disposed) return
    if (running) {
      pending = pending === undefined ? background : pending && background
      return
    }
    const wait = background ? lastStart + options.intervalMs - now() : 0
    if (wait > 0) {
      pending = pending === undefined ? background : pending && background
      later(() => flush(), wait)
      return
    }
    if (timer !== undefined) {
      cancel(timer)
      timer = undefined
    }
    start(background)
  }

  return {
    request,
    dispose: () => {
      disposed = true
      if (timer !== undefined) cancel(timer)
      timer = undefined
    },
  }
}
