import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useIncidentDashboard } from './useIncidentDashboard'
import {
  clusterAgentDemoIncident,
  incidentCreatedEvent,
  incidentStatusChangedEvent,
  paymentsApiIncident,
} from '../test/fixtures/incidents'

const BASE_URL = 'http://localhost:8080'
const WS_URL = 'ws://localhost:8081/ws/incidents'

type Listener = (event: unknown) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  closed = false
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
    this.closed = true
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

function factory(url: string) {
  return new FakeWebSocket(url) as unknown as WebSocket
}

function dispatchMessage(payload: unknown) {
  FakeWebSocket.latest().dispatch('message', { data: JSON.stringify(payload) })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as Response
}

function errorResponse(status = 500): Response {
  return {
    ok: false,
    status,
    statusText: 'Server Error',
    json: async () => ({}),
  } as Response
}

/** Yields to the microtask queue enough times for a fetch().then().then() chain and a React state update to settle, under real timers. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

interface FetchRouter {
  list: (url: string, init?: RequestInit) => Promise<Response>
  detail: (id: string, url: string, init?: RequestInit) => Promise<Response>
}

function stubFetchRouter(router: Partial<FetchRouter>) {
  const calls: { kind: 'list' | 'detail'; url: string; id?: string }[] = []

  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/api/v1/incidents')) {
      calls.push({ kind: 'list', url })
      return router.list
        ? router.list(url, init)
        : Promise.resolve(jsonResponse([]))
    }

    const match = /\/api\/v1\/incidents\/(.+)$/.exec(url)
    if (match) {
      const id = decodeURIComponent(match[1] ?? '')
      calls.push({ kind: 'detail', url, id })
      return router.detail
        ? router.detail(id, url, init)
        : Promise.reject(new Error(`No detail handler configured for ${id}`))
    }

    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

describe('useIncidentDashboard orchestration', () => {
  it('does not process WebSocket events until the initial snapshot succeeds', async () => {
    const snapshotDeferred = createDeferred<Response>()
    const { calls } = stubFetchRouter({
      list: () => snapshotDeferred.promise,
      detail: () => Promise.resolve(jsonResponse(clusterAgentDemoIncident)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await flush()

    // The event arrived before the snapshot resolved: no detail fetch yet.
    expect(calls.filter((c) => c.kind === 'detail')).toHaveLength(0)
    expect(result.current.snapshotStatus).toBe('loading')

    act(() => {
      snapshotDeferred.resolve(jsonResponse([]))
    })
    await flush()

    expect(result.current.snapshotStatus).toBe('ready')
    // The buffered event is now drained and hydrated.
    expect(calls.filter((c) => c.kind === 'detail')).toHaveLength(1)
  })

  it('applies a created event by fetching and inserting the complete incident', async () => {
    stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([])),
      detail: (id) =>
        id === clusterAgentDemoIncident.id
          ? Promise.resolve(jsonResponse(clusterAgentDemoIncident))
          : Promise.reject(new Error(`unexpected id ${id}`)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await flush()

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await flush()

    const incident = result.current.incidents.find(
      (candidate) => candidate.id === clusterAgentDemoIncident.id,
    )
    expect(incident).toEqual(clusterAgentDemoIncident)
  })

  it('applies a status-changed event by fetching and updating the complete incident', async () => {
    const updated = {
      ...paymentsApiIncident,
      status: 'ACKNOWLEDGED' as const,
      updatedAt: '2026-09-01T16:00:00Z',
    }

    stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([paymentsApiIncident])),
      detail: (id) =>
        id === paymentsApiIncident.id
          ? Promise.resolve(jsonResponse(updated))
          : Promise.reject(new Error(`unexpected id ${id}`)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await flush()

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentStatusChangedEvent())
    await flush()

    const incident = result.current.incidents.find(
      (candidate) => candidate.id === paymentsApiIncident.id,
    )
    expect(incident).toEqual(updated)
  })

  it('recovers a failed hydration via bounded retry', async () => {
    vi.useFakeTimers()

    let attempts = 0
    stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([])),
      detail: () => {
        attempts += 1
        if (attempts < 3) {
          return Promise.resolve(errorResponse(503))
        }
        return Promise.resolve(jsonResponse(clusterAgentDemoIncident))
      },
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(attempts).toBe(1)
    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(false)

    // First retry delay (500ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(attempts).toBe(2)

    // Second retry delay (1000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(attempts).toBe(3)

    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(true)
  })

  it('does not fire a second detail request for a duplicate in-flight event', async () => {
    const detailDeferred = createDeferred<Response>()
    let detailCallCount = 0
    stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([])),
      detail: () => {
        detailCallCount += 1
        return detailDeferred.promise
      },
    })

    renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await flush()

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })

    const event = incidentCreatedEvent()
    dispatchMessage(event)
    dispatchMessage(event) // exact duplicate delivery, still in flight
    await flush()

    expect(detailCallCount).toBe(1)

    act(() => {
      detailDeferred.resolve(jsonResponse(clusterAgentDemoIncident))
    })
    await flush()
  })

  it('refreshes the snapshot on reconnect but not on the first connection', async () => {
    vi.useFakeTimers()

    const { calls } = stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([])),
    })

    renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Initial snapshot load only - no redundant refresh on first connect.
    expect(calls.filter((c) => c.kind === 'list')).toHaveLength(1)

    act(() => {
      FakeWebSocket.latest().close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Reconnect triggered exactly one more snapshot fetch.
    expect(calls.filter((c) => c.kind === 'list')).toHaveLength(2)
  })

  it('retries a transient reconnect reconciliation failure and then succeeds', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        if (listCallCount === 1) {
          return Promise.resolve(jsonResponse([]))
        }
        if (listCallCount === 2) {
          return Promise.resolve(errorResponse(503))
        }
        return Promise.resolve(jsonResponse([clusterAgentDemoIncident]))
      },
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(listCallCount).toBe(1)

    act(() => {
      FakeWebSocket.latest().close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    // Reconnect fires the first reconciliation attempt, which fails.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(listCallCount).toBe(2)
    expect(result.current.reconciliationError).toBeNull()

    // Reconciliation retry delay (1000ms) - the retry succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(listCallCount).toBe(3)
    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(true)
    expect(result.current.reconciliationError).toBeNull()
  })

  it('exposes reconciliationError when reconnect reconciliation exhausts its retries', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : Promise.resolve(errorResponse(503))
      },
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0) // attempt 1 fails
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000) // attempt 2 fails
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000) // attempt 3 fails - exhausted
    })

    expect(result.current.reconciliationError).toBe(
      'Some live incident updates could not be confirmed automatically.',
    )
    // The rest of the dashboard keeps working.
    expect(result.current.snapshotStatus).toBe('ready')
  })

  it('recovers a reconnect-triggered degraded state via manual retry', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    let failList = true
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        if (listCallCount === 1) {
          return Promise.resolve(jsonResponse([]))
        }
        return failList
          ? Promise.resolve(errorResponse(503))
          : Promise.resolve(jsonResponse([clusterAgentDemoIncident]))
      },
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(result.current.reconciliationError).not.toBeNull()

    failList = false
    act(() => {
      result.current.retryReconciliation()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.reconciliationError).toBeNull()
    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(true)
  })

  it('coalesces a reconnect refresh with an in-flight hydration-triggered refresh', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    // Held pending so the reconnect genuinely observes the hydration
    // failure's refresh as still in flight, rather than a fast mock
    // hiding whether coalescing actually happened.
    const refreshDeferred = createDeferred<Response>()
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : refreshDeferred.promise
      },
      detail: () => Promise.resolve(errorResponse(503)),
    })

    renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    // Hydration is exhausted; its fallback refresh (list call #2) is now
    // in flight, held pending.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(listCallCount).toBe(2)

    // A reconnect happens while that refresh is still pending.
    act(() => {
      FakeWebSocket.latest().close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // The reconnect did not start a second, duplicate request - it
    // coalesced into the one already running.
    expect(listCallCount).toBe(2)

    act(() => {
      refreshDeferred.resolve(jsonResponse([]))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(listCallCount).toBe(2)
  })

  it('cancels an active reconnect-triggered reconciliation cycle on unmount', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : Promise.resolve(errorResponse(503))
      },
    })

    const { unmount } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().close()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    // Reconnect reconciliation attempt 1 fails; a retry is scheduled
    // 1000ms out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const callCountAtUnmount = listCallCount
    unmount()

    // Advance well past when the pending retry would have fired, had it
    // not been cancelled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(listCallCount).toBe(callCountAtUnmount)
  })

  it('does not let an out-of-order stale response regress a newer one', async () => {
    // Two distinct events for the same incident trigger two detail fetches
    // for the same URL; route by call order so each can be resolved
    // independently and out of order.
    const detailDeferreds = [createDeferred<Response>(), createDeferred<Response>()]
    let detailCallCount = 0

    stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([paymentsApiIncident])),
      detail: () => {
        const deferred = detailDeferreds[detailCallCount]
        detailCallCount += 1
        return deferred?.promise ?? Promise.reject(new Error('unexpected extra call'))
      },
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await flush()

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })

    dispatchMessage(
      incidentStatusChangedEvent({
        eventId: '66666666-6666-4666-8666-666666666666',
      }),
    )
    dispatchMessage(
      incidentStatusChangedEvent({
        eventId: '77777777-7777-4777-8777-777777777777',
      }),
    )
    await flush()

    expect(detailCallCount).toBe(2)

    const newer = {
      ...paymentsApiIncident,
      status: 'RESOLVED' as const,
      updatedAt: '2026-09-01T20:00:00Z',
    }
    const older = {
      ...paymentsApiIncident,
      status: 'ACKNOWLEDGED' as const,
      updatedAt: '2026-09-01T13:00:00Z',
    }

    // The network resolves the newer response first, then the older one -
    // the reverse of a naive "later dispatch wins" assumption.
    act(() => {
      detailDeferreds[1]?.resolve(jsonResponse(newer))
    })
    await flush()
    act(() => {
      detailDeferreds[0]?.resolve(jsonResponse(older))
    })
    await flush()

    const incident = result.current.incidents.find(
      (candidate) => candidate.id === paymentsApiIncident.id,
    )
    expect(incident?.status).toBe('RESOLVED')
    expect(incident?.updatedAt).toBe(newer.updatedAt)
  })

  it('aborts outstanding hydration requests and clears timers on unmount', async () => {
    vi.useFakeTimers()

    const abortedSignals: AbortSignal[] = []
    stubFetchRouter({
      list: () => Promise.resolve(jsonResponse([])),
      detail: (_id, _url, init) => {
        if (init?.signal) {
          abortedSignals.push(init.signal)
        }
        return new Promise(() => {
          // never resolves - simulates an outstanding request
        })
      },
    })

    const { unmount } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(abortedSignals).toHaveLength(1)
    expect(abortedSignals[0]?.aborted).toBe(false)

    unmount()

    expect(abortedSignals[0]?.aborted).toBe(true)
  })

  it('recovers via a fallback snapshot refresh when hydration exhausts its retries', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : Promise.resolve(jsonResponse([clusterAgentDemoIncident]))
      },
      detail: () => Promise.resolve(errorResponse(503)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Exhaust the 3 hydration attempts (500ms, then 1000ms between them).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    // Hydration is now exhausted and the fallback refresh's first attempt
    // fires and succeeds immediately.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(listCallCount).toBe(2)
    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(true)
    expect(result.current.reconciliationError).toBeNull()
  })

  it('coalesces multiple hydration-retry exhaustions into a single reconciliation refresh', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    // The reconciliation refresh itself is held pending (not resolved
    // instantly) so that whichever event exhausts second genuinely
    // observes the first refresh as still in flight - proving coalescing
    // rather than a fast-resolving mock hiding it.
    const refreshDeferred = createDeferred<Response>()
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : refreshDeferred.promise
      },
      detail: () => Promise.resolve(errorResponse(503)),
    })

    renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    // Two distinct events, both destined to exhaust their hydration
    // retries at roughly the same time.
    dispatchMessage(
      incidentCreatedEvent({
        eventId: '88888888-8888-4888-8888-888888888888',
        incidentId: '99999999-9999-4999-9999-999999999999',
      }),
    )
    dispatchMessage(
      incidentStatusChangedEvent({
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Both events have exhausted hydration, but only the first started a
    // refresh request - the second saw it already in flight and coalesced.
    expect(listCallCount).toBe(2)

    act(() => {
      refreshDeferred.resolve(jsonResponse([]))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Still exactly 2 once the shared refresh resolves - no second,
    // separately-triggered refresh ever fired.
    expect(listCallCount).toBe(2)
  })

  it('exposes a nonfatal reconciliationError when the fallback refresh also exhausts its retries', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : Promise.resolve(errorResponse(503))
      },
      detail: () => Promise.resolve(errorResponse(503)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Exhaust hydration (500ms, 1000ms), then the fallback's first attempt
    // fires and fails too.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.reconciliationError).toBeNull() // still retrying

    // Fallback retries: 1000ms, then 2000ms - the third and last attempt.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(result.current.reconciliationError).toBe(
      'Some live incident updates could not be confirmed automatically.',
    )
    // The dashboard otherwise keeps working - no fatal/loading/error state.
    expect(result.current.snapshotStatus).toBe('ready')
  })

  it('clears a degraded state when the user manually retries and it succeeds', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    let failList = true
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        if (listCallCount === 1) {
          return Promise.resolve(jsonResponse([]))
        }
        return failList
          ? Promise.resolve(errorResponse(503))
          : Promise.resolve(jsonResponse([clusterAgentDemoIncident]))
      },
      detail: () => Promise.resolve(errorResponse(503)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(result.current.reconciliationError).not.toBeNull()

    failList = false
    act(() => {
      result.current.retryReconciliation()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.reconciliationError).toBeNull()
    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(true)
  })

  it('cancels a pending reconciliation retry and aborts its request on unmount', async () => {
    vi.useFakeTimers()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        return listCallCount === 1
          ? Promise.resolve(jsonResponse([]))
          : Promise.resolve(errorResponse(503))
      },
      detail: () => Promise.resolve(errorResponse(503)),
    })

    const { unmount } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    dispatchMessage(incidentCreatedEvent())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    await act(async () => {
      // Hydration exhausted here; the fallback's first attempt fires and
      // fails, scheduling a retry 1000ms out.
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    const callCountAtUnmount = listCallCount
    unmount()

    // Advance well past when the pending reconciliation retry would have
    // fired, had it not been cancelled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(listCallCount).toBe(callCountAtUnmount)
  })

  it('deduplicates the startup event buffer by eventId', async () => {
    const snapshotDeferred = createDeferred<Response>()
    const { calls } = stubFetchRouter({
      list: () => snapshotDeferred.promise,
      detail: () => Promise.resolve(jsonResponse(clusterAgentDemoIncident)),
    })

    renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })

    const event = incidentCreatedEvent()
    dispatchMessage(event)
    dispatchMessage(event) // redelivered while still buffered
    await flush()

    act(() => {
      snapshotDeferred.resolve(jsonResponse([]))
    })
    await flush()

    expect(calls.filter((c) => c.kind === 'detail')).toHaveLength(1)
  })

  it('bounds the startup event buffer and recovers via a reconciliation refresh on overflow', async () => {
    // MAX_PENDING_EVENTS in useIncidentDashboard.ts is 500; exceed it by
    // exactly one to prove the cap without a large, slow test.
    const snapshotDeferred = createDeferred<Response>()
    let listCallCount = 0
    stubFetchRouter({
      list: () => {
        listCallCount += 1
        if (listCallCount === 1) {
          return snapshotDeferred.promise
        }
        return Promise.resolve(jsonResponse([clusterAgentDemoIncident]))
      },
      detail: () => Promise.resolve(jsonResponse(clusterAgentDemoIncident)),
    })

    const { result } = renderHook(() =>
      useIncidentDashboard(BASE_URL, WS_URL, { webSocketFactory: factory }),
    )
    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })

    for (let i = 0; i < 501; i += 1) {
      dispatchMessage(
        incidentCreatedEvent({
          eventId: `10000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
        }),
      )
    }
    await flush()

    act(() => {
      snapshotDeferred.resolve(jsonResponse([]))
    })
    await flush()

    // 1 initial snapshot + 1 overflow-triggered reconciliation refresh.
    expect(listCallCount).toBe(2)
    expect(result.current.snapshotStatus).toBe('ready')
    expect(
      result.current.incidents.some((i) => i.id === clusterAgentDemoIncident.id),
    ).toBe(true)
  })
})
