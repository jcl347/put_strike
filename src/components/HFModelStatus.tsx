"use client";

/**
 * HFModelStatus — Shows connection status to the HuggingFace iTransformer model.
 * Replaces the old ColabConnect component.
 */

import { useState, useEffect } from "react";

const HF_REPO_ID = process.env.NEXT_PUBLIC_HF_REPO_ID || "jcl347/putstrike";

interface ModelInfo {
  num_features: number;
  forecast_horizon: number;
  architecture?: { type: string; parameters: number };
  training?: { num_stocks: number; best_val_loss: number };
}

export default function HFModelStatus() {
  const [status, setStatus] = useState<"checking" | "connected" | "unavailable">("checking");
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(
          `https://huggingface.co/${HF_REPO_ID}/resolve/main/model_config.json`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) {
          setStatus("unavailable");
          return;
        }
        const config = await res.json();
        setInfo({
          num_features: config.num_features,
          forecast_horizon: config.forecast_horizon,
          architecture: config.architecture,
          training: config.training,
        });
        setStatus("connected");
      } catch {
        setStatus("unavailable");
      }
    };
    check();
  }, []);

  if (status === "checking") {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        Checking iTransformer model...
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        iTransformer: Not available
      </div>
    );
  }

  const params = info?.architecture?.parameters;
  const paramStr = params ? `${(params / 1000).toFixed(0)}K params` : "";
  const stocks = info?.training?.num_stocks;

  return (
    <div className="flex items-center gap-2 text-xs text-green-400">
      <span className="w-2 h-2 rounded-full bg-green-400" />
      <span>
        iTransformer: Connected
        {info && (
          <span className="text-gray-500 ml-1">
            &mdash; {info.num_features} features, {info.forecast_horizon}d horizon
            {paramStr && `, ${paramStr}`}
            {stocks && `, ${stocks} stocks`}
          </span>
        )}
      </span>
    </div>
  );
}
