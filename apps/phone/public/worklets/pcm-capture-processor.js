// AudioWorkletProcessor running on the audio rendering thread. Its only
// job is to buffer the mic's native-rate Float32 samples into reasonably
// sized blocks and hand them to the main thread — no resampling or PCM16
// conversion here, since AudioWorkletGlobalScope has no access to it
// cheaper than just shipping the floats out (see src/lib/pcm.ts for that
// work, done on the main thread where it's easier to reason about /
// debug and doesn't compete with the audio callback's real-time budget).
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._bufferedLength = 0;
    this._blockSize = 2048;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];

    if (channel && channel.length) {
      this._chunks.push(channel.slice());
      this._bufferedLength += channel.length;

      if (this._bufferedLength >= this._blockSize) {
        const merged = new Float32Array(this._bufferedLength);
        let offset = 0;
        for (const chunk of this._chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this.port.postMessage(merged, [merged.buffer]);
        this._chunks = [];
        this._bufferedLength = 0;
      }
    }

    // Returning true keeps the node (and this processor) alive for the
    // lifetime of the audio graph — the caller controls lifetime by
    // disconnecting the node, not by this returning false.
    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
