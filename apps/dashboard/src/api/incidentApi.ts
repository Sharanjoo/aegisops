import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type Incident,
} from '../types/incident'

/**
 * - "network": the request itself could not be sent/completed (offline,
 *   DNS failure, connection refused, CORS rejection, ...).
 * - "http": the incident service responded with a non-2xx status.
 * - "invalid-response": the response was reachable and 2xx, but its body
 *   did not match the incident/incident-list shape this dashboard trusts.
 */
export type IncidentApiErrorKind = 'network' | 'http' | 'invalid-response'

export class IncidentApiError extends Error {
  readonly kind: IncidentApiErrorKind
  readonly status?: number

  constructor(message: string, kind: IncidentApiErrorKind, status?: number) {
    super(message)
    this.name = 'IncidentApiError'
    this.kind = kind
    this.status = status
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
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
 * Parses and validates one incident against io.aegisops.incident.domain.Incident.
 * Shared by fetchIncidents (list) and fetchIncident (detail) so both
 * endpoints are held to the same authoritative shape. `context` is only
 * used to make a thrown error identify which element/request failed.
 */
function parseIncident(value: unknown, context: string): Incident {
  if (typeof value !== 'object' || value === null) {
    throw new IncidentApiError(`${context} is not an object`, 'invalid-response')
  }

  const candidate = value as Record<string, unknown>

  if (!isNonEmptyString(candidate.id)) {
    throw new IncidentApiError(`${context} is missing "id"`, 'invalid-response')
  }
  if (!isNonEmptyString(candidate.serviceName)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "serviceName"`,
      'invalid-response',
    )
  }
  if (!isNonEmptyString(candidate.title)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "title"`,
      'invalid-response',
    )
  }
  // description is required but may legitimately be "" - the incident
  // service coalesces a missing description to "" before persisting.
  if (!isString(candidate.description)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "description"`,
      'invalid-response',
    )
  }
  if (!isIncidentSeverity(candidate.severity)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} has an unrecognized "severity"`,
      'invalid-response',
    )
  }
  if (!isIncidentStatus(candidate.status)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} has an unrecognized "status"`,
      'invalid-response',
    )
  }
  if (!isNonEmptyString(candidate.createdAt)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "createdAt"`,
      'invalid-response',
    )
  }
  if (!isNonEmptyString(candidate.updatedAt)) {
    throw new IncidentApiError(
      `Incident ${candidate.id} is missing "updatedAt"`,
      'invalid-response',
    )
  }

  return {
    id: candidate.id,
    serviceName: candidate.serviceName,
    title: candidate.title,
    description: candidate.description,
    severity: candidate.severity,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

/**
 * Checks `.name === 'AbortError'` directly rather than `instanceof Error`,
 * because a real abort throws a DOMException, and DOMException does not
 * extend Error.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  )
}

/**
 * Fetches and JSON-decodes one URL, translating fetch/HTTP failures into
 * IncidentApiError. An abort is rethrown as-is (not wrapped) so callers can
 * keep using the standard `signal.aborted` / `error.name === 'AbortError'`
 * checks instead of unwrapping an IncidentApiError to find it.
 */
async function getJson(
  url: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    throw new IncidentApiError(
      `Could not reach the incident service at ${url}`,
      'network',
    )
  }

  if (!response.ok) {
    throw new IncidentApiError(
      `Incident service responded with ${response.status} ${response.statusText}`,
      'http',
      response.status,
    )
  }

  return response.json()
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
  const body = await getJson(`${baseUrl}/api/v1/incidents`, options.signal)

  if (!Array.isArray(body)) {
    throw new IncidentApiError(
      'Incident service response was not a JSON array',
      'invalid-response',
    )
  }

  return body.map((item, index) =>
    parseIncident(item, `Incident at index ${index}`),
  )
}

export interface FetchIncidentOptions {
  signal?: AbortSignal
}

/**
 * Loads one complete incident from
 * GET {baseUrl}/api/v1/incidents/{incidentId} (see
 * IncidentController#findById). Used to hydrate the full REST
 * representation of an incident named by a compact WebSocket event -
 * see state/useIncidentDashboard.ts.
 */
export async function fetchIncident(
  baseUrl: string,
  incidentId: string,
  options: FetchIncidentOptions = {},
): Promise<Incident> {
  const url = `${baseUrl}/api/v1/incidents/${encodeURIComponent(incidentId)}`
  const body = await getJson(url, options.signal)
  return parseIncident(body, `Incident ${incidentId}`)
}
