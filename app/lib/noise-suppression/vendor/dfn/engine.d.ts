export interface DenoiseOptions {
    /** Master enable; can be toggled at runtime via setEnabled(). Default true. */
    enabled?: boolean;
    /** Max noise attenuation (dB). Lower = more natural, higher = more removal. Default 30. */
    attenuationLimitDb?: number;
    /** Presence-EQ lift (dB) — the "clarity strength" knob. Default 4. */
    presenceGainDb?: number;
}
export type ResolvedDenoiseOptions = Required<DenoiseOptions>;
/**
 * Normalise user options into a fully-populated set with defaults applied and
 * values clamped to safe ranges. Pure function — unit-testable without a browser.
 */
export declare function resolveOptions(opts?: DenoiseOptions): ResolvedDenoiseOptions;
/**
 * A live denoise graph attached to one input track on one AudioContext.
 *
 * The DeepFilterNet model requires 48 kHz. We reuse a provided context only if
 * it is already at 48 kHz; otherwise we create our own so the worklet's
 * 480-sample frames are a true 10 ms (a wrong rate distorts the denoise).
 */
export declare class DenoiseEngine {
    /** The cleaned-up track. Available after init() resolves. */
    processedTrack?: MediaStreamTrack;
    private opts;
    private context?;
    private ownsContext;
    private source?;
    private worklet?;
    private sink?;
    constructor(opts?: DenoiseOptions);
    init(track: MediaStreamTrack, audioContext?: AudioContext): Promise<void>;
    setEnabled(enabled: boolean): void;
    setPresenceGainDb(db: number): void;
    get enabled(): boolean;
    destroy(): Promise<void>;
}
