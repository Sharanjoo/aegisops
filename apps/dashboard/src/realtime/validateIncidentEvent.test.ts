import { describe, expect, it } from 'vitest'

import { parseIncidentEvent, validateIncidentEvent } from './validateIncidentEvent'
import { incidentCreatedEvent } from '../test/fixtures/incidents'

describe('validateIncidentEvent', () => {
  it('accepts a well-formed event matching the gateway contract', () => {
    const event = incidentCreatedEvent()
    expect(validateIncidentEvent(event)).toEqual(event)
  })

  it('rejects a non-object payload', () => {
    expect(validateIncidentEvent('not-an-object')).toBeNull()
    expect(validateIncidentEvent(null)).toBeNull()
    expect(validateIncidentEvent(42)).toBeNull()
  })

  it('rejects an unsupported event type', () => {
    const event = incidentCreatedEvent({
      eventType: 'INCIDENT_DELETED' as never,
    })
    expect(validateIncidentEvent(event)).toBeNull()
  })

  it('rejects an unsupported schema version', () => {
    const event = { ...incidentCreatedEvent(), eventVersion: 2 }
    expect(validateIncidentEvent(event)).toBeNull()
  })

  it('rejects a non-UUID eventId or incidentId', () => {
    expect(
      validateIncidentEvent(incidentCreatedEvent({ eventId: 'not-a-uuid' })),
    ).toBeNull()
    expect(
      validateIncidentEvent(
        incidentCreatedEvent({ incidentId: 'not-a-uuid' }),
      ),
    ).toBeNull()
  })

  it('rejects a missing or empty serviceName', () => {
    const event = { ...incidentCreatedEvent(), serviceName: '' }
    expect(validateIncidentEvent(event)).toBeNull()
  })

  it('rejects an invalid occurredAt timestamp', () => {
    const event = { ...incidentCreatedEvent(), occurredAt: 'not-a-date' }
    expect(validateIncidentEvent(event)).toBeNull()
  })
})

describe('parseIncidentEvent', () => {
  it('parses valid JSON matching the schema', () => {
    const event = incidentCreatedEvent()
    expect(parseIncidentEvent(JSON.stringify(event))).toEqual(event)
  })

  it('returns null for malformed JSON instead of throwing', () => {
    expect(() => parseIncidentEvent('{not valid json')).not.toThrow()
    expect(parseIncidentEvent('{not valid json')).toBeNull()
  })

  it('returns null for valid JSON that does not match the schema', () => {
    expect(parseIncidentEvent(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })
})
