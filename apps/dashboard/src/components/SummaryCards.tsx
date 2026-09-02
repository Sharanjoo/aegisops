import { useMemo } from 'react'

import type { Incident } from '../types/incident'

interface SummaryCardsProps {
  incidents: Incident[]
}

interface Summary {
  total: number
  open: number
  acknowledged: number
  urgentUnresolved: number
}

function summarize(incidents: Incident[]): Summary {
  let open = 0
  let acknowledged = 0
  let urgentUnresolved = 0

  for (const incident of incidents) {
    if (incident.status === 'OPEN') {
      open += 1
    }
    if (incident.status === 'ACKNOWLEDGED') {
      acknowledged += 1
    }
    if (
      incident.status !== 'RESOLVED' &&
      (incident.severity === 'HIGH' || incident.severity === 'CRITICAL')
    ) {
      urgentUnresolved += 1
    }
  }

  return { total: incidents.length, open, acknowledged, urgentUnresolved }
}

export function SummaryCards({ incidents }: SummaryCardsProps) {
  const summary = useMemo(() => summarize(incidents), [incidents])

  return (
    <dl className="summary-cards">
      <div className="summary-card">
        <dt>Total incidents</dt>
        <dd>{summary.total}</dd>
      </div>
      <div className="summary-card">
        <dt>Open</dt>
        <dd>{summary.open}</dd>
      </div>
      <div className="summary-card">
        <dt>Acknowledged</dt>
        <dd>{summary.acknowledged}</dd>
      </div>
      <div className="summary-card summary-card-urgent">
        <dt>Urgent &amp; unresolved</dt>
        <dd>{summary.urgentUnresolved}</dd>
      </div>
    </dl>
  )
}
