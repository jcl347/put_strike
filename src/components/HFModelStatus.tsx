"use client";

import { useState, useEffect } from "react";

interface ModelInfo {
  status: "loading" | "connected" | "unavailable";
  numFeatures?: number;
  parameters?: number;
  dirAcc30d?: number;
  onnxSizeMb?: number;
  numStocks?: number;
  numPerStockModels?: number;
}

export default function HFModelStatus() {
  const [info, setInfo] = useState<ModelInfo>({ status: "loading" });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Try loading the model config from HuggingFace to check availability
    const repoId = process.env.NEXT_PUBLIC_HF_REPO_ID || "jcl347/putstrike";
    const configUrl = `https://huggingface.co/${repoId}/resolve/main/model_config.json`;
    const perStockUrl = `https://huggingface.co/${repoId}/resolve/main/per_stock/per_stock_config.json`;

    Promise.all([
      fetch(configUrl, { signal: AbortSignal.timeout(8000) })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        }),
      fetch(perStockUrl, { signal: AbortSignal.timeout(8000) })
        .then(async (res) => {
          if (!res.ok) return null;
          return res.json();
        })
        .catch(() => null),
    ])
      .then(([config, perStockConfig]) => {
        const numPerStock = perStockConfig?.per_stock_metrics
          ? Object.keys(perStockConfig.per_stock_metrics).length
          : 0;
        setInfo({
          status: "connected",
          numFeatures: config.num_features,
          parameters: config.architecture?.parameters,
          dirAcc30d: config.test_metrics?.dir_acc_30d,
          onnxSizeMb: config.onnx_size_mb,
          numStocks: config.training?.num_stocks,
          numPerStockModels: numPerStock,
        });
      })
      .catch(() => {
        setInfo({ status: "unavailable" });
      });
  }, []);

  const statusIndicator = {
    loading: { color: "bg-yellow-400 animate-pulse", text: "Checking model..." },
    connected: { color: "bg-green-400", text: "iTransformer ONNX — Connected" },
    unavailable: { color: "bg-gray-500", text: "iTransformer — Model not deployed yet" },
  }[info.status];

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusIndicator.color}`} />
          <span className="text-sm text-gray-300">ML Inference (HuggingFace)</span>
          <span className="text-xs text-gray-500">{statusIndicator.text}</span>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-700/50 pt-3 space-y-3">
          {info.status === "connected" && (
            <div className="text-xs text-green-400 bg-green-900/20 border border-green-700/30 rounded px-3 py-2">
              <div className="font-medium mb-1">
                iTransformer (ICLR 2024) loaded from HuggingFace Hub
              </div>
              <div className="flex flex-wrap gap-3 text-green-500">
                {info.numFeatures && <span>{info.numFeatures} features</span>}
                {info.parameters && (
                  <span>
                    {info.parameters > 1e6
                      ? `${(info.parameters / 1e6).toFixed(1)}M params`
                      : `${(info.parameters / 1e3).toFixed(0)}K params`}
                  </span>
                )}
                {info.dirAcc30d && <span>{info.dirAcc30d.toFixed(1)}% dir. accuracy (30d)</span>}
                {info.numStocks && <span>Universal: {info.numStocks} stocks</span>}
                {info.numPerStockModels ? (
                  <span>Per-stock: {info.numPerStockModels} models</span>
                ) : null}
                {info.onnxSizeMb && <span>{info.onnxSizeMb.toFixed(1)} MB ONNX</span>}
              </div>
              <p className="text-green-600 mt-1">
                Runs in-browser via onnxruntime-web (WASM). Individual per-stock models loaded on demand.
              </p>
            </div>
          )}

          {info.status === "unavailable" && (
            <div className="text-xs text-gray-400 bg-gray-900/50 border border-gray-700/30 rounded px-3 py-2">
              <p className="mb-1">
                No ONNX model found on HuggingFace Hub. Statistical ensemble predictions are still available.
              </p>
              <p className="text-gray-500">
                To deploy: run <code className="text-gray-400">colab/train_itransformer.ipynb</code> in
                Google Colab to train and push the model to HuggingFace.
              </p>
            </div>
          )}

          {info.status === "loading" && (
            <div className="text-xs text-gray-500">
              Checking HuggingFace Hub for iTransformer model...
            </div>
          )}

          <div className="text-xs text-gray-600">
            <span className="text-gray-500">Architecture:</span>{" "}
            Inverted Transformer — each feature is a token, cross-variate attention captures how features interact.
            60-day lookback, 60-day forecast horizon. RevIN normalization for non-stationary financial data.
          </div>
        </div>
      )}
    </div>
  );
}
