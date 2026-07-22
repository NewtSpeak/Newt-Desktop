type NoiseGateProcessorOptions = {
    /**
     * threshold to open the gate in dB
     */
    openThreshold: number;
    /**
     * threshold to close the gate in dB
     *
     * @default openThreshold
     */
    closeThreshold?: number;
    /**
     * length of time to close the gate in milliseconds
     *
     * When the input sound is under the closeThreshold for this time, the gate will close.
     */
    holdMs: number;
    /**
     * the maximum number of channels
     */
    maxChannels: number;
};

declare class NoiseGateWorkletNode extends AudioWorkletNode {
    constructor(context: AudioContext, { openThreshold, closeThreshold, holdMs, maxChannels }: Readonly<NoiseGateProcessorOptions>);
}

type RnnoiseProcessorOptions = {
    /**
     * the maximum number of channels
     */
    maxChannels: number;
    /**
     * use `loadRnnoise` to obtain binary
     */
    wasmBinary: ArrayBuffer;
};

type LoadRnnoiseOptions = {
    /**
     * url to regular wasm binary
     */
    url: string;
    /**
     * url to simd wasm binary
     */
    simdUrl: string;
};
declare const loadRnnoise: ({ url, simdUrl }: LoadRnnoiseOptions, init?: RequestInit) => Promise<ArrayBuffer>;

/**
 * Assumes sample rate to be 48kHz.
 */
declare class RnnoiseWorkletNode extends AudioWorkletNode {
    constructor(context: AudioContext, { maxChannels, wasmBinary }: Readonly<RnnoiseProcessorOptions>);
    destroy(): void;
}

type SpeexProcessorOptions = {
    /**
     * the maximum number of channels
     */
    maxChannels: number;
    /**
     * use `loadSpeex` to obtain binary
     */
    wasmBinary: ArrayBuffer;
};

type LoadSpeexOptions = {
    /**
     * url to wasm binary
     */
    url: string;
};
declare const loadSpeex: ({ url }: LoadSpeexOptions, init?: RequestInit) => Promise<ArrayBuffer>;

declare class SpeexWorkletNode extends AudioWorkletNode {
    constructor(context: AudioContext, { maxChannels, wasmBinary }: Readonly<SpeexProcessorOptions>);
    destroy(): void;
}

export { type NoiseGateProcessorOptions, NoiseGateWorkletNode, type RnnoiseProcessorOptions, RnnoiseWorkletNode, type SpeexProcessorOptions, SpeexWorkletNode, loadRnnoise, loadSpeex };
