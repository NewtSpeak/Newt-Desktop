export interface LoadedRuntime {
    /** Compiled (not yet instantiated) core module, passed to each worklet. */
    module: WebAssembly.Module;
    /** True once the worklet processor is registered on the given context. */
    workletRegistered: boolean;
}
/** Feature/capability check used by the toggle UI. */
export declare function isVoiceClaritySupported(): boolean;
/** Compile the WASM module once (cheap to reuse across tracks). */
export declare function compileCore(): Promise<WebAssembly.Module>;
/** Register the AudioWorklet processor on a context (idempotent per context). */
export declare function ensureWorklet(context: BaseAudioContext): Promise<void>;
export declare function loadRuntime(context: BaseAudioContext): Promise<LoadedRuntime>;
