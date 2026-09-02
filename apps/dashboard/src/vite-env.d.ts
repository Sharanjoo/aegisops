/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INCIDENT_API_BASE_URL?: string
  readonly VITE_REALTIME_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
