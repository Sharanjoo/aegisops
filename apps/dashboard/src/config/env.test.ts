import { describe, expect, it } from 'vitest'

import { loadEnv } from './env'

describe('loadEnv', () => {
  it('defaults to the local services in development', () => {
    const env = loadEnv({ PROD: false })
    expect(env.incidentApiBaseUrl).toBe('http://localhost:8080')
    expect(env.realtimeWsUrl).toBe('ws://localhost:8081/ws/incidents')
  })

  it('defaults to same-origin relative routes in production, never a baked-in host', () => {
    const env = loadEnv({ PROD: true })
    expect(env.incidentApiBaseUrl).toBe('')
    expect(env.realtimeWsUrl).toBe('/ws/incidents')
  })

  it('honors an explicit override in development', () => {
    const env = loadEnv({
      PROD: false,
      VITE_INCIDENT_API_BASE_URL: 'http://incident-service.internal:9000/',
      VITE_REALTIME_WS_URL: 'ws://gateway.internal:9001/ws/incidents/',
    })
    expect(env.incidentApiBaseUrl).toBe('http://incident-service.internal:9000')
    expect(env.realtimeWsUrl).toBe('ws://gateway.internal:9001/ws/incidents')
  })

  it('honors an explicit override in production too', () => {
    const env = loadEnv({
      PROD: true,
      VITE_INCIDENT_API_BASE_URL: 'https://api.example.com',
      VITE_REALTIME_WS_URL: 'wss://api.example.com/ws/incidents',
    })
    expect(env.incidentApiBaseUrl).toBe('https://api.example.com')
    expect(env.realtimeWsUrl).toBe('wss://api.example.com/ws/incidents')
  })

  it('treats a blank override as unset and falls back to the mode default', () => {
    const env = loadEnv({
      PROD: true,
      VITE_INCIDENT_API_BASE_URL: '   ',
    })
    expect(env.incidentApiBaseUrl).toBe('')
  })
})
