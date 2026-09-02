import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from '../types/incident'
import type { IncidentFilters } from '../state/filterIncidents'

interface FiltersBarProps {
  filters: IncidentFilters
  onChange: (filters: IncidentFilters) => void
}

export function FiltersBar({ filters, onChange }: FiltersBarProps) {
  return (
    <search className="filters-bar" aria-label="Filter incidents">
      <div className="filter-field filter-field-search">
        <label htmlFor="incident-search">Search</label>
        <input
          id="incident-search"
          type="search"
          placeholder="Service, title, or ID"
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
        />
      </div>

      <div className="filter-field">
        <label htmlFor="incident-status-filter">Status</label>
        <select
          id="incident-status-filter"
          value={filters.status}
          onChange={(event) =>
            onChange({
              ...filters,
              status: event.target.value as IncidentFilters['status'],
            })
          }
        >
          <option value="ALL">All statuses</option>
          {INCIDENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-field">
        <label htmlFor="incident-severity-filter">Severity</label>
        <select
          id="incident-severity-filter"
          value={filters.severity}
          onChange={(event) =>
            onChange({
              ...filters,
              severity: event.target.value as IncidentFilters['severity'],
            })
          }
        >
          <option value="ALL">All severities</option>
          {INCIDENT_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
      </div>
    </search>
  )
}
