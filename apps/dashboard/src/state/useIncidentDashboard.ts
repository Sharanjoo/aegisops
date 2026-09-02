import { useCallback, useEffect, useReducer, useState } from 'react'

import { fetchIncidents, IncidentApiError } from '../api/incidentApi'
import { useIncidentSocket, type ConnectionState } from '../realtime/useIncidentSocket'
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
}

/**
 * Loads the initial incident snapshot from the incident-service REST API,
 * then layers live updates from the realtime gateway on top of it via
 * incidentsReducer. REST provides the source of truth for what incidents
 * exist; the WebSocket only ever adjusts state already seeded (or
 * upserted) from that snapshot - see incidentsReducer for the exact
 * reconciliation rules.
 */
export function useIncidentDashboard(
  incidentApiBaseUrl: string,
  realtimeWsUrl: string,
): IncidentDashboardState {
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus>('loading')
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(incidentsReducer, initialIncidentsState)

  useEffect(() => {
    const controller = new AbortController()

    fetchIncidents(incidentApiBaseUrl, { signal: controller.signal })
      .then((incidents) => {
        dispatch({ type: 'SNAPSHOT_LOADED', incidents })
        setSnapshotStatus('ready')
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
  }, [incidentApiBaseUrl])

  const handleRealtimeEvent = useCallback((event: IncidentRealtimeEvent) => {
    dispatch({ type: 'REALTIME_EVENT', event })
  }, [])

  const connectionState = useIncidentSocket(realtimeWsUrl, handleRealtimeEvent)

  return {
    snapshotStatus,
    snapshotError,
    incidents: selectIncidentList(state),
    connectionState,
  }
}
