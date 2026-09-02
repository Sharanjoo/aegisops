import {
  INCIDENT_EVENT_TYPES,
  type IncidentRealtimeEvent,
} from '../types/incident'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  const parsed = Date.parse(value)
  return !Number.isNaN(parsed)
}

/**
 * Validates a decoded WebSocket payload against the incident-event schema
 * the realtime gateway enforces before it ever broadcasts a message (see
 * services/realtime-gateway/src/kafka/incident-event.ts). Returns null for
 * anything that does not match instead of throwing, so a single malformed
 * or unsupported message never crashes the dashboard - the caller just
 * discards it.
 */
export function validateIncidentEvent(
  value: unknown,
): IncidentRealtimeEvent | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (!isUuid(candidate.eventId)) {
    return null
  }

  if (
    typeof candidate.eventType !== 'string' ||
    !(INCIDENT_EVENT_TYPES as readonly string[]).includes(
      candidate.eventType,
    )
  ) {
    return null
  }

  if (candidate.eventVersion !== 1) {
    return null
  }

  if (!isIsoTimestamp(candidate.occurredAt)) {
    return null
  }

  if (!isUuid(candidate.incidentId)) {
    return null
  }

  if (!isNonEmptyString(candidate.serviceName)) {
    return null
  }

  if (!isNonEmptyString(candidate.severity)) {
    return null
  }

  if (!isNonEmptyString(candidate.status)) {
    return null
  }

  if (
    candidate.previousStatus !== null &&
    !isNonEmptyString(candidate.previousStatus)
  ) {
    return null
  }

  return {
    eventId: candidate.eventId,
    eventType: candidate.eventType as IncidentRealtimeEvent['eventType'],
    eventVersion: 1,
    occurredAt: candidate.occurredAt as string,
    incidentId: candidate.incidentId,
    serviceName: candidate.serviceName,
    severity: candidate.severity,
    status: candidate.status,
    previousStatus: candidate.previousStatus as string | null,
  }
}

/**
 * Parses and validates a raw WebSocket text frame. Returns null for
 * anything that is not valid JSON or does not match the event schema.
 */
export function parseIncidentEvent(
  raw: string,
): IncidentRealtimeEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return validateIncidentEvent(parsed)
}
