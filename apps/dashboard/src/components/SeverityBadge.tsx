import type { IncidentSeverity } from '../types/incident'

const LABELS: Record<IncidentSeverity, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
}

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return (
    <span className={`badge badge-severity-${severity.toLowerCase()}`}>
      {LABELS[severity]}
    </span>
  )
}
