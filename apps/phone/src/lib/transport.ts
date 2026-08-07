export type TransportHandler = (...args: unknown[]) => void;

/**
 * The subset of the Socket.IO client surface this app needs. A real
 * `Socket` instance already satisfies this structurally; the demo
 * simulator (src/lib/demo.ts) implements it directly — so hooks never
 * know which one they're holding.
 */
export interface Transport {
  connected: boolean;
  on(event: string, handler: TransportHandler): void;
  off(event: string, handler: TransportHandler): void;
  emit(event: string, payload?: unknown, ack?: (...args: unknown[]) => void): void;
  disconnect(): void;
}
