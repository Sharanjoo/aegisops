export interface DashboardEnv {
  incidentApiBaseUrl: string
  realtimeWsUrl: string
}

const DEFAULT_INCIDENT_API_BASE_URL = 'http://localhost:8080'
const DEFAULT_REALTIME_WS_URL = 'ws://localhost:8081/ws/incidents'

function normalize(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }
  return trimmed.replace(/\/+$/, '')
}

export function loadEnv(
  source: ImportMetaEnv = import.meta.env,
): DashboardEnv {
  return {
    incidentApiBaseUrl: normalize(
      source.VITE_INCIDENT_API_BASE_URL,
      DEFAULT_INCIDENT_API_BASE_URL,
    ),
    realtimeWsUrl: normalize(
      source.VITE_REALTIME_WS_URL,
      DEFAULT_REALTIME_WS_URL,
    ),
  }
}
