import { useEffect, useRef } from 'react';
import type { Classification, MetricsFrame } from '../../types';

const STATUS_COLOR: Record<Classification, string> = {
  uncalibrated: '#8a8a8a',
  normal: '#3987e5',
  tachylalia: '#d03b3b',
  bradylalia: '#fab219',
};

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const SCROLL_PER_FRAME = 1.4;

interface LiveState {
  loudnessDb: number | null;
  voiceActivityPercent: number | null;
  classification: Classification | null;
  connected: boolean;
}

/**
 * A live voice-activity visualizer, not a raw-PCM waveform: the dashboard
 * only ever receives derived metrics over the socket (loudnessDb,
 * voiceActivityPercent), never audio samples — see
 * services/gateway/src/sockets — so bar heights are synthesized from those
 * metrics rather than sampled from the actual waveform.
 */
export function WaveformPanel({ frame, connected }: { frame: MetricsFrame | null; connected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<number[]>([]);
  const phaseRef = useRef(0);
  const liveRef = useRef<LiveState>({ loudnessDb: null, voiceActivityPercent: null, classification: null, connected });

  useEffect(() => {
    liveRef.current = {
      loudnessDb: frame?.loudnessDb ?? null,
      voiceActivityPercent: frame?.voiceActivityPercent ?? null,
      classification: frame?.classification ?? null,
      connected,
    };
  }, [frame, connected]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = container.clientWidth;
      height = container.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const draw = () => {
      const { loudnessDb, voiceActivityPercent, classification, connected: isConnected } = liveRef.current;

      // Normalize loudness (~-45..0 dB) and voice activity (0..100%) into a
      // 0..1 amplitude envelope; add a little organic jitter so a sustained
      // tone doesn't render as a flat brick.
      const loudnessNorm = loudnessDb == null ? 0 : Math.min(1, Math.max(0, (loudnessDb + 45) / 45));
      const vaNorm = voiceActivityPercent == null ? 0 : Math.min(1, Math.max(0, voiceActivityPercent / 100));
      const envelope = isConnected ? loudnessNorm * (0.35 + 0.65 * vaNorm) : 0;

      phaseRef.current += 0.18;
      const jitter = 0.75 + 0.25 * Math.sin(phaseRef.current) * Math.sin(phaseRef.current * 2.7);
      const amplitude = Math.max(0.04, Math.min(1, envelope * jitter + (Math.random() - 0.5) * 0.06));

      const bars = barsRef.current;
      bars.push(amplitude);
      const maxBars = Math.ceil(width / (BAR_WIDTH + BAR_GAP)) + 2;
      if (bars.length > maxBars) bars.splice(0, bars.length - maxBars);

      ctx.clearRect(0, 0, width, height);

      const color = classification ? STATUS_COLOR[classification] : STATUS_COLOR.normal;
      const midY = height / 2;

      for (let i = 0; i < bars.length; i++) {
        const x = width - (bars.length - i) * (BAR_WIDTH + BAR_GAP) + (SCROLL_PER_FRAME - (performance.now() % 1));
        const barHeight = Math.max(2, bars[i] * (height * 0.42));
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.55 + bars[i] * 0.45;
        ctx.beginPath();
        const radius = Math.min(BAR_WIDTH / 2, barHeight / 2);
        ctx.roundRect(x, midY - barHeight, BAR_WIDTH, barHeight * 2, radius);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="h-[120px] w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
