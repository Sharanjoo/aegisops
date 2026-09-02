import { coerceEnum } from './coerceEnum'
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type Incident,
  type IncidentRealtimeEvent,
} from '../types/incident'

const MAX_PROCESSED_EVENT_IDS = 1000

export interface IncidentsState {
  byId: Record<string, Incident>
  processedEventIds: readonly string[]
  processedEventIdSet: ReadonlySet<string>
}

export const initialIncidentsState: IncidentsState = {
  byId: {},
  processedEventIds: [],
  processedEventIdSet: new Set(),
}

export type IncidentsAction =
  | { type: 'SNAPSHOT_LOADED'; incidents: Incident[] }
  | { type: 'REALTIME_EVENT'; event: IncidentRealtimeEvent }

interface EventBookkeeping {
  processedEventIds: readonly string[]
  processedEventIdSet: ReadonlySet<string>
}

/** Records an event ID as processed, evicting the oldest once the cap is exceeded. */
function rememberEventId(
  state: IncidentsState,
  eventId: string,
): EventBookkeeping {
  const processedEventIds = [...state.processedEventIds, eventId]
  const processedEventIdSet = new Set(state.processedEventIdSet)
  processedEventIdSet.add(eventId)

  const overflow = processedEventIds.length - MAX_PROCESSED_EVENT_IDS
  if (overflow > 0) {
    const evicted = processedEventIds.splice(0, overflow)
    for (const id of evicted) {
      processedEventIdSet.delete(id)
    }
  }

  return { processedEventIds, processedEventIdSet }
}

function applyIncidentCreated(
  byId: Record<string, Incident>,
  event: IncidentRealtimeEvent,
): Record<string, Incident> {
  const existing = byId[event.incidentId]

  const incident: Incident = existing
    ? {
        ...existing,
        serviceName: event.serviceName,
        severity: coerceEnum(
          INCIDENT_SEVERITIES,
          event.severity,
          existing.severity,
        ),
        status: coerceEnum(INCIDENT_STATUSES, event.status, existing.status),
        updatedAt: event.occurredAt,
      }
    : {
        id: event.incidentId,
        serviceName: event.serviceName,
        // The WebSocket payload does not carry title/description - only
        // the REST snapshot does. Left null until/unless the REST snapshot
        // (re)supplies them.
        title: null,
        description: null,
        severity: coerceEnum(INCIDENT_SEVERITIES, event.severity, 'MEDIUM'),
        status: coerceEnum(INCIDENT_STATUSES, event.status, 'OPEN'),
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
      }

  return { ...byId, [incident.id]: incident }
}

function applyIncidentEvent(
  byId: Record<string, Incident>,
  event: IncidentRealtimeEvent,
): Record<string, Incident> {
  switch (event.eventType) {
    case 'INCIDENT_CREATED':
      return applyIncidentCreated(byId, event)
    case 'INCIDENT_STATUS_CHANGED':
      return applyIncidentStatusChanged(byId, event)
  }
}

function applyIncidentStatusChanged(
  byId: Record<string, Incident>,
  event: IncidentRealtimeEvent,
): Record<string, Incident> {
  const existing = byId[event.incidentId]

  // Per spec this event updates a known incident; an unknown incident ID
  // (e.g. the REST snapshot has not loaded yet) is ignored rather than
  // synthesized, since a status-changed event has no title/severity origin.
  if (!existing) {
    return byId
  }

  const updated: Incident = {
    ...existing,
    status: coerceEnum(INCIDENT_STATUSES, event.status, existing.status),
    updatedAt: event.occurredAt,
  }

  return { ...byId, [updated.id]: updated }
}

export function incidentsReducer(
  state: IncidentsState,
  action: IncidentsAction,
): IncidentsState {
  switch (action.type) {
    case 'SNAPSHOT_LOADED': {
      const byId: Record<string, Incident> = {}
      for (const incident of action.incidents) {
        byId[incident.id] = incident
      }
      return { ...state, byId }
    }

    case 'REALTIME_EVENT': {
      const { event } = action

      if (state.processedEventIdSet.has(event.eventId)) {
        return state
      }

      const bookkeeping = rememberEventId(state, event.eventId)

      return {
        ...bookkeeping,
        byId: applyIncidentEvent(state.byId, event),
      }
    }

    default:
      return state
  }
}

export function selectIncidentList(state: IncidentsState): Incident[] {
  return Object.values(state.byId).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )
}
