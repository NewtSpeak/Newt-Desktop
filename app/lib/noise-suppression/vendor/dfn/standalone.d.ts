import { type DenoiseOptions } from './engine';
export interface DenoiseHandle {
    /** The cleaned-up track. */
    readonly track: MediaStreamTrack;
    /** A MediaStream wrapping `track`, for APIs that want a stream. */
    readonly stream: MediaStream;
    /** Toggle the denoise/clarity chain on or off (bypass) at runtime. */
    setEnabled(enabled: boolean): void;
    /** Adjust the presence-EQ "clarity strength" (dB) at runtime. */
    setPresenceGainDb(db: number): void;
    /** Tear down the audio graph and (if we created it) close the AudioContext. */
    destroy(): Promise<void>;
}
/**
 * Wrap a single input audio track and return a denoised track + controls.
 *
 * @param inputTrack a live microphone `MediaStreamTrack` (kind === 'audio')
 * @param options    denoise/clarity tuning, see {@link DenoiseOptions}
 * @param audioContext optional context to reuse; must be 48 kHz to be reused,
 *                     otherwise a private 48 kHz context is created.
 */
export declare function createDenoisedTrack(inputTrack: MediaStreamTrack, options?: DenoiseOptions, audioContext?: AudioContext): Promise<DenoiseHandle>;
/**
 * Convenience wrapper that takes a whole `MediaStream`, denoises its first
 * audio track, and returns a handle whose `.stream` is ready to use.
 *
 * Only the first audio track is processed (the typical mic case). Other tracks
 * (e.g. video) are not touched and are NOT included in the returned stream —
 * compose them yourself if you need a combined A/V stream.
 */
export declare function createDenoisedStream(inputStream: MediaStream, options?: DenoiseOptions, audioContext?: AudioContext): Promise<DenoiseHandle>;
