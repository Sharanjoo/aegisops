import type { Incident } from '../types/incident'

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
  /** Initial page-load snapshot: establishes state before the socket starts. */
  | { type: 'SNAPSHOT_LOADED'; incidents: Incident[] }
  /** Reconnection-recovery snapshot: merges safely with events arriving concurrently. */
  | { type: 'SNAPSHOT_MERGED'; incidents: Incident[] }
  /** A WebSocket event's incident has been fetched in full via REST and is ready to apply. */
  | { type: 'INCIDENT_HYDRATED'; eventId: string; incident: Incident }

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

/**
 * True when `incoming` is strictly newer than `existing` and therefore safe
 * to apply. A missing `existing` is always safe (there is nothing to
 * regress). Equal timestamps retain the existing incident rather than
 * letting arrival order decide the winner - applied consistently for
 * hydrated incidents, snapshot merges, and reconciliation refreshes, since
 * all three route through this same helper.
 */
function isSafeToApply(
  incoming: Incident,
  existing: Incident | undefined,
): boolean {
  if (!existing) {
    return true
  }

  const incomingTime = Date.parse(incoming.updatedAt)
  const existingTime = Date.parse(existing.updatedAt)

  if (Number.isNaN(incomingTime) || Number.isNaN(existingTime)) {
    return true
  }

  return incomingTime > existingTime
}

/**
 * Upserts one incident, guarded against a slower/older REST response
 * regressing an incident a more recent hydration or merge already applied.
 */
function upsertIncident(
  byId: Record<string, Incident>,
  incident: Incident,
): Record<string, Incident> {
  if (!isSafeToApply(incident, byId[incident.id])) {
    return byId
  }
  return { ...byId, [incident.id]: incident }
}

function mergeIncidents(
  byId: Record<string, Incident>,
  incidents: Incident[],
): Record<string, Incident> {
  let next = byId
  for (const incident of incidents) {
    next = upsertIncident(next, incident)
  }
  return next
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

    case 'SNAPSHOT_MERGED': {
      return { ...state, byId: mergeIncidents(state.byId, action.incidents) }
    }

    case 'INCIDENT_HYDRATED': {
      // Defense in depth: the orchestration layer already checks this
      // before dispatching, but two hydrations for the same eventId could
      // in principle be dispatched before either is processed.
      if (state.processedEventIdSet.has(action.eventId)) {
        return state
      }

      const bookkeeping = rememberEventId(state, action.eventId)

      return {
        ...bookkeeping,
        byId: upsertIncident(state.byId, action.incident),
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
