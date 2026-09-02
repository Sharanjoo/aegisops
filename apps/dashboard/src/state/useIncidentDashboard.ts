import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { fetchIncident, fetchIncidents, IncidentApiError } from '../api/incidentApi'
import {
  useIncidentSocket,
  type ConnectionState,
  type SocketOpenInfo,
} from '../realtime/useIncidentSocket'
import {
  incidentsReducer,
  initialIncidentsState,
  selectIncidentList,
} from './incidentsReducer'
import type { Incident, IncidentRealtimeEvent } from '../types/incident'

export type SnapshotStatus = 'loading' | 'error' | 'ready'

export interface IncidentDashboardState {
  snapshotStatus: SnapshotStatus
  snapshotError: string | null
  incidents: Incident[]
  connectionState: ConnectionState
  /** Non-fatal: set once automatic recovery from a reconciliation gap is exhausted. */
  reconciliationError: string | null
  /** Manually re-triggers a reconciliation refresh; clears reconciliationError on success. */
  retryReconciliation: () => void
}

export interface UseIncidentDashboardOptions {
  /** Overridable for tests; defaults to the browser's global WebSocket. */
  webSocketFactory?: (url: string) => WebSocket
}

const HYDRATION_MAX_ATTEMPTS = 3
const HYDRATION_RETRY_BASE_MS = 500
const HYDRATION_RETRY_MAX_MS = 4000

/** Delay before the Nth hydration retry (attempt is 1-indexed), capped exponential backoff. */
function computeHydrationRetryDelayMs(attempt: number): number {
  const delay = HYDRATION_RETRY_BASE_MS * 2 ** (attempt - 1)
  return Math.min(delay, HYDRATION_RETRY_MAX_MS)
}

const RECONCILIATION_MAX_ATTEMPTS = 3
const RECONCILIATION_RETRY_BASE_MS = 1000
const RECONCILIATION_RETRY_MAX_MS = 8000

/** Delay before the Nth reconciliation-refresh retry (attempt is 1-indexed), capped exponential backoff. */
function computeReconciliationRetryDelayMs(attempt: number): number {
  const delay = RECONCILIATION_RETRY_BASE_MS * 2 ** (attempt - 1)
  return Math.min(delay, RECONCILIATION_RETRY_MAX_MS)
}

const RECONCILIATION_ERROR_MESSAGE =
  'Some live incident updates could not be confirmed automatically.'

/** Caps the startup event buffer so a slow initial snapshot cannot let it grow without bound. */
const MAX_PENDING_EVENTS = 500

/**
 * Loads the initial incident snapshot from the incident-service REST API,
 * then reconciles live WebSocket events against it. The WebSocket event is
 * intentionally compact (see types/incident.ts) and is never used as a
 * source of displayable fields by itself: every valid event triggers a
 * GET /api/v1/incidents/{incidentId} fetch, and only that complete REST
 * representation is ever written into dashboard state (incidentsReducer's
 * INCIDENT_HYDRATED action). See docs/architecture.md for the full model.
 */
export function useIncidentDashboard(
  incidentApiBaseUrl: string,
  realtimeWsUrl: string,
  options: UseIncidentDashboardOptions = {},
): IncidentDashboardState {
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus>('loading')
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [reconciliationError, setReconciliationError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(incidentsReducer, initialIncidentsState)

  // Mirrors `state` for reading inside callbacks that must stay referentially
  // stable (see useIncidentSocket's guidance against unstable dependencies).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const baseUrlRef = useRef(incidentApiBaseUrl)
  useEffect(() => {
    baseUrlRef.current = incidentApiBaseUrl
  })

  // True once the initial snapshot has succeeded - gates normal event
  // processing (requirement: don't process events before the snapshot).
  const snapshotReadyRef = useRef(false)
  // Events that arrived before the initial snapshot succeeded; drained and
  // replayed through the normal path once it does. Bounded and deduplicated
  // by eventId so a slow snapshot cannot let this grow without limit; an
  // event that would overflow the cap is dropped, but its loss is recorded
  // and covered by a reconciliation refresh once the snapshot lands (REST
  // is authoritative, so that refresh recovers it regardless of which
  // notification was dropped).
  const pendingEventsRef = useRef<IncidentRealtimeEvent[]>([])
  const pendingEventIdsRef = useRef(new Set<string>())
  const pendingOverflowRef = useRef(false)

  // eventIds currently being hydrated (fetch in flight or a retry
  // scheduled) - prevents duplicate concurrent detail requests for the
  // same event. Separate from the reducer's processedEventIdSet, which
  // only ever gains an eventId once hydration has actually succeeded.
  const inFlightEventIdsRef = useRef(new Set<string>())
  const hydrationAbortControllersRef = useRef(new Map<string, AbortController>())
  const hydrationRetryTimeoutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Reconciliation-refresh bookkeeping. `reconciliationInFlightRef` is the
  // coalescing guard: any number of failed hydrations, a startup buffer
  // overflow, or a WebSocket reconnect that occur while a refresh cycle is
  // already running just fall in behind it instead of starting a parallel
  // cycle. This is the single fallback mechanism for every reconciliation
  // gap - there is no separate, weaker reconnect-only refresh path.
  const reconciliationInFlightRef = useRef(false)
  const reconciliationAbortControllerRef = useRef<AbortController | null>(null)
  const reconciliationRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A named function expression, not a `const` arrow function: the retry
  // path below calls triggerReconciliationRefresh recursively, and a
  // `const` binding is still in its temporal dead zone while its own
  // initializer runs.
  const triggerReconciliationRefresh = useCallback(
    function triggerReconciliationRefresh(attempt = 1) {
      if (attempt === 1) {
        if (reconciliationInFlightRef.current) {
          return
        }
        reconciliationInFlightRef.current = true
      }

      const controller = new AbortController()
      reconciliationAbortControllerRef.current = controller

      fetchIncidents(baseUrlRef.current, { signal: controller.signal })
        .then((incidents) => {
          reconciliationAbortControllerRef.current = null
          reconciliationInFlightRef.current = false
          dispatch({ type: 'SNAPSHOT_MERGED', incidents })
          setReconciliationError(null)
        })
        .catch(() => {
          reconciliationAbortControllerRef.current = null

          if (controller.signal.aborted) {
            reconciliationInFlightRef.current = false
            return
          }

          if (attempt >= RECONCILIATION_MAX_ATTEMPTS) {
            reconciliationInFlightRef.current = false
            setReconciliationError(RECONCILIATION_ERROR_MESSAGE)
            return
          }

          const delay = computeReconciliationRetryDelayMs(attempt)
          reconciliationRetryTimeoutRef.current = setTimeout(() => {
            reconciliationRetryTimeoutRef.current = null
            triggerReconciliationRefresh(attempt + 1)
          }, delay)
        })
    },
    [],
  )

  const retryReconciliation = useCallback(() => {
    setReconciliationError(null)
    triggerReconciliationRefresh()
  }, [triggerReconciliationRefresh])

  // A named function expression for the same reason as
  // triggerReconciliationRefresh above: hydrateEvent's retry path calls
  // itself recursively.
  const hydrateEvent = useCallback(
    function hydrateEvent(event: IncidentRealtimeEvent, attempt = 1) {
      const controller = new AbortController()
      hydrationAbortControllersRef.current.set(event.eventId, controller)

      fetchIncident(baseUrlRef.current, event.incidentId, {
        signal: controller.signal,
      })
        .then((incident) => {
          hydrationAbortControllersRef.current.delete(event.eventId)
          inFlightEventIdsRef.current.delete(event.eventId)
          dispatch({ type: 'INCIDENT_HYDRATED', eventId: event.eventId, incident })
        })
        .catch(() => {
          hydrationAbortControllersRef.current.delete(event.eventId)

          if (controller.signal.aborted) {
            inFlightEventIdsRef.current.delete(event.eventId)
            return
          }

          if (attempt >= HYDRATION_MAX_ATTEMPTS) {
            // Bounded retry exhausted. The event is not marked processed -
            // it stays out of the dedup cache (a temporary failure must
            // not poison it) - and a full reconciliation refresh takes
            // over instead: it fetches the authoritative snapshot and
            // merges it in, which recovers this incident (and anything
            // else affected) without ever needing to know which specific
            // event failed. This does not surface a fatal error for one
            // failed live update; reconciliationError is only set if the
            // fallback refresh itself is exhausted too.
            inFlightEventIdsRef.current.delete(event.eventId)
            triggerReconciliationRefresh()
            return
          }

          const delay = computeHydrationRetryDelayMs(attempt)
          const timeout = setTimeout(() => {
            hydrationRetryTimeoutsRef.current.delete(event.eventId)
            hydrateEvent(event, attempt + 1)
          }, delay)
          hydrationRetryTimeoutsRef.current.set(event.eventId, timeout)
        })
    },
    [triggerReconciliationRefresh],
  )

  const processEvent = useCallback(
    (event: IncidentRealtimeEvent) => {
      if (stateRef.current.processedEventIdSet.has(event.eventId)) {
        return
      }
      if (inFlightEventIdsRef.current.has(event.eventId)) {
        return
      }
      inFlightEventIdsRef.current.add(event.eventId)
      hydrateEvent(event)
    },
    [hydrateEvent],
  )

  const handleRealtimeEvent = useCallback(
    (event: IncidentRealtimeEvent) => {
      if (!snapshotReadyRef.current) {
        if (pendingEventIdsRef.current.has(event.eventId)) {
          return
        }
        if (pendingEventsRef.current.length >= MAX_PENDING_EVENTS) {
          pendingOverflowRef.current = true
          return
        }
        pendingEventsRef.current.push(event)
        pendingEventIdsRef.current.add(event.eventId)
        return
      }
      processEvent(event)
    },
    [processEvent],
  )

  useEffect(() => {
    const controller = new AbortController()

    fetchIncidents(incidentApiBaseUrl, { signal: controller.signal })
      .then((incidents) => {
        dispatch({ type: 'SNAPSHOT_LOADED', incidents })
        snapshotReadyRef.current = true
        setSnapshotStatus('ready')

        const pending = pendingEventsRef.current
        pendingEventsRef.current = []
        pendingEventIdsRef.current.clear()
        for (const event of pending) {
          processEvent(event)
        }

        // The startup buffer overflowed at some point - some notification
        // was dropped before the snapshot landed. A reconciliation refresh
        // recovers the true current state regardless of which one it was.
        if (pendingOverflowRef.current) {
          pendingOverflowRef.current = false
          triggerReconciliationRefresh()
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        const message =
          error instanceof IncidentApiError
            ? error.message
            : 'Failed to load incidents from the incident service'
        setSnapshotError(message)
        setSnapshotStatus('error')
      })

    return () => {
      controller.abort()
    }
  }, [incidentApiBaseUrl, processEvent, triggerReconciliationRefresh])

  const handleSocketOpen = useCallback(
    ({ isReconnect }: SocketOpenInfo) => {
      // Only refresh on an actual reconnect, and only once there is a
      // snapshot to merge into - the initial snapshot load (plus buffered
      // events) already covers the startup window. Reconnect recovery
      // shares the same bounded, coalesced reconciliation cycle as a
      // hydration-retry exhaustion or a startup buffer overflow: if one of
      // those is already refreshing, the reconnect falls in behind it
      // instead of starting a second, redundant request.
      if (isReconnect && snapshotReadyRef.current) {
        triggerReconciliationRefresh()
      }
    },
    [triggerReconciliationRefresh],
  )

  // Reads each ref's current value at cleanup time, not at effect-setup
  // time: these Maps/Sets are intentionally mutated after the effect below
  // runs (by hydrateEvent and triggerReconciliationRefresh), so cleanup
  // must see their latest contents.
  const cleanupHydration = useCallback(() => {
    for (const controller of hydrationAbortControllersRef.current.values()) {
      controller.abort()
    }
    hydrationAbortControllersRef.current.clear()

    for (const timeout of hydrationRetryTimeoutsRef.current.values()) {
      clearTimeout(timeout)
    }
    hydrationRetryTimeoutsRef.current.clear()

    reconciliationAbortControllerRef.current?.abort()
    if (reconciliationRetryTimeoutRef.current !== null) {
      clearTimeout(reconciliationRetryTimeoutRef.current)
      reconciliationRetryTimeoutRef.current = null
    }
    reconciliationInFlightRef.current = false
  }, [])

  useEffect(() => {
    return cleanupHydration
  }, [cleanupHydration])

  const connectionState = useIncidentSocket(realtimeWsUrl, handleRealtimeEvent, {
    onOpen: handleSocketOpen,
    webSocketFactory: options.webSocketFactory,
  })

  return {
    snapshotStatus,
    snapshotError,
    incidents: selectIncidentList(state),
    connectionState,
    reconciliationError,
    retryReconciliation,
  }
}
