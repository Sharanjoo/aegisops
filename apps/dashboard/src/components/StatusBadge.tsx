import type { IncidentStatus } from '../types/incident'

const LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span className={`badge badge-status-${status.toLowerCase()}`}>
      {LABELS[status]}
    </span>
  )
}
