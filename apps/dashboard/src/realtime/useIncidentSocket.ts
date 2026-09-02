import { useEffect, useRef, useState } from 'react'

import { parseIncidentEvent } from './validateIncidentEvent'
import type { IncidentRealtimeEvent } from '../types/incident'

export type ConnectionState =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'disconnected'

const INITIAL_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 30_000
const BACKOFF_FACTOR = 2

/** Delay before the Nth reconnect attempt (attempt is 1-indexed), capped exponential backoff. */
export function computeRetryDelayMs(attempt: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * BACKOFF_FACTOR ** (attempt - 1)
  return Math.min(delay, MAX_RETRY_DELAY_MS)
}

export interface UseIncidentSocketOptions {
  /** Overridable for tests; defaults to the browser's global WebSocket. */
  webSocketFactory?: (url: string) => WebSocket
}

/**
 * Owns the lifecycle of the /ws/incidents connection: connects on mount,
 * reconnects automatically with capped exponential backoff after any close
 * or error, forwards each validated event to onEvent, and tears everything
 * down on unmount. Malformed or unsupported frames are dropped silently
 * (see parseIncidentEvent) rather than throwing.
 */
export function useIncidentSocket(
  url: string,
  onEvent: (event: IncidentRealtimeEvent) => void,
  options: UseIncidentSocketOptions = {},
): ConnectionState {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')

  const onEventRef = useRef(onEvent)
  const webSocketFactoryRef = useRef(options.webSocketFactory)

  useEffect(() => {
    onEventRef.current = onEvent
    webSocketFactoryRef.current = options.webSocketFactory
  })

  useEffect(() => {
    let cancelled = false
    let socket: WebSocket | undefined
    let retryTimeout: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    function connect() {
      if (cancelled) {
        return
      }

      setConnectionState(attempt === 0 ? 'connecting' : 'reconnecting')

      const createSocket = webSocketFactoryRef.current ?? ((target: string) => new WebSocket(target))
      socket = createSocket(url)
      // A socket failure fires both "error" and "close" (error first). This
      // flag ensures the pair only triggers one reconnect attempt.
      let settled = false

      socket.addEventListener('open', () => {
        if (cancelled) {
          return
        }
        attempt = 0
        setConnectionState('live')
      })

      socket.addEventListener('message', (messageEvent: MessageEvent) => {
        if (cancelled || typeof messageEvent.data !== 'string') {
          return
        }
        const event = parseIncidentEvent(messageEvent.data)
        if (event) {
          onEventRef.current(event)
        }
      })

      const handleDisconnect = () => {
        if (settled) {
          return
        }
        settled = true
        scheduleReconnect()
      }

      socket.addEventListener('close', handleDisconnect)
      socket.addEventListener('error', handleDisconnect)
    }

    function scheduleReconnect() {
      if (cancelled) {
        return
      }

      setConnectionState('disconnected')
      attempt += 1
      const delay = computeRetryDelayMs(attempt)
      retryTimeout = setTimeout(connect, delay)
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimeout !== undefined) {
        clearTimeout(retryTimeout)
      }
      // No need to remove the close/error listeners individually: both
      // scheduleReconnect and handleDisconnect check `cancelled` (or, for
      // handleDisconnect, are scoped to a socket about to be discarded)
      // before doing anything, so closing here is sufficient.
      socket?.close()
    }
  }, [url])

  return connectionState
}
