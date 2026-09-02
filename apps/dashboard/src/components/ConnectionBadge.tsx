import type { ConnectionState } from '../realtime/useIncidentSocket'

const LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
}

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <output className={`connection-badge connection-badge-${state}`}>
      <span className="connection-dot" aria-hidden="true" />
      {LABELS[state]}
    </output>
  )
}
