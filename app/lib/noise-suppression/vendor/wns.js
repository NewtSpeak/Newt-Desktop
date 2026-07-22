// Vendor: @sapphi-red/web-noise-suppressor（MIT）打包产物，略作补丁：
// Node / Vite SSR 模块求值时没有 AudioWorkletNode，顶层 `class extends AudioWorkletNode`
// 会直接抛错。用安全基类兜底，实际构造仍只在浏览器 WebAudio 路径调用。

// src/noiseGate/workletUtil.ts
var id = "@sapphi-red/web-noise-suppressor/noise-gate";

// Node/SSR 无 AudioWorkletNode：用空基类避免模块加载即崩溃
var AudioWorkletNodeBase =
  typeof AudioWorkletNode !== "undefined"
    ? AudioWorkletNode
    : class AudioWorkletNodeStub {
        constructor() {
          throw new Error(
            "@sapphi-red/web-noise-suppressor: AudioWorkletNode 不可用（非浏览器环境）",
          );
        }
      };

// src/noiseGate/workletNode.ts
var NoiseGateWorkletNode = class extends AudioWorkletNodeBase {
  constructor(context, {
    openThreshold,
    closeThreshold = openThreshold,
    holdMs,
    maxChannels
  }) {
    const workletOptions = {
      processorOptions: { openThreshold, closeThreshold, holdMs, maxChannels }
    };
    super(context, id, workletOptions);
  }
};

// node_modules/.pnpm/wasm-feature-detect@1.6.1/node_modules/wasm-feature-detect/dist/esm/index.js
var simd = async () => WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));

// src/utils/fetchArrayBuffer.ts
var fetchArrayBuffer = async (url, init) => {
  const res = await fetch(url, init);
  const result = await res.arrayBuffer();
  return result;
};

// src/rnnoise/load.ts
var loadRnnoise = async ({ url, simdUrl }, init) => {
  const loadUrl = await simd() ? simdUrl : url;
  const binary = await fetchArrayBuffer(loadUrl, init);
  return binary;
};

// src/rnnoise/workletUtil.ts
var id2 = "@sapphi-red/web-noise-suppressor/rnnoise";

// src/rnnoise/workletNode.ts
var RnnoiseWorkletNode = class extends AudioWorkletNodeBase {
  constructor(context, { maxChannels, wasmBinary }) {
    const workletOptions = {
      processorOptions: { maxChannels, wasmBinary }
    };
    super(context, id2, workletOptions);
  }
  destroy() {
    this.port.postMessage("destroy");
  }
};

// src/speex/load.ts
var loadSpeex = async ({ url }, init) => {
  const binary = await fetchArrayBuffer(url, init);
  return binary;
};

// src/speex/workletUtil.ts
var id3 = "@sapphi-red/web-noise-suppressor/speex";

// src/speex/workletNode.ts
var SpeexWorkletNode = class extends AudioWorkletNodeBase {
  constructor(context, { maxChannels, wasmBinary }) {
    const workletOptions = {
      processorOptions: { maxChannels, wasmBinary }
    };
    super(context, id3, workletOptions);
  }
  destroy() {
    this.port.postMessage("destroy");
  }
};
export {
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  SpeexWorkletNode,
  loadRnnoise,
  loadSpeex
};
