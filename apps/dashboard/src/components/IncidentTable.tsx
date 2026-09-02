import { SeverityBadge } from './SeverityBadge'
import { StatusBadge } from './StatusBadge'
import type { Incident } from '../types/incident'

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : timeFormatter.format(parsed)
}

interface IncidentTableProps {
  incidents: Incident[]
}

export function IncidentTable({ incidents }: IncidentTableProps) {
  return (
    <div className="incident-table-wrapper">
      <table className="incident-table">
        <caption className="visually-hidden">Current incidents</caption>
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Title</th>
            <th scope="col">Severity</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id}>
              <th scope="row">{incident.serviceName}</th>
              <td>
                {incident.title ?? (
                  <span className="incident-title-pending">
                    Details pending…
                  </span>
                )}
              </td>
              <td>
                <SeverityBadge severity={incident.severity} />
              </td>
              <td>
                <StatusBadge status={incident.status} />
              </td>
              <td>
                <time dateTime={incident.createdAt}>
                  {formatTimestamp(incident.createdAt)}
                </time>
              </td>
              <td>
                <time dateTime={incident.updatedAt}>
                  {formatTimestamp(incident.updatedAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
