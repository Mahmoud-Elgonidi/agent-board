import { useEffect, useRef, useCallback } from 'react'

const WS_URL = `ws://${window.location.hostname}:${import.meta.env.VITE_BACKEND_PORT || 3001}`

export function useWebSocket(onMessage) {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[ws] Connected')
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }

    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data)
        onMessageRef.current(payload)
      } catch (err) {
        console.error('[ws] Parse error:', err)
      }
    }

    ws.onclose = () => {
      console.log('[ws] Disconnected — reconnecting in 3s')
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = (err) => {
      console.error('[ws] Error:', err)
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])
}
