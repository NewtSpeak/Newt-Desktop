import { type DenoiseOptions } from './engine';
/** @deprecated Prefer `DenoiseOptions` from the package root — kept as an alias. */
export type VoiceClarityOptions = DenoiseOptions;
interface ProcessorOptions {
    track: MediaStreamTrack;
    audioContext?: AudioContext;
}
export declare class VoiceClarityProcessor {
    readonly name = "denoise-voice-clarity";
    /** LiveKit reads this and publishes it instead of the raw mic track. */
    processedTrack?: MediaStreamTrack;
    private engine;
    constructor(opts?: VoiceClarityOptions);
    init(options: ProcessorOptions): Promise<void>;
    /** Called by LiveKit when the underlying track is replaced (e.g. device switch). */
    restart(options: ProcessorOptions): Promise<void>;
    setEnabled(enabled: boolean): void;
    setPresenceGainDb(db: number): void;
    destroy(): Promise<void>;
}
export {};
