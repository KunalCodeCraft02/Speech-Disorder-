import { useCallback, useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { tokenStore } from '../lib/api';
import { DEVICE_EVENTS } from '../lib/socket';
import { playBeep } from '../lib/beep';
import { useAudioCapture } from './useAudioCapture';
import type { Transport } from '../lib/transport';
import type { DeviceErrorEvent, DisorderMode, SessionAck, SessionStopAck, VibrationCommand } from '../types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
export type RecordingState = 'idle' | 'requesting-permission' | 'recording' | 'stopping' | 'error';

const VIBRATE_SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/**
 * Owns the /device namespace connection (services/gateway/src/sockets/
 * namespaces/device.namespace.js) plus the mic capture pipeline: Start
 * requests the mic, then opens a session (scoped to `disorderMode`, Part
 * B.8/D) and streams PCM chunks; any vibration:command the server sends is
 * executed immediately via navigator.vibrate() where supported, or a
 * visual flash + audio beep fallback on browsers without the Vibration API
 * (iOS Safari) -- Part E.12.
 */
export function useDeviceSession(userId: string | undefined, disorderMode: DisorderMode | null) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [vibrationPulse, setVibrationPulse] = useState<VibrationCommand | null>(null);
  const [visualFallbackPulse, setVisualFallbackPulse] = useState<VibrationCommand | null>(null);
  const [calibrated, setCalibrated] = useState<boolean | null>(null);

  const transportRef = useRef<Transport | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const disorderModeRef = useRef<DisorderMode | null>(disorderMode);
  disorderModeRef.current = disorderMode;

  const handleChunk = useCallback((bytes: ArrayBuffer) => {
    transportRef.current?.emit(DEVICE_EVENTS.audioChunk, bytes);
  }, []);

  const capture = useAudioCapture({ onChunk: handleChunk });

  // One /device connection per authenticated user, torn down on unmount.
  useEffect(() => {
    if (!userId) return;
    const accessToken = tokenStore.getAccess();
    if (!accessToken) return;

    const transport = dataClient.createDeviceTransport(accessToken);
    transportRef.current = transport;
    setConnectionState('connecting');

    const handleConnect = () => {
      setConnectionState('connected');
      setErrorMessage(null);
    };
    const handleDisconnect = () => setConnectionState('disconnected');
    const handleConnectError = (err: unknown) => {
      setConnectionState('error');
      setErrorMessage(err instanceof Error ? err.message : 'Connection error');
    };
    const handleSessionAck = (payload: unknown) => {
      const ack = payload as SessionAck;
      sessionIdRef.current = ack.sessionId;
      setSessionId(ack.sessionId);
      setCalibrated(ack.calibrated ?? null);
    };
    const handleVibration = (payload: unknown) => {
      const command = payload as VibrationCommand;
      if (VIBRATE_SUPPORTED) {
        navigator.vibrate(command.pattern);
      } else {
        // Feature-detected fallback for browsers with no Vibration API
        // (iOS Safari): a strong visual flash of the classification ring
        // plus an audio beep, so the demo path still gives feedback.
        playBeep();
        setVisualFallbackPulse(command);
      }
      setVibrationPulse(command);
    };
    const handleSessionError = (payload: unknown) => {
      const err = payload as DeviceErrorEvent;
      setErrorMessage(err.message);
      if (err.code !== 'BAD_REQUEST') {
        setRecordingState('error');
      }
    };

    transport.on('connect', handleConnect);
    transport.on('disconnect', handleDisconnect);
    transport.on('connect_error', handleConnectError);
    transport.on(DEVICE_EVENTS.sessionAck, handleSessionAck);
    transport.on(DEVICE_EVENTS.vibrationCommand, handleVibration);
    transport.on(DEVICE_EVENTS.sessionError, handleSessionError);

    // The demo transport is connected synchronously and never fires a
    // 'connect' event (no real handshake) — kick it off directly.
    if (transport.connected) handleConnect();

    return () => {
      transport.off('connect', handleConnect);
      transport.off('disconnect', handleDisconnect);
      transport.off('connect_error', handleConnectError);
      transport.off(DEVICE_EVENTS.sessionAck, handleSessionAck);
      transport.off(DEVICE_EVENTS.vibrationCommand, handleVibration);
      transport.off(DEVICE_EVENTS.sessionError, handleSessionError);
      transport.disconnect();
      transportRef.current = null;
    };
  }, [userId]);

  const startRecording = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport || recordingState === 'recording' || recordingState === 'requesting-permission') return;

    setErrorMessage(null);
    setRecordingState('requesting-permission');

    try {
      await capture.start();
    } catch {
      setRecordingState('error');
      return;
    }

    transport.emit(
      DEVICE_EVENTS.sessionStart,
      { disorderMode: disorderModeRef.current ?? 'tachylalia', demoMode: dataClient.demoMode },
      (payload: unknown) => {
        const ack = payload as SessionAck;
        sessionIdRef.current = ack.sessionId;
        setSessionId(ack.sessionId);
        setCalibrated(ack.calibrated ?? null);
      }
    );
    setRecordingState('recording');
  }, [capture, recordingState]);

  const stopRecording = useCallback(() => {
    if (recordingState !== 'recording') return;
    setRecordingState('stopping');
    capture.stop();

    const transport = transportRef.current;
    const currentSessionId = sessionIdRef.current;
    if (transport && currentSessionId) {
      transport.emit(DEVICE_EVENTS.sessionStop, {}, (_payload: unknown) => {
        void (_payload as SessionStopAck);
      });
    }
    sessionIdRef.current = null;
    setSessionId(null);
    setCalibrated(null);
    setRecordingState('idle');
  }, [capture, recordingState]);

  return {
    connectionState,
    recordingState,
    sessionId,
    errorMessage,
    micPermissionState: capture.permissionState,
    vibrationPulse,
    visualFallbackPulse,
    calibrated,
    startRecording,
    stopRecording,
  };
}
