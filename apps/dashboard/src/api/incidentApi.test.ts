import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchIncident, fetchIncidents, IncidentApiError } from './incidentApi'
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

  it('accepts an empty description but not a missing title', async () => {
    stubFetch({
      json: async () => [{ ...paymentsApiIncident, description: '' }],
    })
    const [incident] = await fetchIncidents(BASE_URL)
    expect(incident?.description).toBe('')

    stubFetch({
      json: async () => [{ ...paymentsApiIncident, title: '' }],
    })
    await expect(fetchIncidents(BASE_URL)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('throws IncidentApiError(kind: "http") on a non-OK HTTP status', async () => {
    stubFetch({ ok: false, status: 503, statusText: 'Service Unavailable' })

    await expect(fetchIncidents(BASE_URL)).rejects.toMatchObject({
      kind: 'http',
      status: 503,
    })
  })

  it('throws IncidentApiError(kind: "invalid-response") when the response is not a JSON array', async () => {
    stubFetch({ json: async () => ({ not: 'an array' }) })

    await expect(fetchIncidents(BASE_URL)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('throws IncidentApiError(kind: "invalid-response") when an incident has an unrecognized severity', async () => {
    stubFetch({
      json: async () => [{ ...paymentsApiIncident, severity: 'APOCALYPTIC' }],
    })

    await expect(fetchIncidents(BASE_URL)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('throws IncidentApiError(kind: "network") when the network request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network error')),
    )

    await expect(fetchIncidents(BASE_URL)).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('rejects with the abort error, not an IncidentApiError, when the request is aborted', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const controller = new AbortController()
    controller.abort()

    await expect(
      fetchIncidents(BASE_URL, { signal: controller.signal }),
    ).rejects.toBe(abortError)
  })
})

describe('fetchIncident', () => {
  it('requests GET /api/v1/incidents/{id} and parses a valid response', async () => {
    const fetchMock = stubFetch({ json: async () => paymentsApiIncident })

    const incident = await fetchIncident(BASE_URL, paymentsApiIncident.id)

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/incidents/${paymentsApiIncident.id}`,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(incident).toEqual(paymentsApiIncident)
  })

  it('encodes the incident ID safely in the URL', async () => {
    const fetchMock = stubFetch({
      json: async () => ({ ...paymentsApiIncident, id: 'weird/id?with&chars' }),
    })

    await fetchIncident(BASE_URL, 'weird/id?with&chars')

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/incidents/weird%2Fid%3Fwith%26chars`,
      expect.anything(),
    )
  })

  it('throws IncidentApiError(kind: "network") when the network request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('network error')),
    )

    await expect(fetchIncident(BASE_URL, paymentsApiIncident.id)).rejects.toMatchObject({
      kind: 'network',
    })
  })

  it('throws IncidentApiError(kind: "http") on a non-OK HTTP status', async () => {
    stubFetch({ ok: false, status: 404, statusText: 'Not Found' })

    await expect(fetchIncident(BASE_URL, paymentsApiIncident.id)).rejects.toMatchObject({
      kind: 'http',
      status: 404,
    })
  })

  it('throws IncidentApiError(kind: "invalid-response") for a malformed body', async () => {
    stubFetch({ json: async () => ({ id: paymentsApiIncident.id }) })

    await expect(fetchIncident(BASE_URL, paymentsApiIncident.id)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('supports an AbortSignal', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal)
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => paymentsApiIncident,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchIncident(BASE_URL, paymentsApiIncident.id, {
      signal: controller.signal,
    })

    expect(fetchMock).toHaveBeenCalled()
  })
})

describe('IncidentApiError', () => {
  it('is an instance of Error with a stable name', () => {
    const error = new IncidentApiError('boom', 'network')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('IncidentApiError')
    expect(error.kind).toBe('network')
  })
})
