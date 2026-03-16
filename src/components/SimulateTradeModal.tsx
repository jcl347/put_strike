"use client";

import { useState } from "react";

interface TradeData {
  symbol: string;
  companyName?: string;
  strikePrice: number;
  expiration: string;
  dteAtEntry: number;
  premiumReceived: number;
  stockPriceAtEntry: number;
  deltaAtEntry?: number;
  scoreAtEntry?: number;
  stabilityScoreAtEntry?: number;
  ivRankAtEntry?: number;
}

interface SimulateTradeModalProps {
  /** Pre-filled trade data from a put row */
  prefill?: Partial<TradeData>;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SimulateTradeModal({ prefill, onClose, onSuccess }: SimulateTradeModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const symbol = prefill?.symbol ?? "";
  const strikePrice = prefill?.strikePrice ?? 0;
  const expiration = prefill?.expiration ?? "";
  const premium = prefill?.premiumReceived ?? 0;
  const stockPrice = prefill?.stockPriceAtEntry ?? 0;
  const collateral = strikePrice * 100;
  const yieldPct = collateral > 0 ? ((premium * 100) / collateral * 100).toFixed(2) : "0";

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: prefill?.symbol,
          companyName: prefill?.companyName,
          strikePrice: prefill?.strikePrice,
          expiration: prefill?.expiration,
          dteAtEntry: prefill?.dteAtEntry,
          premiumReceived: prefill?.premiumReceived,
          stockPriceAtEntry: prefill?.stockPriceAtEntry,
          deltaAtEntry: prefill?.deltaAtEntry,
          scoreAtEntry: prefill?.scoreAtEntry,
          stabilityScoreAtEntry: prefill?.stabilityScoreAtEntry,
          ivRankAtEntry: prefill?.ivRankAtEntry,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `Failed (HTTP ${res.status})`);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trade");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Simulate Put Sale</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* Trade Summary */}
        <div className="bg-gray-800/70 rounded-lg p-4 mb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Symbol</span>
            <span className="text-white font-bold">{symbol}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Stock Price</span>
            <span className="text-white">${stockPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Strike</span>
            <span className="text-white">${strikePrice.toFixed(2)} put</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Expiration</span>
            <span className="text-white">{expiration} ({prefill?.dteAtEntry ?? 0}d)</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Premium (per share)</span>
            <span className="text-green-400 font-medium">${premium.toFixed(2)}</span>
          </div>
          <div className="border-t border-gray-700 pt-2 mt-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Collateral Required</span>
              <span className="text-white font-medium">${collateral.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Max Gain</span>
              <span className="text-green-400">${(premium * 100).toFixed(0)} ({yieldPct}%)</span>
            </div>
          </div>
          {prefill?.scoreAtEntry != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Score at Entry</span>
              <span className="text-blue-400">{prefill.scoreAtEntry.toFixed(0)}</span>
            </div>
          )}
          {prefill?.deltaAtEntry != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Delta</span>
              <span className="text-gray-300">{prefill.deltaAtEntry.toFixed(3)}</span>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            rows={2}
            placeholder="e.g., Earnings in 50d, below support at $340..."
          />
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:text-green-400 text-white font-medium rounded-lg transition-colors text-sm"
          >
            {saving ? "Saving..." : "Open Simulated Trade"}
          </button>
        </div>
      </div>
    </div>
  );
}
