/**
 * HuggingFace ONNX Model Loader for iTransformer
 *
 * Downloads and caches the ONNX model from HuggingFace Hub,
 * then runs inference using onnxruntime-node.
 *
 * No Flask/ngrok/Colab needed — runs entirely in serverless functions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let ort: any = null;
let session: any = null;
let modelConfig: any = null;
let loadPromise: Promise<void> | null = null;

// HuggingFace repo ID — set via env var or default
const HF_REPO_ID =
  process.env.NEXT_PUBLIC_HF_REPO_ID || "putstrike/itransformer";

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
  normalization_stats: Record<
    string,
    { mean: number[]; std: number[] }
  >;
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

/**
 * Load the ONNX model and config from HuggingFace Hub.
 * Uses singleton pattern — only loads once per serverless instance.
 */
async function ensureModelLoaded(): Promise<boolean> {
  if (session && modelConfig) return true;

  if (loadPromise) {
    await loadPromise;
    return session != null;
  }

  loadPromise = (async () => {
    try {
      // Dynamically import onnxruntime-node (server-side only)
      ort = await import("onnxruntime-node");

      // Fetch model config
      const configRes = await fetch(`${HF_BASE}/model_config.json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!configRes.ok) {
        console.error(
          `[hf-model] Failed to fetch config: ${configRes.status}`
        );
        return;
      }
      modelConfig = (await configRes.json()) as ModelConfig;
      console.log(
        `[hf-model] Config loaded: ${modelConfig.num_features} features, ${modelConfig.forecast_horizon}d horizon`
      );

      // Fetch ONNX model binary
      const modelRes = await fetch(`${HF_BASE}/itransformer.onnx`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!modelRes.ok) {
        console.error(
          `[hf-model] Failed to fetch model: ${modelRes.status}`
        );
        return;
      }
      const modelBuffer = await modelRes.arrayBuffer();

      // Create ONNX session
      session = await ort.InferenceSession.create(
        Buffer.from(modelBuffer),
        {
          executionProviders: ["cpu"],
          graphOptimizationLevel: "all",
        }
      );
      console.log(
        `[hf-model] ONNX session created (${(modelBuffer.byteLength / 1024 / 1024).toFixed(1)} MB)`
      );
    } catch (err) {
      console.error("[hf-model] Load failed:", err);
      session = null;
      modelConfig = null;
    }
  })();

  await loadPromise;
  return session != null;
}

/**
 * Run iTransformer inference for a stock.
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
    const lookback = modelConfig.lookback;
    const numFeatures = modelConfig.num_features;

    // Ensure correct dimensions
    let inputData: number[][] = featureMatrix;
    if (inputData.length > lookback) {
      inputData = inputData.slice(-lookback);
    } else if (inputData.length < lookback) {
      // Pad with zeros at the beginning
      const padding = Array.from({ length: lookback - inputData.length }, () =>
        new Array(numFeatures).fill(0)
      );
      inputData = [...padding, ...inputData];
    }

    // Ensure feature dimension matches
    inputData = inputData.map((row) => {
      if (row.length < numFeatures) {
        return [...row, ...new Array(numFeatures - row.length).fill(0)];
      }
      return row.slice(0, numFeatures);
    });

    // Flatten to 1D for ONNX tensor
    const flatData = new Float32Array(lookback * numFeatures);
    for (let i = 0; i < lookback; i++) {
      for (let j = 0; j < numFeatures; j++) {
        flatData[i * numFeatures + j] = inputData[i][j];
      }
    }

    const inputTensor = new ort.Tensor("float32", flatData, [
      1,
      lookback,
      numFeatures,
    ]);
    const results = await session.run({ features: inputTensor });
    const forecast = Array.from(results.forecast.data as Float32Array);

    // Convert returns to prices
    const predictedPrices = forecast.map(
      (r: number) => currentPrice * (1 + r)
    );

    // Confidence bands using historical volatility estimate
    const dailyVol = 0.015; // ~24% annualized, conservative default
    const days = Array.from(
      { length: forecast.length },
      (_, i) => i + 1
    );
    const diffusion = days.map((d) => dailyVol * Math.sqrt(d));

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
          (r: number, i: number) =>
            currentPrice * (1 + r - 1.96 * diffusion[i])
        ),
        upper_95: forecast.map(
          (r: number, i: number) =>
            currentPrice * (1 + r + 1.96 * diffusion[i])
        ),
        lower_68: forecast.map(
          (r: number, i: number) =>
            currentPrice * (1 + r - diffusion[i])
        ),
        upper_68: forecast.map(
          (r: number, i: number) =>
            currentPrice * (1 + r + diffusion[i])
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
    console.error("[hf-model] Inference failed:", err);
    return null;
  }
}

/**
 * Get normalization stats for a specific stock.
 * Falls back to aggregate stats if stock-specific stats aren't available.
 */
export function getNormStats(
  symbol: string
): { mean: number[]; std: number[] } | null {
  if (!modelConfig?.normalization_stats) return null;

  if (modelConfig.normalization_stats[symbol]) {
    return modelConfig.normalization_stats[symbol];
  }

  // Compute aggregate mean of all stock stats
  const allStats = Object.values(modelConfig.normalization_stats) as {
    mean: number[];
    std: number[];
  }[];
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
 * Check if the HF model is available and get its status.
 */
export async function getModelStatus(): Promise<{
  available: boolean;
  config: ModelConfig | null;
}> {
  const loaded = await ensureModelLoaded();
  return { available: loaded, config: modelConfig };
}

export function getModelConfig(): ModelConfig | null {
  return modelConfig;
}
