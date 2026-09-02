import { describe, expect, it } from 'vitest'

import {
  incidentsReducer,
  initialIncidentsState,
  selectIncidentList,
  type IncidentsState,
} from './incidentsReducer'
import {
  clusterAgentDemoIncident,
  inventoryApiIncident,
  paymentsApiIncident,
} from '../test/fixtures/incidents'
import type { Incident } from '../types/incident'

function loadSnapshot(incidents: Incident[]): IncidentsState {
  return incidentsReducer(initialIncidentsState, {
    type: 'SNAPSHOT_LOADED',
    incidents,
  })
}

describe('incidentsReducer', () => {
  describe('SNAPSHOT_LOADED', () => {
    it('establishes the initial incident set', () => {
      const state = loadSnapshot([paymentsApiIncident, inventoryApiIncident])

      expect(selectIncidentList(state)).toHaveLength(2)
      expect(state.byId[paymentsApiIncident.id]).toEqual(paymentsApiIncident)
    })

    it('wholesale-replaces byId, unlike a merge', () => {
      const first = loadSnapshot([paymentsApiIncident])
      const second = incidentsReducer(first, {
        type: 'SNAPSHOT_LOADED',
        incidents: [inventoryApiIncident],
      })

      expect(second.byId[paymentsApiIncident.id]).toBeUndefined()
      expect(second.byId[inventoryApiIncident.id]).toEqual(inventoryApiIncident)
    })
  })

  describe('INCIDENT_HYDRATED', () => {
    it('inserts a complete incident absent from state', () => {
      const state = incidentsReducer(initialIncidentsState, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: clusterAgentDemoIncident,
      })

      expect(state.byId[clusterAgentDemoIncident.id]).toEqual(
        clusterAgentDemoIncident,
      )
    })

    it('never inserts a partial incident - only a complete REST record ever reaches this action', () => {
      const state = incidentsReducer(initialIncidentsState, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: clusterAgentDemoIncident,
      })

      const incident = state.byId[clusterAgentDemoIncident.id]
      expect(incident?.title).toBe(clusterAgentDemoIncident.title)
      expect(incident?.description).toBe(clusterAgentDemoIncident.description)
    })

    it('updates a known incident in place', () => {
      const snapshot = loadSnapshot([paymentsApiIncident])
      const updated: Incident = {
        ...paymentsApiIncident,
        status: 'ACKNOWLEDGED',
        updatedAt: '2026-09-01T15:00:00Z',
      }

      const state = incidentsReducer(snapshot, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-2',
        incident: updated,
      })

      expect(state.byId[paymentsApiIncident.id]?.status).toBe('ACKNOWLEDGED')
    })

    it('marks the eventId as processed', () => {
      const state = incidentsReducer(initialIncidentsState, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: clusterAgentDemoIncident,
      })

      expect(state.processedEventIdSet.has('event-1')).toBe(true)
    })

    it('deduplicates by eventId: a second hydration for the same eventId is a no-op', () => {
      const first = incidentsReducer(initialIncidentsState, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: clusterAgentDemoIncident,
      })

      const staleReplay: Incident = {
        ...clusterAgentDemoIncident,
        status: 'RESOLVED',
      }

      const second = incidentsReducer(first, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: staleReplay,
      })

      expect(second).toBe(first)
      expect(second.byId[clusterAgentDemoIncident.id]?.status).toBe('OPEN')
    })

    it('rejects a hydration response older than the incident already in state', () => {
      const snapshot = loadSnapshot([paymentsApiIncident])

      const olderResponse: Incident = {
        ...paymentsApiIncident,
        status: 'RESOLVED',
        updatedAt: '2026-09-01T11:00:00Z', // before paymentsApiIncident.updatedAt
      }

      const state = incidentsReducer(snapshot, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: olderResponse,
      })

      // Rejected: the incident in state is unchanged...
      expect(state.byId[paymentsApiIncident.id]).toEqual(paymentsApiIncident)
      // ...but the event is still marked processed, since the failure here
      // is "this response was stale", not "hydration failed".
      expect(state.processedEventIdSet.has('event-1')).toBe(true)
    })

    it('retains the existing incident on an equal updatedAt rather than letting arrival order decide', () => {
      const snapshot = loadSnapshot([paymentsApiIncident])

      const sameTimestamp: Incident = {
        ...paymentsApiIncident,
        title: 'Re-fetched with the same updatedAt',
      }

      const state = incidentsReducer(snapshot, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: sameTimestamp,
      })

      expect(state.byId[paymentsApiIncident.id]?.title).toBe(
        paymentsApiIncident.title,
      )
    })

    it('applies a hydration response with a strictly newer updatedAt', () => {
      const snapshot = loadSnapshot([paymentsApiIncident])

      const newer: Incident = {
        ...paymentsApiIncident,
        title: 'Genuinely newer',
        updatedAt: '2026-09-01T12:00:00.001Z',
      }

      const state = incidentsReducer(snapshot, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: newer,
      })

      expect(state.byId[paymentsApiIncident.id]?.title).toBe('Genuinely newer')
    })

    it('keeps the bounded event-ID cache from growing without limit', () => {
      let state = initialIncidentsState

      for (let i = 0; i < 1500; i += 1) {
        state = incidentsReducer(state, {
          type: 'INCIDENT_HYDRATED',
          eventId: `event-${i}`,
          incident: { ...clusterAgentDemoIncident, id: `incident-${i}` },
        })
      }

      expect(state.processedEventIds.length).toBeLessThanOrEqual(1000)
      expect(state.processedEventIdSet.has('event-0')).toBe(false)
      expect(state.processedEventIdSet.has('event-1499')).toBe(true)
    })
  })

  describe('SNAPSHOT_MERGED', () => {
    it('upserts incidents without wiping ones absent from the refresh', () => {
      const state = loadSnapshot([paymentsApiIncident])

      const merged = incidentsReducer(state, {
        type: 'SNAPSHOT_MERGED',
        incidents: [inventoryApiIncident],
      })

      expect(merged.byId[paymentsApiIncident.id]).toEqual(paymentsApiIncident)
      expect(merged.byId[inventoryApiIncident.id]).toEqual(inventoryApiIncident)
    })

    it('inserts an incident that was created entirely while offline', () => {
      const state = incidentsReducer(initialIncidentsState, {
        type: 'SNAPSHOT_MERGED',
        incidents: [clusterAgentDemoIncident],
      })

      expect(state.byId[clusterAgentDemoIncident.id]).toEqual(
        clusterAgentDemoIncident,
      )
    })

    it('does not let a stale merged incident regress a newer hydrated one', () => {
      const hydrated = incidentsReducer(initialIncidentsState, {
        type: 'INCIDENT_HYDRATED',
        eventId: 'event-1',
        incident: {
          ...paymentsApiIncident,
          status: 'ACKNOWLEDGED',
          updatedAt: '2026-09-01T18:00:00Z',
        },
      })

      const merged = incidentsReducer(hydrated, {
        type: 'SNAPSHOT_MERGED',
        incidents: [paymentsApiIncident], // older updatedAt
      })

      expect(merged.byId[paymentsApiIncident.id]?.status).toBe('ACKNOWLEDGED')
    })
  })

  describe('selectIncidentList', () => {
    it('sorts by updatedAt descending', () => {
      const state = loadSnapshot([paymentsApiIncident, inventoryApiIncident])
      const list = selectIncidentList(state)
      expect(list[0]?.id).toBe(paymentsApiIncident.id)
      expect(list[1]?.id).toBe(inventoryApiIncident.id)
    })
  })
})
