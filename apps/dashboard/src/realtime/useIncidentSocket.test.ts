import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { computeRetryDelayMs, useIncidentSocket } from './useIncidentSocket'
import { incidentCreatedEvent } from '../test/fixtures/incidents'

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

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('computeRetryDelayMs', () => {
  it('grows exponentially and caps at the maximum delay', () => {
    expect(computeRetryDelayMs(1)).toBe(1000)
    expect(computeRetryDelayMs(2)).toBe(2000)
    expect(computeRetryDelayMs(3)).toBe(4000)
    expect(computeRetryDelayMs(10)).toBe(30_000)
  })
})

describe('useIncidentSocket', () => {
  it('starts in the connecting state and moves to live on open', () => {
    const { result } = renderHook(() =>
      useIncidentSocket('ws://localhost:8081/ws/incidents', vi.fn(), {
        webSocketFactory: factory,
      }),
    )

    expect(result.current).toBe('connecting')

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })

    expect(result.current).toBe('live')
  })

  it('forwards a validated event to onEvent', () => {
    const onEvent = vi.fn()
    renderHook(() =>
      useIncidentSocket('ws://localhost:8081/ws/incidents', onEvent, {
        webSocketFactory: factory,
      }),
    )

    const event = incidentCreatedEvent()

    act(() => {
      FakeWebSocket.latest().dispatch('open')
      FakeWebSocket.latest().dispatch('message', {
        data: JSON.stringify(event),
      })
    })

    expect(onEvent).toHaveBeenCalledWith(event)
  })

  it('does not crash and drops a malformed message', () => {
    const onEvent = vi.fn()
    renderHook(() =>
      useIncidentSocket('ws://localhost:8081/ws/incidents', onEvent, {
        webSocketFactory: factory,
      }),
    )

    expect(() => {
      act(() => {
        FakeWebSocket.latest().dispatch('message', { data: '{not json' })
      })
    }).not.toThrow()

    expect(onEvent).not.toHaveBeenCalled()
  })

  it('reconnects with capped exponential backoff after a disconnect', async () => {
    const { result } = renderHook(() =>
      useIncidentSocket('ws://localhost:8081/ws/incidents', vi.fn(), {
        webSocketFactory: factory,
      }),
    )

    act(() => {
      FakeWebSocket.latest().dispatch('open')
    })
    expect(result.current).toBe('live')

    act(() => {
      FakeWebSocket.latest().close()
    })
    expect(result.current).toBe('disconnected')
    expect(FakeWebSocket.instances).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe('reconnecting')
    expect(FakeWebSocket.instances).toHaveLength(2)

    act(() => {
      FakeWebSocket.latest().close()
    })
    expect(result.current).toBe('disconnected')

    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(FakeWebSocket.instances).toHaveLength(2)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('only reconnects once when both error and close fire for the same failure', () => {
    renderHook(() =>
      useIncidentSocket('ws://localhost:8081/ws/incidents', vi.fn(), {
        webSocketFactory: factory,
      }),
    )

    act(() => {
      FakeWebSocket.latest().dispatch('error')
      FakeWebSocket.latest().dispatch('close')
    })

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('closes the socket and stops retry timers on unmount', () => {
    const { unmount } = renderHook(() =>
      useIncidentSocket('ws://localhost:8081/ws/incidents', vi.fn(), {
        webSocketFactory: factory,
      }),
    )

    const socket = FakeWebSocket.latest()

    act(() => {
      socket.close()
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(socket.closed).toBe(true)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
