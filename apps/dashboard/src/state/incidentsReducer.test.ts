import { describe, expect, it } from 'vitest'

import {
  incidentsReducer,
  initialIncidentsState,
  selectIncidentList,
} from './incidentsReducer'
import {
  incidentCreatedEvent,
  incidentStatusChangedEvent,
  inventoryApiIncident,
  paymentsApiIncident,
} from '../test/fixtures/incidents'

describe('incidentsReducer', () => {
  it('loads the REST snapshot as the initial incident set', () => {
    const state = incidentsReducer(initialIncidentsState, {
      type: 'SNAPSHOT_LOADED',
      incidents: [paymentsApiIncident, inventoryApiIncident],
    })

    expect(selectIncidentList(state)).toHaveLength(2)
    expect(state.byId[paymentsApiIncident.id]).toEqual(paymentsApiIncident)
  })

  it('inserts a new incident on INCIDENT_CREATED when it is unknown', () => {
    const event = incidentCreatedEvent()

    const state = incidentsReducer(initialIncidentsState, {
      type: 'REALTIME_EVENT',
      event,
    })

    const incident = state.byId[event.incidentId]
    expect(incident).toBeDefined()
    expect(incident?.serviceName).toBe(event.serviceName)
    expect(incident?.severity).toBe(event.severity)
    expect(incident?.status).toBe(event.status)
    // The gateway event carries no title/description.
    expect(incident?.title).toBeNull()
  })

  it('upserts an existing incident on INCIDENT_CREATED without discarding its title', () => {
    const snapshotState = incidentsReducer(initialIncidentsState, {
      type: 'SNAPSHOT_LOADED',
      incidents: [paymentsApiIncident],
    })

    const event = incidentCreatedEvent({
      incidentId: paymentsApiIncident.id,
      serviceName: paymentsApiIncident.serviceName,
      severity: 'HIGH',
      status: 'OPEN',
    })

    const state = incidentsReducer(snapshotState, {
      type: 'REALTIME_EVENT',
      event,
    })

    const incident = state.byId[paymentsApiIncident.id]
    expect(incident?.title).toBe(paymentsApiIncident.title)
    expect(incident?.severity).toBe('HIGH')
  })

  it('updates the matching incident on INCIDENT_STATUS_CHANGED', () => {
    const snapshotState = incidentsReducer(initialIncidentsState, {
      type: 'SNAPSHOT_LOADED',
      incidents: [paymentsApiIncident],
    })

    const event = incidentStatusChangedEvent({
      incidentId: paymentsApiIncident.id,
      status: 'ACKNOWLEDGED',
    })

    const state = incidentsReducer(snapshotState, {
      type: 'REALTIME_EVENT',
      event,
    })

    expect(state.byId[paymentsApiIncident.id]?.status).toBe('ACKNOWLEDGED')
    expect(state.byId[paymentsApiIncident.id]?.updatedAt).toBe(
      event.occurredAt,
    )
  })

  it('ignores INCIDENT_STATUS_CHANGED for an incident it has never seen', () => {
    const event = incidentStatusChangedEvent({
      incidentId: 'unknown-incident-id',
    })

    const state = incidentsReducer(initialIncidentsState, {
      type: 'REALTIME_EVENT',
      event,
    })

    expect(state.byId['unknown-incident-id']).toBeUndefined()
    expect(Object.keys(state.byId)).toHaveLength(0)
  })

  it('deduplicates events by eventId', () => {
    const snapshotState = incidentsReducer(initialIncidentsState, {
      type: 'SNAPSHOT_LOADED',
      incidents: [paymentsApiIncident],
    })

    const event = incidentStatusChangedEvent({
      incidentId: paymentsApiIncident.id,
      status: 'ACKNOWLEDGED',
    })

    const afterFirst = incidentsReducer(snapshotState, {
      type: 'REALTIME_EVENT',
      event,
    })

    // Same eventId, but this time claiming RESOLVED - should be ignored
    // entirely because the event was already processed.
    const afterDuplicate = incidentsReducer(afterFirst, {
      type: 'REALTIME_EVENT',
      event: { ...event, status: 'RESOLVED' },
    })

    expect(afterDuplicate.byId[paymentsApiIncident.id]?.status).toBe(
      'ACKNOWLEDGED',
    )
    expect(afterDuplicate).toBe(afterFirst)
  })

  it('falls back to the incident current value for an out-of-range severity or status', () => {
    const snapshotState = incidentsReducer(initialIncidentsState, {
      type: 'SNAPSHOT_LOADED',
      incidents: [paymentsApiIncident],
    })

    const event = incidentStatusChangedEvent({
      incidentId: paymentsApiIncident.id,
      status: 'SOMETHING_UNEXPECTED',
    })

    const state = incidentsReducer(snapshotState, {
      type: 'REALTIME_EVENT',
      event,
    })

    expect(state.byId[paymentsApiIncident.id]?.status).toBe(
      paymentsApiIncident.status,
    )
  })
})
