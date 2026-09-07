import { useEffect, useRef, useState } from "react"
import { ApiError, events, type RefreshFrame } from "./api"

export type Connection = { state: "connecting" | "connected" | "disconnected"; message?: string }

const initialDelay = 2000
const maximumDelay = 30_000

export function useConnection(enabled: boolean, onFrame: (frame: RefreshFrame) => void, onUnauthorized: () => void): Connection {
  const [connection, setConnection] = useState<Connection>({ state: "connecting" })
  const frame = useRef(onFrame)
  const unauthorized = useRef(onUnauthorized)
  frame.current = onFrame
  unauthorized.current = onUnauthorized

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let delay = initialDelay
    async function loop() {
      while (!controller.signal.aborted) {
        setConnection({ state: "connecting" })
        try {
          await events((value) => {
            delay = initialDelay
            setConnection({ state: "connected", message: "Connected" })
            frame.current(value)
          }, controller.signal)
        } catch (failure) {
          if (controller.signal.aborted) return
          if (failure instanceof ApiError && failure.status === 401) {
            unauthorized.current()
            return
          }
          const message = failure instanceof Error ? failure.message : "Disconnected"
          setConnection({ state: "disconnected", message: `${message}; retrying` })
          await new Promise((resolve) => setTimeout(resolve, delay))
          delay = Math.min(maximumDelay, delay * 2)
        }
      }
    }
    void loop()
    return () => controller.abort()
  }, [enabled])

  return connection
}
