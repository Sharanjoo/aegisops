import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchIncidents, IncidentApiError } from './incidentApi'
import { paymentsApiIncident } from '../test/fixtures/incidents'

const BASE_URL = 'http://localhost:8080'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(response: Partial<Response> & { json?: () => unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => [],
    ...response,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchIncidents', () => {
  it('requests the documented endpoint and parses a valid response', async () => {
    const fetchMock = stubFetch({ json: async () => [paymentsApiIncident] })

    const incidents = await fetchIncidents(BASE_URL)

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/incidents`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(incidents).toEqual([paymentsApiIncident])
  })

  it('treats a null description/title as absent, not a parse failure', async () => {
    stubFetch({
      json: async () => [
        { ...paymentsApiIncident, title: null, description: null },
      ],
    })

    const [incident] = await fetchIncidents(BASE_URL)

    expect(incident?.title).toBeNull()
    expect(incident?.description).toBeNull()
  })

  it('throws IncidentApiError on a non-OK HTTP status', async () => {
    stubFetch({ ok: false, status: 503, statusText: 'Service Unavailable' })

    await expect(fetchIncidents(BASE_URL)).rejects.toBeInstanceOf(
      IncidentApiError,
    )
  })

  it('throws IncidentApiError when the response is not a JSON array', async () => {
    stubFetch({ json: async () => ({ not: 'an array' }) })

    await expect(fetchIncidents(BASE_URL)).rejects.toThrow(
      /not a JSON array/,
    )
  })

  it('throws IncidentApiError when an incident has an unrecognized severity', async () => {
    stubFetch({
      json: async () => [{ ...paymentsApiIncident, severity: 'APOCALYPTIC' }],
    })

    await expect(fetchIncidents(BASE_URL)).rejects.toThrow(/severity/)
  })

  it('throws IncidentApiError when the network request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network error')),
    )

    await expect(fetchIncidents(BASE_URL)).rejects.toBeInstanceOf(
      IncidentApiError,
    )
  })
})
