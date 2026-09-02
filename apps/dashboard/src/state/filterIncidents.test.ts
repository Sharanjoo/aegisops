import { describe, expect, it } from 'vitest'

import { DEFAULT_INCIDENT_FILTERS, filterIncidents } from './filterIncidents'
import { inventoryApiIncident, paymentsApiIncident } from '../test/fixtures/incidents'

const incidents = [paymentsApiIncident, inventoryApiIncident]

describe('filterIncidents', () => {
  it('returns every incident when no filters are active', () => {
    expect(filterIncidents(incidents, DEFAULT_INCIDENT_FILTERS)).toEqual(
      incidents,
    )
  })

  it('filters by status', () => {
    const result = filterIncidents(incidents, {
      ...DEFAULT_INCIDENT_FILTERS,
      status: 'ACKNOWLEDGED',
    })
    expect(result).toEqual([inventoryApiIncident])
  })

  it('filters by severity', () => {
    const result = filterIncidents(incidents, {
      ...DEFAULT_INCIDENT_FILTERS,
      severity: 'CRITICAL',
    })
    expect(result).toEqual([paymentsApiIncident])
  })

  it('matches search text against service name case-insensitively', () => {
    const result = filterIncidents(incidents, {
      ...DEFAULT_INCIDENT_FILTERS,
      search: 'PAYMENTS',
    })
    expect(result).toEqual([paymentsApiIncident])
  })

  it('matches search text against the incident title', () => {
    const result = filterIncidents(incidents, {
      ...DEFAULT_INCIDENT_FILTERS,
      search: 'synchronization',
    })
    expect(result).toEqual([inventoryApiIncident])
  })

  it('combines search and filter criteria', () => {
    const result = filterIncidents(incidents, {
      search: 'api',
      status: 'OPEN',
      severity: 'CRITICAL',
    })
    expect(result).toEqual([paymentsApiIncident])
  })

  it('returns an empty list when nothing matches', () => {
    const result = filterIncidents(incidents, {
      ...DEFAULT_INCIDENT_FILTERS,
      search: 'nonexistent-service',
    })
    expect(result).toEqual([])
  })
})
