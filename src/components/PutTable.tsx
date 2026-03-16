"use client";

import { useState } from "react";
import { useContractSize } from "./ContractSizeContext";

interface ScoredPut {
  symbol: string;
  stockPrice: number;
  strikePrice: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  lastPrice: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta: number;
  theta: number;
  score: number;
  premiumYield: number;
  annualizedReturn: number;
  distanceOTM: number;
  bidAskSpread: number;
  recommendation: string;
  signals: { name: string; value: string; sentiment: string; weight: number }[];
}

interface PutTableProps {
  puts: ScoredPut[];
  title?: string;
}

const recColors: Record<string, { bg: string; text: string }> = {
  STRONG_SELL: { bg: "bg-green-900/40", text: "text-green-300" },
  SELL: { bg: "bg-green-900/20", text: "text-green-400" },
  NEUTRAL: { bg: "bg-yellow-900/20", text: "text-yellow-400" },
  AVOID: { bg: "bg-red-900/20", text: "text-red-400" },
};

const recLabels: Record<string, string> = {
  STRONG_SELL: "Strong Sell Put",
  SELL: "Sell Put",
  NEUTRAL: "Neutral",
  AVOID: "Avoid",
};

export default function PutTable({ puts, title }: PutTableProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const { contractSize } = useContractSize();

  if (puts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No put options match the criteria for this stock.
      </div>
    );
  }

  return (
    <div>
      {title && (
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="pb-2 pr-3">Score</th>
              <th className="pb-2 pr-3">Rec.</th>
              <th className="pb-2 pr-3">Strike</th>
              <th className="pb-2 pr-3">Exp</th>
              <th className="pb-2 pr-3">DTE</th>
              <th className="pb-2 pr-3">Bid</th>
              <th className="pb-2 pr-3">Ask</th>
              <th className="pb-2 pr-3">Delta</th>
              <th className="pb-2 pr-3">Ann. Return</th>
              <th className="pb-2 pr-3">Dist. OTM</th>
              <th className="pb-2 pr-3">OI</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {puts.map((put, i) => {
              const colors = recColors[put.recommendation] ?? recColors.NEUTRAL;
              const isExpanded = expandedRow === i;

              return (
                <tr key={`${put.strikePrice}-${put.expiration}`} className="group">
                  <td colSpan={12} className="p-0">
                    <div
                      className={`border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors ${
                        isExpanded ? "bg-gray-800/30" : ""
                      }`}
                      onClick={() => setExpandedRow(isExpanded ? null : i)}
                    >
                      <div className="flex items-center py-2 px-1 gap-3 text-sm">
                        {/* Score */}
                        <div className="w-12 shrink-0">
                          <span
                            className={`font-bold text-base ${
                              put.score >= 75
                                ? "text-green-400"
                                : put.score >= 55
                                ? "text-blue-400"
                                : put.score >= 40
                                ? "text-yellow-400"
                                : "text-red-400"
                            }`}
                          >
                            {put.score.toFixed(0)}
                          </span>
                        </div>

                        {/* Recommendation */}
                        <div className="w-28 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${colors.bg} ${colors.text}`}
                          >
                            {recLabels[put.recommendation] ?? put.recommendation}
                          </span>
                        </div>

                        {/* Strike */}
                        <div className="w-20 shrink-0 text-white font-medium">
                          ${put.strikePrice.toFixed(2)}
                        </div>

                        {/* Expiration */}
                        <div className="w-24 shrink-0 text-gray-300">
                          {put.expiration}
                        </div>

                        {/* DTE */}
                        <div className="w-12 shrink-0 text-gray-300">
                          {put.dte}d
                        </div>

                        {/* Bid */}
                        <div className="w-16 shrink-0 text-green-400">
                          ${put.bid.toFixed(2)}
                        </div>

                        {/* Ask */}
                        <div className="w-16 shrink-0 text-gray-300">
                          ${put.ask.toFixed(2)}
                        </div>

                        {/* Delta */}
                        <div className="w-16 shrink-0 text-gray-300">
                          {put.delta.toFixed(3)}
                        </div>

                        {/* Annualized Return */}
                        <div
                          className={`w-24 shrink-0 font-medium ${
                            put.annualizedReturn >= 10
                              ? "text-green-400"
                              : put.annualizedReturn >= 5
                              ? "text-yellow-400"
                              : "text-gray-400"
                          }`}
                        >
                          {put.annualizedReturn.toFixed(1)}%
                        </div>

                        {/* Distance OTM */}
                        <div className="w-20 shrink-0 text-gray-300">
                          {put.distanceOTM.toFixed(1)}%
                        </div>

                        {/* Open Interest */}
                        <div className="w-16 shrink-0 text-gray-400">
                          {put.openInterest.toLocaleString()}
                        </div>

                        {/* Expand arrow */}
                        <div className="w-6 shrink-0 text-gray-500">
                          {isExpanded ? "▲" : "▼"}
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-4 pb-3 pt-1 border-t border-gray-700/50">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Trade Details */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                                Trade Details
                              </h4>
                              <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                  <span className="text-gray-400">
                                    Collateral ({contractSize} sh)
                                  </span>
                                  <span className="text-white">
                                    ${(put.strikePrice * contractSize).toLocaleString()}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">
                                    Premium Received
                                  </span>
                                  <span className="text-green-400">
                                    $
                                    {(
                                      ((put.bid + put.ask) / 2) *
                                      contractSize
                                    ).toFixed(0)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">
                                    Breakeven Price
                                  </span>
                                  <span className="text-white">
                                    $
                                    {(
                                      put.strikePrice -
                                      (put.bid + put.ask) / 2
                                    ).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">
                                    Max Profit
                                  </span>
                                  <span className="text-green-400">
                                    $
                                    {(
                                      ((put.bid + put.ask) / 2) *
                                      contractSize
                                    ).toFixed(0)}{" "}
                                    ({put.premiumYield.toFixed(2)}%)
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">
                                    Max Loss
                                  </span>
                                  <span className="text-red-400">
                                    $
                                    {(
                                      (put.strikePrice -
                                        (put.bid + put.ask) / 2) *
                                      contractSize
                                    ).toFixed(0)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-gray-400">
                                    Theta (daily decay)
                                  </span>
                                  <span className="text-green-400">
                                    ${(Math.abs(put.theta) * contractSize).toFixed(2)}/day
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Scoring Signals */}
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                                Scoring Signals
                              </h4>
                              <div className="space-y-1.5">
                                {put.signals.map((signal) => (
                                  <div
                                    key={signal.name}
                                    className="flex items-center justify-between text-sm"
                                  >
                                    <span className="text-gray-400">
                                      {signal.name}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-white">
                                        {signal.value}
                                      </span>
                                      <span
                                        className={`w-2 h-2 rounded-full ${
                                          signal.sentiment === "bullish"
                                            ? "bg-green-400"
                                            : signal.sentiment === "bearish"
                                            ? "bg-red-400"
                                            : "bg-yellow-400"
                                        }`}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Management Rules */}
                          <div className="mt-3 pt-3 border-t border-gray-700/50">
                            <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">
                              Management Rules (tastytrade methodology)
                            </h4>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span className="px-2 py-1 bg-gray-700/50 rounded text-gray-300">
                                Close at 50% profit ($
                                {(((put.bid + put.ask) / 2) * 50).toFixed(0)}{" "}
                                gain)
                              </span>
                              <span className="px-2 py-1 bg-gray-700/50 rounded text-gray-300">
                                Stop at 2x credit ($
                                {(((put.bid + put.ask) / 2) * 100).toFixed(0)}{" "}
                                loss)
                              </span>
                              <span className="px-2 py-1 bg-gray-700/50 rounded text-gray-300">
                                Roll at 21 DTE if profitable
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
