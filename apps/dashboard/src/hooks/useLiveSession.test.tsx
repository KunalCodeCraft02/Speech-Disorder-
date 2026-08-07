import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLiveSession } from './useLiveSession';
import { dataClient } from '../lib/dataClient';
import { tokenStore } from '../lib/api';
import { DASHBOARD_EVENTS } from '../lib/socket';
import type { DashboardTransport, TransportHandler } from '../lib/transport';

vi.mock('../lib/dataClient', () => ({
  dataClient: { createTransport: vi.fn() },
}));

vi.mock('../lib/api', () => ({
  tokenStore: { getAccess: vi.fn() },
}));

class FakeTransport implements DashboardTransport {
  connected = false;
  disconnectCalled = false;
  handlers = new Map<string, Set<TransportHandler>>();
  emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, handler: TransportHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: TransportHandler) {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
  }

  disconnect() {
    this.disconnectCalled = true;
  }

  fire(event: string, payload?: unknown) {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }
}

describe('useLiveSession', () => {
  let transport: FakeTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new FakeTransport();
    vi.mocked(tokenStore.getAccess).mockReturnValue('access-token');
    vi.mocked(dataClient.createTransport).mockReturnValue(transport);
  });

  test('does nothing without a userId', () => {
    renderHook(() => useLiveSession(undefined, null));
    expect(dataClient.createTransport).not.toHaveBeenCalled();
  });

  test('connects and subscribes to the user room on connect', async () => {
    const { result } = renderHook(() => useLiveSession('u1', null));

    act(() => transport.fire('connect'));

    await waitFor(() => expect(result.current.connectionState).toBe('connected'));
    expect(transport.emitted).toContainEqual({
      event: DASHBOARD_EVENTS.subscribeUser,
      payload: { userId: 'u1' },
    });
  });

  test('a metrics frame for the current session updates latest and history', async () => {
    const { result, rerender } = renderHook(({ sessionId }) => useLiveSession('u1', sessionId), {
      initialProps: { sessionId: 's1' as string | null },
    });
    act(() => transport.fire('connect'));

    const frame = { sessionId: 's1', articulationRateSPS: 4.5, classification: 'normal' };
    act(() => transport.fire(DASHBOARD_EVENTS.metricsUpdate, frame));

    await waitFor(() => expect(result.current.latest).toEqual(frame));
    expect(result.current.history).toEqual([frame]);

    rerender({ sessionId: 's1' });
  });

  test('ignores a metrics frame for a different session', () => {
    const { result } = renderHook(() => useLiveSession('u1', 's1'));
    act(() => transport.fire('connect'));
    act(() => transport.fire(DASHBOARD_EVENTS.metricsUpdate, { sessionId: 'other-session', articulationRateSPS: 1 }));

    expect(result.current.latest).toBeNull();
  });

  test('a feedback event for the current session is prepended to the log', async () => {
    const { result } = renderHook(() => useLiveSession('u1', 's1'));
    act(() => transport.fire('connect'));

    const event1 = { sessionId: 's1', reason: 'tachylalia', pattern: [80, 40], ts: '1' };
    const event2 = { sessionId: 's1', reason: 'bradylalia', pattern: [300], ts: '2' };
    act(() => transport.fire(DASHBOARD_EVENTS.feedbackLogged, event1));
    act(() => transport.fire(DASHBOARD_EVENTS.feedbackLogged, event2));

    await waitFor(() => expect(result.current.feedbackEvents).toEqual([event2, event1]));
  });

  test('a session:ended event for the current session is recorded', async () => {
    const { result } = renderHook(() => useLiveSession('u1', 's1'));
    act(() => transport.fire('connect'));

    const ended = { sessionId: 's1', summary: { durationSec: 120 } };
    act(() => transport.fire(DASHBOARD_EVENTS.sessionEnded, ended));

    await waitFor(() => expect(result.current.sessionEnded).toEqual(ended));
  });

  test('a session:error event surfaces as errorMessage', async () => {
    const { result } = renderHook(() => useLiveSession('u1', 's1'));
    act(() => transport.fire('connect'));

    act(() => transport.fire(DASHBOARD_EVENTS.sessionError, { code: 'FORBIDDEN', message: 'nope' }));

    await waitFor(() => expect(result.current.errorMessage).toBe('nope'));
  });

  test('disconnect sets connectionState to disconnected', async () => {
    const { result } = renderHook(() => useLiveSession('u1', null));
    act(() => transport.fire('connect'));
    await waitFor(() => expect(result.current.connectionState).toBe('connected'));

    act(() => transport.fire('disconnect'));
    await waitFor(() => expect(result.current.connectionState).toBe('disconnected'));
  });

  test('a session:started event records disorderMode and demoMode', async () => {
    const { result } = renderHook(() => useLiveSession('u1', 's1'));
    act(() => transport.fire('connect'));

    act(() =>
      transport.fire(DASHBOARD_EVENTS.sessionStarted, {
        sessionId: 's1',
        userId: 'u1',
        startedAt: '2026-01-01T00:00:00.000Z',
        disorderMode: 'bradylalia',
        demoMode: true,
      })
    );

    await waitFor(() => expect(result.current.disorderMode).toBe('bradylalia'));
    expect(result.current.demoMode).toBe(true);
  });

  test('unmounting disconnects the transport', () => {
    const { unmount } = renderHook(() => useLiveSession('u1', null));
    unmount();
    expect(transport.disconnectCalled).toBe(true);
  });
});
