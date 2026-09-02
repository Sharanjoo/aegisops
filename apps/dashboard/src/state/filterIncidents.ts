import type { Incident, IncidentSeverity, IncidentStatus } from '../types/incident'

export interface IncidentFilters {
  search: string
  status: IncidentStatus | 'ALL'
  severity: IncidentSeverity | 'ALL'
}

export const DEFAULT_INCIDENT_FILTERS: IncidentFilters = {
  search: '',
  status: 'ALL',
  severity: 'ALL',
}

export function filterIncidents(
  incidents: Incident[],
  filters: IncidentFilters,
): Incident[] {
  const term = filters.search.trim().toLowerCase()

  return incidents.filter((incident) => {
    if (filters.status !== 'ALL' && incident.status !== filters.status) {
      return false
    }
    if (filters.severity !== 'ALL' && incident.severity !== filters.severity) {
      return false
    }
    if (term.length === 0) {
      return true
    }

    const haystack = [incident.serviceName, incident.title, incident.id]
      .join(' ')
      .toLowerCase()

    return haystack.includes(term)
  })
}
