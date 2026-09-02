/**
 * Development/test fixtures only - never imported from production code
 * (src/App.tsx and friends). Shapes mirror the real incident-service and
 * realtime-gateway contracts documented in docs/architecture.md and
 * services/realtime-gateway/README.md.
 */
import type { Incident, IncidentRealtimeEvent } from '../../types/incident'

export const paymentsApiIncident: Incident = {
  id: '11111111-1111-4111-8111-111111111111',
  serviceName: 'payments-api',
  title: 'Elevated HTTP error rate',
  description: 'HTTP 5xx threshold exceeded',
  severity: 'CRITICAL',
  status: 'OPEN',
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
}

export const inventoryApiIncident: Incident = {
  id: '22222222-2222-4222-8222-222222222222',
  serviceName: 'inventory-api',
  title: 'Inventory synchronization failure',
  description: '',
  severity: 'MEDIUM',
  status: 'ACKNOWLEDGED',
  createdAt: '2026-09-01T09:00:00Z',
  updatedAt: '2026-09-01T10:30:00Z',
}

/** The complete REST record for the incident named by incidentCreatedEvent(). */
export const clusterAgentDemoIncident: Incident = {
  id: '44444444-4444-4444-8444-444444444444',
  serviceName: 'cluster-agent-demo',
  title: 'Kubernetes pod crashloop-demo is repeatedly restarting',
  description: 'CrashLoopBackOff detected in cluster kind-aegisops-dev.',
  severity: 'HIGH',
  status: 'OPEN',
  createdAt: '2026-09-01T13:00:00Z',
  updatedAt: '2026-09-01T13:00:00Z',
}

export function incidentCreatedEvent(
  overrides: Partial<IncidentRealtimeEvent> = {},
): IncidentRealtimeEvent {
  return {
    eventId: '33333333-3333-4333-8333-333333333333',
    eventType: 'INCIDENT_CREATED',
    eventVersion: 1,
    occurredAt: '2026-09-01T13:00:00Z',
    incidentId: '44444444-4444-4444-8444-444444444444',
    serviceName: 'cluster-agent-demo',
    severity: 'HIGH',
    status: 'OPEN',
    previousStatus: null,
    ...overrides,
  }
}

export function incidentStatusChangedEvent(
  overrides: Partial<IncidentRealtimeEvent> = {},
): IncidentRealtimeEvent {
  return {
    eventId: '55555555-5555-4555-8555-555555555555',
    eventType: 'INCIDENT_STATUS_CHANGED',
    eventVersion: 1,
    occurredAt: '2026-09-01T14:00:00Z',
    incidentId: paymentsApiIncident.id,
    serviceName: paymentsApiIncident.serviceName,
    severity: paymentsApiIncident.severity,
    status: 'ACKNOWLEDGED',
    previousStatus: 'OPEN',
    ...overrides,
  }
}
