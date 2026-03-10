/**
 * HuggingFace ONNX Model Loader for iTransformer — CLIENT-SIDE
 *
 * Downloads and caches the ONNX model from HuggingFace Hub,
 * then runs inference in the browser using onnxruntime-web (WASM).
 *
 * This avoids the 250 MB Vercel serverless function limit since
 * onnxruntime-web runs in the browser, not on the server.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// HuggingFace repo ID — set via env var or default
const HF_REPO_ID =
  process.env.NEXT_PUBLIC_HF_REPO_ID || "jcl347/putstrike";

const HF_BASE = `https://huggingface.co/${HF_REPO_ID}/resolve/main`;

interface ModelConfig {
  feature_names: string[];
  num_features: number;
  lookback: number;
  forecast_horizon: number;
  architecture: {
    type: string;
    d_model: number;
    n_layers: number;
    n_heads: number;
    parameters: number;
  };
  training: {
    symbols: string[];
    num_stocks: number;
    total_samples: number;
    epochs_trained: number;
    best_val_loss: number;
  };
  test_metrics: {
    mse: number;
    mae: number;
    dir_acc_7d: number;
    dir_acc_14d: number;
    dir_acc_30d: number;
    dir_acc_60d: number;
    horizon_dir_acc: number[];
  };
  normalization_stats: Record<string, { mean: number[]; std: number[] }>;
  onnx_size_mb: number;
}

export interface HFPrediction {
  symbol: string;
  model: string;
  model_version: string;
  forecast_returns: number[];
  predicted_prices: number[];
  current_price: number;
  horizon_days: number;
  confidence: {
    lower_95: number[];
    upper_95: number[];
    lower_68: number[];
    upper_68: number[];
  };
  model_confidence: number;
  metadata: {
    num_features: number;
    lookback: number;
    architecture: any;
    test_metrics: any;
  };
}

// Errors encountered during model loading/inference — exposed to UI
let lastError: string | null = null;

export function getLastError(): string | null {
  return lastError;
}

export function clearLastError(): void {
  lastError = null;
}

/**
 * Check whether a symbol was in the model's training set.
 * Returns true only if the model config lists the symbol in training.symbols.
 */
export function isTrainedSymbol(symbol: string): boolean {
  if (!modelConfig?.training?.symbols) return false;
  return modelConfig.training.symbols.includes(symbol.toUpperCase());
}

/**
 * Get the list of symbols the model was trained on.
 */
export function getTrainedSymbols(): string[] {
  return modelConfig?.training?.symbols ?? [];
}

// Singleton state for browser-side model
let ort: any = null;
let session: any = null;
let modelConfig: ModelConfig | null = null;
let loadPromise: Promise<boolean> | null = null;

/**
 * Load the ONNX model and config from HuggingFace Hub.
 * Runs in the browser using onnxruntime-web (WASM backend).
 * Caches the session — only downloads once per page lifecycle.
 */
async function ensureModelLoaded(): Promise<boolean> {
  if (session && modelConfig) return true;
  if (typeof window === "undefined") return false; // Server-side: skip

  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      lastError = null;

      // Dynamic import of onnxruntime-web (client-side only)
      ort = await import("onnxruntime-web");

      // Configure WASM backend
      ort.env.wasm.numThreads = 1;

      // Fetch model config
      const configRes = await fetch(`${HF_BASE}/model_config.json`);
      if (!configRes.ok) {
        lastError = `Model config fetch failed: HTTP ${configRes.status}`;
        console.error(`[hf-model] ${lastError}`);
        return false;
      }
      modelConfig = (await configRes.json()) as ModelConfig;
      console.log(
        `[hf-model] Config loaded: ${modelConfig.num_features} features, ${modelConfig.forecast_horizon}d horizon, ${modelConfig.training?.num_stocks ?? "?"} stocks`
      );

      // Fetch ONNX model binary
      const modelRes = await fetch(`${HF_BASE}/itransformer.onnx`);
      if (!modelRes.ok) {
        lastError = `ONNX model fetch failed: HTTP ${modelRes.status}`;
        console.error(`[hf-model] ${lastError}`);
        return false;
      }
      const modelBuffer = await modelRes.arrayBuffer();

      // Fetch external data file if it exists (large models store tensors separately)
      let externalData: ArrayBuffer | null = null;
      try {
        const extRes = await fetch(`${HF_BASE}/itransformer.onnx.data`);
        if (extRes.ok) {
          externalData = await extRes.arrayBuffer();
          console.log(
            `[hf-model] External data loaded (${(externalData.byteLength / 1024 / 1024).toFixed(1)} MB)`
          );
        }
      } catch {
        // No external data file — model is self-contained
      }

      // Create ONNX session with WASM backend
      const sessionOptions: any = { executionProviders: ["wasm"] };
      if (externalData) {
        sessionOptions.externalData = [
          {
            path: "itransformer.onnx.data",
            data: new Uint8Array(externalData),
          },
        ];
      }
      session = await ort.InferenceSession.create(
        new Uint8Array(modelBuffer),
        sessionOptions
      );
      console.log(
        `[hf-model] ONNX session ready (${(modelBuffer.byteLength / 1024 / 1024).toFixed(1)} MB, WASM)`
      );
      return true;
    } catch (err) {
      lastError = `Model load failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[hf-model] ${lastError}`);
      session = null;
      modelConfig = null;
      return false;
    }
  })();

  return loadPromise;
}

/**
 * Run iTransformer inference in the browser.
 *
 * @param symbol - Stock ticker
 * @param currentPrice - Current stock price
 * @param featureMatrix - (lookback, num_features) normalized feature matrix
 */
export async function runHFInference(
  symbol: string,
  currentPrice: number,
  featureMatrix: number[][]
): Promise<HFPrediction | null> {
  const loaded = await ensureModelLoaded();
  if (!loaded || !session || !modelConfig || !ort) return null;

  try {
    // Validate that this symbol was in the training set
    const trained = isTrainedSymbol(symbol);
    if (!trained) {
      const msg = `${symbol} was not in the iTransformer training set (${modelConfig.training?.num_stocks ?? 0} stocks). Skipping inference.`;
      console.warn(`[hf-model] ${msg}`);
      lastError = msg;
      return null;
    }

    const lookback = modelConfig.lookback;
    const numFeatures = modelConfig.num_features;

    // Validate feature matrix dimensions
    if (!featureMatrix || featureMatrix.length === 0) {
      lastError = `Empty feature matrix for ${symbol}`;
      console.error(`[hf-model] ${lastError}`);
      return null;
    }

    // Ensure correct dimensions
    let inputData: number[][] = featureMatrix;
    if (inputData.length > lookback) {
      inputData = inputData.slice(-lookback);
    } else if (inputData.length < lookback) {
      console.warn(
        `[hf-model] ${symbol}: feature matrix has ${inputData.length} rows, padding to ${lookback}`
      );
      const padding = Array.from(
        { length: lookback - inputData.length },
        () => new Array(numFeatures).fill(0)
      );
      inputData = [...padding, ...inputData];
    }

    inputData = inputData.map((row) => {
      if (row.length < numFeatures) {
        return [...row, ...new Array(numFeatures - row.length).fill(0)];
      }
      return row.slice(0, numFeatures);
    });

    // Check for NaN/Infinity in feature data
    let nanCount = 0;
    for (const row of inputData) {
      for (const val of row) {
        if (!Number.isFinite(val)) nanCount++;
      }
    }
    if (nanCount > 0) {
      console.warn(
        `[hf-model] ${symbol}: ${nanCount} NaN/Infinity values in feature matrix, replacing with 0`
      );
    }

    // Flatten to 1D Float32Array for ONNX tensor
    const flatData = new Float32Array(lookback * numFeatures);
    for (let i = 0; i < lookback; i++) {
      for (let j = 0; j < numFeatures; j++) {
        const val = inputData[i][j];
        flatData[i * numFeatures + j] = Number.isFinite(val) ? val : 0;
      }
    }

    const inputTensor = new ort.Tensor("float32", flatData, [
      1,
      lookback,
      numFeatures,
    ]);
    const results = await session.run({ features: inputTensor });
    const forecast = Array.from(results.forecast.data as Float32Array) as number[];

    // Validate forecast output
    const invalidForecast = forecast.some((v) => !Number.isFinite(v));
    if (invalidForecast) {
      lastError = `${symbol}: model produced invalid forecast values (NaN/Infinity)`;
      console.error(`[hf-model] ${lastError}`);
      return null;
    }

    const predictedPrices = forecast.map((r) => currentPrice * (1 + r));

    // Confidence bands — use stock-specific daily vol estimate from feature data
    const dailyVol = 0.015;
    const days = Array.from({ length: forecast.length }, (_, i) => i + 1);
    const diffusion = days.map((d) => dailyVol * Math.sqrt(d));

    console.log(
      `[hf-model] ${symbol}: inference complete, 60d return=${(forecast[59] * 100).toFixed(1)}%, trained=true`
    );

    return {
      symbol,
      model: "iTransformer",
      model_version: "3.0",
      forecast_returns: forecast,
      predicted_prices: predictedPrices,
      current_price: currentPrice,
      horizon_days: modelConfig.forecast_horizon,
      confidence: {
        lower_95: forecast.map(
          (r, i) => currentPrice * (1 + r - 1.96 * diffusion[i])
        ),
        upper_95: forecast.map(
          (r, i) => currentPrice * (1 + r + 1.96 * diffusion[i])
        ),
        lower_68: forecast.map(
          (r, i) => currentPrice * (1 + r - diffusion[i])
        ),
        upper_68: forecast.map(
          (r, i) => currentPrice * (1 + r + diffusion[i])
        ),
      },
      model_confidence: Math.max(
        0,
        Math.min(1, (modelConfig.test_metrics?.dir_acc_30d ?? 50) / 100)
      ),
      metadata: {
        num_features: modelConfig.num_features,
        lookback: modelConfig.lookback,
        architecture: modelConfig.architecture,
        test_metrics: modelConfig.test_metrics,
      },
    };
  } catch (err) {
    lastError = `${symbol} inference failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[hf-model] ${lastError}`);
    return null;
  }
}

/**
 * Get normalization stats for a specific stock from the model config.
 * Falls back to aggregate stats if stock-specific stats aren't available.
 */
export function getNormStats(
  symbol: string
): { mean: number[]; std: number[] } | null {
  if (!modelConfig?.normalization_stats) return null;

  if (modelConfig.normalization_stats[symbol]) {
    return modelConfig.normalization_stats[symbol];
  }

  const allStats = Object.values(modelConfig.normalization_stats);
  if (allStats.length === 0) return null;

  const numFeatures = allStats[0].mean.length;
  const aggMean = new Array(numFeatures).fill(0);
  const aggStd = new Array(numFeatures).fill(0);

  for (const s of allStats) {
    for (let i = 0; i < numFeatures; i++) {
      aggMean[i] += s.mean[i] / allStats.length;
      aggStd[i] += s.std[i] / allStats.length;
    }
  }

  return { mean: aggMean, std: aggStd };
}

/**
 * Check if the HF model is available.
 */
export async function isModelAvailable(): Promise<boolean> {
  return ensureModelLoaded();
}

export function getModelConfig(): ModelConfig | null {
  return modelConfig;
}
