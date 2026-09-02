import type { ConnectionState } from '../realtime/useIncidentSocket'

const MESSAGES: Partial<Record<ConnectionState, string>> = {
  reconnecting: 'Live updates interrupted — reconnecting…',
  disconnected: 'Live updates unavailable — retrying shortly.',
}

/** Shown only while the realtime connection is not live, so the operator knows the list may be stale. */
export function WebSocketBanner({ state }: { state: ConnectionState }) {
  const message = MESSAGES[state]

  if (!message) {
    return null
  }

  return <output className="websocket-banner">{message}</output>
}
