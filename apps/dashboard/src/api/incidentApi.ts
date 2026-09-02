import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type Incident,
} from '../types/incident'

export class IncidentApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IncidentApiError'
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isIncidentSeverity(value: unknown): value is Incident['severity'] {
  return (
    typeof value === 'string' &&
    (INCIDENT_SEVERITIES as readonly string[]).includes(value)
  )
}

function isIncidentStatus(value: unknown): value is Incident['status'] {
  return (
    typeof value === 'string' &&
    (INCIDENT_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Parses one element of the GET /api/v1/incidents response body, matching
 * io.aegisops.incident.domain.Incident. Throws IncidentApiError if the
 * incident service ever returns a shape this dashboard does not recognize,
 * surfacing a REST error state instead of rendering corrupt data.
 */
function parseIncident(value: unknown, index: number): Incident {
  if (typeof value !== 'object' || value === null) {
    throw new IncidentApiError(
      `Incident at index ${index} is not an object`,
    )
  }

  const candidate = value as Record<string, unknown>

  if (!isNonEmptyString(candidate.id)) {
    throw new IncidentApiError(`Incident at index ${index} is missing "id"`)
  }
  if (!isNonEmptyString(candidate.serviceName)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "serviceName"`,
    )
  }
  if (!isIncidentSeverity(candidate.severity)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} has an unrecognized "severity"`,
    )
  }
  if (!isIncidentStatus(candidate.status)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} has an unrecognized "status"`,
    )
  }
  if (!isNonEmptyString(candidate.createdAt)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "createdAt"`,
    )
  }
  if (!isNonEmptyString(candidate.updatedAt)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "updatedAt"`,
    )
  }

  return {
    id: candidate.id,
    serviceName: candidate.serviceName,
    title: typeof candidate.title === 'string' ? candidate.title : null,
    description:
      typeof candidate.description === 'string' ? candidate.description : null,
    severity: candidate.severity,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

export interface FetchIncidentsOptions {
  signal?: AbortSignal
}

/**
 * Loads the current incident snapshot from GET {baseUrl}/api/v1/incidents
 * (see IncidentController#findAll in the incident service).
 */
export async function fetchIncidents(
  baseUrl: string,
  options: FetchIncidentsOptions = {},
): Promise<Incident[]> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/v1/incidents`, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new IncidentApiError(
      `Could not reach the incident service at ${baseUrl}`,
    )
  }

  if (!response.ok) {
    throw new IncidentApiError(
      `Incident service responded with ${response.status} ${response.statusText}`,
    )
  }

  const body: unknown = await response.json()

  if (!Array.isArray(body)) {
    throw new IncidentApiError(
      'Incident service response was not a JSON array',
    )
  }

  return body.map((item, index) => parseIncident(item, index))
}
