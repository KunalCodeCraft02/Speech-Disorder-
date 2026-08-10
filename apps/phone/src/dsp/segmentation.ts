// Turns a stream of VAD frame decisions into speech segments (IPUs) and
// pause segments, merging silence runs shorter than MIN_PAUSE_SEC into the
// surrounding speech. Ported from
// services/dsp-service/app/pipeline/segmentation.py.

import * as C from './constants';
import type { FrameDecision } from './vad';

export type SegmentKind = 'speech' | 'pause';

export interface Segment {
  kind: SegmentKind;
  start: number;
  end: number;
}

export function segmentDuration(seg: Segment): number {
  return Math.max(0, seg.end - seg.start);
}

export class SpeechSegmenter {
  private readonly minPauseSec: number;

  private state: SegmentKind = 'pause';
  private stateStart = 0;

  private silenceRunStart: number | null = null;
  private silenceRunFrames = 0;

  private lastFrameEnd = 0;

  constructor(minPauseSec = C.MIN_PAUSE_SEC) {
    this.minPauseSec = minPauseSec;
  }

  process(decisions: FrameDecision[], hopSeconds: number): Segment[] {
    const finalized: Segment[] = [];

    for (const d of decisions) {
      const frameEnd = d.time + hopSeconds;
      this.lastFrameEnd = frameEnd;

      if (this.state === 'speech') {
        if (d.isSpeech) {
          this.silenceRunFrames = 0;
          this.silenceRunStart = null;
        } else {
          if (this.silenceRunFrames === 0) this.silenceRunStart = d.time;
          this.silenceRunFrames++;

          const candidateDuration = frameEnd - (this.silenceRunStart as number);
          if (candidateDuration >= this.minPauseSec) {
            finalized.push({ kind: 'speech', start: this.stateStart, end: this.silenceRunStart as number });
            this.state = 'pause';
            this.stateStart = this.silenceRunStart as number;
            this.silenceRunFrames = 0;
            this.silenceRunStart = null;
          }
        }
      } else {
        if (d.isSpeech) {
          const pauseDuration = d.time - this.stateStart;
          if (pauseDuration >= this.minPauseSec) {
            finalized.push({ kind: 'pause', start: this.stateStart, end: d.time });
          }
          this.state = 'speech';
          this.stateStart = d.time;
        }
      }
    }

    return finalized;
  }

  /** [kind, start, end] of the segment still in progress. */
  openSegmentInfo(): [SegmentKind, number, number] {
    return [this.state, this.stateStart, Math.max(this.stateStart, this.lastFrameEnd)];
  }
}
