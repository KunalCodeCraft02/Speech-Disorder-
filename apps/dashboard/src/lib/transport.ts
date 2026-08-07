export type TransportHandler = (...args: unknown[]) => void;

/**
 * The subset of the Socket.IO client surface useDashboardSocket needs.
 * A real `Socket` instance already satisfies this structurally; the demo
 * simulator (src/lib/demo.ts) implements it directly — so hooks/components
 * never know which one they're holding.
 */
export interface DashboardTransport {
  connected: boolean;
  on(event: string, handler: TransportHandler): void;
  off(event: string, handler: TransportHandler): void;
  emit(event: string, payload?: unknown, ack?: (...args: unknown[]) => void): void;
  disconnect(): void;
}
