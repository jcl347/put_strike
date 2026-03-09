"use client";

import { useState, useEffect, useCallback } from "react";

interface Props {
  onUrlChange: (url: string | null) => void;
}

export default function ColabConnect({ onUrlChange }: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"disconnected" | "checking" | "connected" | "error">("disconnected");
  const [modelInfo, setModelInfo] = useState<string | null>(null);
  const [modelDetails, setModelDetails] = useState<{
    features?: number;
    testAccuracy?: number;
    parameters?: number;
    version?: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const checkConnection = useCallback(async (testUrl: string) => {
    if (!testUrl) {
      setStatus("disconnected");
      onUrlChange(null);
      return;
    }
    setStatus("checking");
    try {
      const cleanUrl = testUrl.replace(/\/+$/, "");
      const res = await fetch(`${cleanUrl}/health`, {
        headers: { "ngrok-skip-browser-warning": "true" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus("connected");
        setModelInfo(data.model ?? "iTransformer");
        setModelDetails({
          features: data.features,
          testAccuracy: data.test_metrics?.directional_accuracy_30d,
          parameters: data.architecture?.parameters,
          version: data.version,
        });
        onUrlChange(cleanUrl);
      } else {
        setStatus("error");
        onUrlChange(null);
      }
    } catch {
      setStatus("error");
      onUrlChange(null);
    }
  }, [onUrlChange]);

  // Load saved URL from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("putstrike_colab_url");
    if (saved) {
      setUrl(saved);
      checkConnection(saved);
    }
  }, [checkConnection]);

  const handleConnect = () => {
    const cleanUrl = url.trim().replace(/\/+$/, "");
    if (cleanUrl) {
      localStorage.setItem("putstrike_colab_url", cleanUrl);
      checkConnection(cleanUrl);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem("putstrike_colab_url");
    setUrl("");
    setStatus("disconnected");
    setModelInfo(null);
    setModelDetails(null);
    onUrlChange(null);
  };

  const statusIndicator = {
    disconnected: { color: "bg-gray-500", text: "Not configured" },
    checking: { color: "bg-yellow-400 animate-pulse", text: "Connecting..." },
    connected: { color: "bg-green-400", text: `Connected${modelInfo ? ` — ${modelInfo}` : ""}` },
    error: { color: "bg-red-400", text: "Connection failed" },
  }[status];

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusIndicator.color}`} />
          <span className="text-sm text-gray-300">GPU Inference (Colab)</span>
          <span className="text-xs text-gray-500">{statusIndicator.text}</span>
        </div>
        <span className="text-gray-500 text-xs">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 border-t border-gray-700/50 pt-3 space-y-3">
          <p className="text-xs text-gray-500">
            Connect your Google Colab GPU runtime for iTransformer deep learning predictions.
            Run the training notebook in Colab, then paste the ngrok URL below.
          </p>

          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleConnect()}
              placeholder="https://xxxx-xx-xx.ngrok-free.app"
              className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
            />
            {status === "connected" ? (
              <button
                onClick={handleDisconnect}
                className="px-3 py-1.5 bg-red-900/40 text-red-400 border border-red-700/50 rounded text-sm hover:bg-red-900/60 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={!url.trim() || status === "checking"}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {status === "checking" ? "..." : "Connect"}
              </button>
            )}
          </div>

          {status === "connected" && (
            <div className="text-xs text-green-400 bg-green-900/20 border border-green-700/30 rounded px-3 py-2">
              <div className="font-medium mb-1">iTransformer connected — predictions will appear in Price Prediction section</div>
              {modelDetails && (
                <div className="flex gap-3 text-green-500">
                  {modelDetails.features && <span>{modelDetails.features} features</span>}
                  {modelDetails.parameters && (
                    <span>{modelDetails.parameters > 1e6
                      ? `${(modelDetails.parameters / 1e6).toFixed(1)}M params`
                      : `${(modelDetails.parameters / 1e3).toFixed(0)}K params`}</span>
                  )}
                  {modelDetails.testAccuracy && <span>{modelDetails.testAccuracy.toFixed(1)}% test accuracy</span>}
                  {modelDetails.version && <span>v{modelDetails.version}</span>}
                </div>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">
              Could not reach the Colab server. Make sure the notebook is running and ngrok is active.
            </div>
          )}

          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-400">Setup instructions</summary>
            <ol className="mt-2 ml-4 list-decimal space-y-1">
              <li>Open <code>colab/train_itransformer.py</code> in Google Colab</li>
              <li>Run all cells to train the model and start the inference server</li>
              <li>Copy the ngrok URL printed in the output</li>
              <li>Paste it above and click Connect</li>
            </ol>
          </details>
        </div>
      )}
    </div>
  );
}
