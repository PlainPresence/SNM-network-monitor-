import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientToServerMessage, ServerToClientMessage, Snapshot } from './types'

export type ConnectionState = 'connecting' | 'open' | 'closed'

export function useTelemetryWs(url: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  const send = useMemo(() => {
    return (msg: ClientToServerMessage) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(msg))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let reconnectTimer: number | undefined

    function connect() {
      if (cancelled) return

      setConnection('connecting')

      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) return
        setConnection('open')
      }

      ws.onclose = () => {
        if (cancelled) return
        setConnection('closed')
        reconnectTimer = window.setTimeout(connect, 1000)
      }

      ws.onerror = () => {
        // close triggers reconnect
        try {
          ws.close()
        } catch {
          // ignore
        }
      }

      ws.onmessage = (evt) => {
        if (cancelled) return

        let msg: ServerToClientMessage
        try {
          msg = JSON.parse(String(evt.data))
        } catch {
          return
        }

        setSnapshot((prev) => {
          const base = prev

          if (msg.type === 'snapshot') return msg.data
          if (!base) return prev

          switch (msg.type) {
            case 'stats':
              return { ...base, stats: msg.data }
            case 'series':
              return { ...base, series: msg.data }
            case 'topTalkers':
              return { ...base, topTalkers: msg.data }
            case 'flows':
              return { ...base, flows: msg.data }
            case 'alerts':
              return { ...base, alerts: msg.data }
            case 'adapters':
              return { ...base, adapters: msg.data }
            case 'mode':
              return { ...base, mode: msg.data.mode }
            case 'selectedAdapter':
              return { ...base, selectedAdapterName: msg.data.selectedAdapterName }
            default:
              return base
          }
        })
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      try {
        wsRef.current?.close()
      } catch {
        // ignore
      }
      wsRef.current = null
    }
  }, [url])

  return { connection, snapshot, send }
}
