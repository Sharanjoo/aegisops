import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import {
  clusterAgentDemoIncident,
  incidentCreatedEvent,
  inventoryApiIncident,
  paymentsApiIncident,
} from './test/fixtures/incidents'

type Listener = (event: unknown) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  private listeners: Record<string, Listener[]> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    ;(this.listeners[type] ??= []).push(listener)
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (candidate) => candidate !== listener,
    )
  }

  dispatch(type: string, event: unknown = {}) {
    for (const listener of this.listeners[type] ?? []) {
      listener(event)
    }
  }

  close() {
    this.dispatch('close', {})
  }

  static latest(): FakeWebSocket {
    const instance = FakeWebSocket.instances.at(-1)
    if (!instance) {
      throw new Error('No FakeWebSocket instance was created')
    }
    return instance
  }
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body }
}

function stubFetchOk(incidents: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(incidents)))
}

/** Routes the list endpoint to `incidents` and any incident-detail request to `detailsById`. */
function stubFetchWithDetails(
  incidents: unknown[],
  detailsById: Record<string, unknown>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.endsWith('/api/v1/incidents')) {
        return Promise.resolve(jsonResponse(incidents))
      }
      const id = url.split('/').pop() ?? ''
      return Promise.resolve(jsonResponse(detailsById[id]))
    }),
  )
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('shows a loading state before the snapshot resolves', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(() => {})),
    )

    render(<App />)

    expect(screen.getByText(/loading incidents/i)).toBeInTheDocument()
  })

  it('renders the snapshot once it loads', async () => {
    stubFetchOk([paymentsApiIncident, inventoryApiIncident])

    render(<App />)

    expect(
      await screen.findByText(paymentsApiIncident.serviceName),
    ).toBeInTheDocument()
    expect(
      screen.getByText(inventoryApiIncident.serviceName),
    ).toBeInTheDocument()
  })

  it('shows an empty state when the snapshot has no incidents', async () => {
    stubFetchOk([])

    render(<App />)

    expect(
      await screen.findByText(/no incidents reported/i),
    ).toBeInTheDocument()
  })

  it('shows a REST error state when the snapshot request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => [],
      }),
    )

    render(<App />)

    expect(
      await screen.findByText(/could not load incidents/i),
    ).toBeInTheDocument()
  })

  it('reflects a live INCIDENT_CREATED event, hydrated with its complete title, without a page reload', async () => {
    stubFetchWithDetails(
      [paymentsApiIncident],
      { [clusterAgentDemoIncident.id]: clusterAgentDemoIncident },
    )
    render(<App />)

    await screen.findByText(paymentsApiIncident.serviceName)

    const event = incidentCreatedEvent()
    act(() => {
      FakeWebSocket.latest().dispatch('open')
      FakeWebSocket.latest().dispatch('message', {
        data: JSON.stringify(event),
      })
    })

    // The event itself carries no title - this only appears once the
    // dashboard has fetched the complete incident via REST.
    expect(
      await screen.findByText(clusterAgentDemoIncident.title),
    ).toBeInTheDocument()
    expect(screen.getByText(event.serviceName)).toBeInTheDocument()
  })

  it('shows the connection state in the header', async () => {
    stubFetchOk([])
    render(<App />)

    expect(screen.getByText(/connecting/i)).toBeInTheDocument()

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })

    await waitFor(() => {
      expect(screen.getByText('Live')).toBeInTheDocument()
    })
  })

  it('filters the incident list by search text', async () => {
    stubFetchOk([paymentsApiIncident, inventoryApiIncident])
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText(paymentsApiIncident.serviceName)

    await user.type(
      screen.getByLabelText(/search/i),
      inventoryApiIncident.serviceName,
    )

    expect(
      screen.queryByText(paymentsApiIncident.serviceName),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(inventoryApiIncident.serviceName),
    ).toBeInTheDocument()
  })

  it('filters the incident list by status', async () => {
    stubFetchOk([paymentsApiIncident, inventoryApiIncident])
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText(paymentsApiIncident.serviceName)

    await user.selectOptions(screen.getByLabelText(/status/i), 'ACKNOWLEDGED')

    expect(
      screen.queryByText(paymentsApiIncident.serviceName),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(inventoryApiIncident.serviceName),
    ).toBeInTheDocument()
  })
})
