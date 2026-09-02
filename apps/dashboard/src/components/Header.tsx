import { ConnectionBadge } from './ConnectionBadge'
import type { ConnectionState } from '../realtime/useIncidentSocket'

export function Header({ connectionState }: { connectionState: ConnectionState }) {
  return (
    <header className="app-header">
      <div className="app-header-brand">
        <span className="app-header-mark" aria-hidden="true">
          AO
        </span>
        <div>
          <p className="app-header-title">AegisOps</p>
          <p className="app-header-subtitle">Incident Command</p>
        </div>
      </div>
      <ConnectionBadge state={connectionState} />
    </header>
  )
}
