export interface DashboardEnv {
  incidentApiBaseUrl: string
  realtimeWsUrl: string
}

/**
 * Only the fields loadEnv actually reads - narrower than Vite's full
 * ImportMetaEnv so tests can construct one without stubbing every field
 * (MODE, BASE_URL, SSR, ...) Vite itself provides.
 */
interface EnvSource {
  VITE_INCIDENT_API_BASE_URL?: string
  VITE_REALTIME_WS_URL?: string
  PROD: boolean
}

// Local development (`npm run dev`) talks directly to the services at
// their documented default ports - no reverse proxy is running.
const DEV_DEFAULT_INCIDENT_API_BASE_URL = 'http://localhost:8080'
const DEV_DEFAULT_REALTIME_WS_URL = 'ws://localhost:8081/ws/incidents'

/**
 * A production build must never bake a specific host into the bundle: the
 * same image is meant to run behind different origins (container name,
 * compose network, eventually a Kubernetes Service) without rebuilding.
 * Same-origin relative paths let the browser resolve them against
 * whatever origin actually served the page, and the container's nginx
 * reverse-proxies /api and /ws/incidents to runtime-configurable upstream
 * services - see services/incident-service and apps/dashboard READMEs.
 * `new WebSocket('/ws/incidents')` is resolved by the browser against the
 * page's own origin, with http/https automatically mapped to ws/wss.
 */
const PROD_DEFAULT_INCIDENT_API_BASE_URL = ''
const PROD_DEFAULT_REALTIME_WS_URL = '/ws/incidents'

function normalize(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    return fallback
  }
  return trimmed.replace(/\/+$/, '')
}

export function loadEnv(source: EnvSource = import.meta.env): DashboardEnv {
  return {
    incidentApiBaseUrl: normalize(
      source.VITE_INCIDENT_API_BASE_URL,
      source.PROD
        ? PROD_DEFAULT_INCIDENT_API_BASE_URL
        : DEV_DEFAULT_INCIDENT_API_BASE_URL,
    ),
    realtimeWsUrl: normalize(
      source.VITE_REALTIME_WS_URL,
      source.PROD ? PROD_DEFAULT_REALTIME_WS_URL : DEV_DEFAULT_REALTIME_WS_URL,
    ),
  }
}
