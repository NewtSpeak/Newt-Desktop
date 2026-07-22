/* tslint:disable */
/* eslint-disable */

export class VoiceClarityWasm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create with default config (passthrough engine unless `dfn` is built in
     * with a model). `attenuation_limit_db` and the clarity defaults apply.
     */
    constructor();
    /**
     * Process one frame in place. `frame` must be exactly `frame_size` long
     * and is mutated directly (zero-copy view into WASM memory from JS).
     */
    process(frame: Float32Array): void;
    reset(): void;
    set_attenuation_limit_db(db: number): void;
    set_enabled(enabled: boolean): void;
    /**
     * Adjust the presence-EQ lift at runtime (the main "clarity strength" knob).
     */
    set_presence_gain_db(db: number): void;
    /**
     * The frame size the worklet must feed (samples). Exposed so JS never
     * hard-codes it.
     */
    readonly frame_size: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_voiceclaritywasm_free: (a: number, b: number) => void;
    readonly voiceclaritywasm_frame_size: (a: number) => number;
    readonly voiceclaritywasm_new: () => number;
    readonly voiceclaritywasm_process: (a: number, b: number, c: number, d: any) => void;
    readonly voiceclaritywasm_reset: (a: number) => void;
    readonly voiceclaritywasm_set_attenuation_limit_db: (a: number, b: number) => void;
    readonly voiceclaritywasm_set_enabled: (a: number, b: number) => void;
    readonly voiceclaritywasm_set_presence_gain_db: (a: number, b: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
