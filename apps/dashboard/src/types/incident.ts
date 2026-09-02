/**
 * Mirrors io.aegisops.incident.domain.IncidentSeverity from the incident service.
 */
export const INCIDENT_SEVERITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

/**
 * Mirrors io.aegisops.incident.domain.IncidentStatus from the incident service.
 */
export const INCIDENT_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
] as const

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

/**
 * Shape returned by GET /api/v1/incidents and GET /api/v1/incidents/{id} on
 * the incident service, matching io.aegisops.incident.domain.Incident.
 * `description` can be an empty string (the service coalesces a missing
 * description to "" before persisting - see IncidentApplicationService)
 * but is never null; the dashboard only ever displays this REST
 * representation, never a value synthesized from a WebSocket event - see
 * state/useIncidentDashboard.ts.
 */
export interface Incident {
  id: string
  serviceName: string
  title: string
  description: string
  severity: IncidentSeverity
  status: IncidentStatus
  createdAt: string
  updatedAt: string
}

/**
 * Event types the realtime gateway validates and broadcasts on
 * /ws/incidents (see services/realtime-gateway/src/kafka/incident-event.ts).
 */
export const INCIDENT_EVENT_TYPES = [
  'INCIDENT_CREATED',
  'INCIDENT_STATUS_CHANGED',
] as const

export type IncidentEventType = (typeof INCIDENT_EVENT_TYPES)[number]

/**
 * Wire shape broadcast by the realtime gateway over /ws/incidents. The
 * gateway's Zod schema only requires severity/status/previousStatus to be
 * non-empty strings, not members of the known enums, so the dashboard must
 * tolerate values outside IncidentSeverity/IncidentStatus without crashing.
 */
export interface IncidentRealtimeEvent {
  eventId: string
  eventType: IncidentEventType
  eventVersion: 1
  occurredAt: string
  incidentId: string
  serviceName: string
  severity: string
  status: string
  previousStatus: string | null
}
