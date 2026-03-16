"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

// ─── Types ───────────────────────────────────────────────────

export interface SimulatedTrade {
  id: string;
  symbol: string;
  stockPriceAtEntry: number;
  strikePrice: number;
  expiration: string;
  dte: number;
  premium: number;        // per-share mid price collected
  contractSize: number;   // shares per contract
  numContracts: number;   // number of contracts
  totalPremium: number;   // premium * contractSize * numContracts
  collateral: number;     // strikePrice * contractSize * numContracts
  premiumYield: number;   // percentage
  annualizedReturn: number;
  delta: number;
  impliedVolatility: number;
  score: number;
  recommendation: string;
  entryDate: string;
  status: "open" | "closed_profit" | "closed_loss" | "expired" | "assigned";
  closeDate?: string;
  closePremium?: number;  // per-share cost to buy back
  realizedPnL?: number;   // totalPremium - (closePremium * contractSize * numContracts)
  closeReason?: string;
}

interface SimulatedTradesContextType {
  trades: SimulatedTrade[];
  addTrade: (trade: Omit<SimulatedTrade, "id" | "entryDate" | "status">) => void;
  closeTrade: (id: string, closePremium: number, reason: string) => void;
  removeTrade: (id: string) => void;
  clearAll: () => void;
  totalPremiumCollected: number;
  totalRealizedPnL: number;
  openTradeCount: number;
  totalCollateralInUse: number;
}

const SimulatedTradesContext = createContext<SimulatedTradesContextType>({
  trades: [],
  addTrade: () => {},
  closeTrade: () => {},
  removeTrade: () => {},
  clearAll: () => {},
  totalPremiumCollected: 0,
  totalRealizedPnL: 0,
  openTradeCount: 0,
  totalCollateralInUse: 0,
});

export function useSimulatedTrades() {
  return useContext(SimulatedTradesContext);
}

// ─── Provider ────────────────────────────────────────────────

const STORAGE_KEY = "putstrike_simulated_trades";

export function SimulatedTradesProvider({ children }: { children: ReactNode }) {
  const [trades, setTrades] = useState<SimulatedTrade[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTrades(JSON.parse(saved));
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  }, [trades, loaded]);

  const addTrade = useCallback((trade: Omit<SimulatedTrade, "id" | "entryDate" | "status">) => {
    setTrades(prev => [{
      ...trade,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      entryDate: new Date().toISOString(),
      status: "open" as const,
    }, ...prev]);
  }, []);

  const closeTrade = useCallback((id: string, closePremium: number, reason: string) => {
    setTrades(prev => prev.map(t => {
      if (t.id !== id) return t;
      const realizedPnL = t.totalPremium - closePremium * t.contractSize * t.numContracts;
      return {
        ...t,
        status: realizedPnL >= 0 ? "closed_profit" as const : "closed_loss" as const,
        closeDate: new Date().toISOString(),
        closePremium,
        realizedPnL,
        closeReason: reason,
      };
    }));
  }, []);

  const removeTrade = useCallback((id: string) => {
    setTrades(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearAll = useCallback(() => setTrades([]), []);

  const openTrades = trades.filter(t => t.status === "open");
  const closedTrades = trades.filter(t => t.status !== "open");

  return (
    <SimulatedTradesContext.Provider value={{
      trades,
      addTrade,
      closeTrade,
      removeTrade,
      clearAll,
      totalPremiumCollected: trades.reduce((s, t) => s + t.totalPremium, 0),
      totalRealizedPnL: closedTrades.reduce((s, t) => s + (t.realizedPnL ?? 0), 0),
      openTradeCount: openTrades.length,
      totalCollateralInUse: openTrades.reduce((s, t) => s + t.collateral, 0),
    }}>
      {children}
    </SimulatedTradesContext.Provider>
  );
}

// ─── Simulate Trade Button ───────────────────────────────────
// Inline button + contract size/qty picker shown in put expanded rows

const CONTRACT_SIZES = [1, 10, 25, 50, 100, 200, 500, 1000];

interface SimulateTradeButtonProps {
  symbol: string;
  stockPrice: number;
  strikePrice: number;
  expiration: string;
  dte: number;
  bid: number;
  ask: number;
  delta: number;
  impliedVolatility: number;
  score: number;
  premiumYield: number;
  annualizedReturn: number;
  recommendation: string;
}

export function SimulateTradeButton(props: SimulateTradeButtonProps) {
  const { addTrade } = useSimulatedTrades();
  const [showForm, setShowForm] = useState(false);
  const [contractSize, setContractSize] = useState(100);
  const [numContracts, setNumContracts] = useState(1);
  const [confirmed, setConfirmed] = useState(false);

  const midPrice = (props.bid + props.ask) / 2;
  const totalPremium = midPrice * contractSize * numContracts;
  const collateral = props.strikePrice * contractSize * numContracts;

  const handleAdd = () => {
    addTrade({
      symbol: props.symbol,
      stockPriceAtEntry: props.stockPrice,
      strikePrice: props.strikePrice,
      expiration: props.expiration,
      dte: props.dte,
      premium: midPrice,
      contractSize,
      numContracts,
      totalPremium,
      collateral,
      premiumYield: props.premiumYield,
      annualizedReturn: props.annualizedReturn,
      delta: props.delta,
      impliedVolatility: props.impliedVolatility,
      score: props.score,
      recommendation: props.recommendation,
    });
    setConfirmed(true);
    setTimeout(() => { setConfirmed(false); setShowForm(false); }, 1500);
  };

  if (confirmed) {
    return (
      <span className="text-xs text-green-400 px-3 py-1">
        Added to trade log
      </span>
    );
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 rounded border border-blue-700/30 hover:bg-blue-900/20 transition-colors"
      >
        Simulate Trade
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <label className="text-[10px] text-gray-500">Shares/contract:</label>
        <select
          value={contractSize}
          onChange={e => setContractSize(Number(e.target.value))}
          className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
        >
          {CONTRACT_SIZES.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <label className="text-[10px] text-gray-500">Qty:</label>
        <input
          type="number"
          value={numContracts}
          min={1}
          max={999}
          onChange={e => setNumContracts(Math.max(1, Number(e.target.value) || 1))}
          className="w-14 bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
        />
      </div>
      <div className="text-[10px] text-gray-400">
        Premium: <span className="text-green-400">${totalPremium.toFixed(0)}</span>
        {" "}| Collateral: <span className="text-white">${collateral.toLocaleString()}</span>
      </div>
      <button
        onClick={handleAdd}
        className="text-xs text-green-400 hover:text-green-300 px-2 py-0.5 rounded border border-green-700/30 hover:bg-green-900/20"
      >
        Confirm
      </button>
      <button
        onClick={() => setShowForm(false)}
        className="text-xs text-gray-500 hover:text-gray-300"
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Trade Log Component ─────────────────────────────────────

export function TradeLog() {
  const {
    trades, closeTrade, removeTrade, clearAll,
    totalPremiumCollected, totalRealizedPnL, openTradeCount, totalCollateralInUse,
  } = useSimulatedTrades();
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closePrice, setClosePrice] = useState("");
  const [closeReason, setCloseReason] = useState("50% profit");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");

  if (trades.length === 0) return null;

  const filtered = filter === "all" ? trades
    : filter === "open" ? trades.filter(t => t.status === "open")
    : trades.filter(t => t.status !== "open");

  const openPremium = trades.filter(t => t.status === "open").reduce((s, t) => s + t.totalPremium, 0);

  const statusColors: Record<string, string> = {
    open: "text-blue-400",
    closed_profit: "text-green-400",
    closed_loss: "text-red-400",
    expired: "text-gray-400",
    assigned: "text-yellow-400",
  };

  const statusLabels: Record<string, string> = {
    open: "OPEN",
    closed_profit: "CLOSED +",
    closed_loss: "CLOSED -",
    expired: "EXPIRED",
    assigned: "ASSIGNED",
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-white">Simulated Trade Log</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{trades.length} trades</span>
            <button
              onClick={clearAll}
              className="text-xs text-red-400 hover:text-red-300 px-2 py-0.5 rounded border border-red-700/30 hover:bg-red-900/20"
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Premium-focused summary */}
        <div className="grid grid-cols-5 gap-3 text-xs">
          <div>
            <div className="text-gray-500">Total Premium</div>
            <div className="text-green-400 font-medium">
              ${totalPremiumCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Open Premium</div>
            <div className="text-blue-400 font-medium">
              ${openPremium.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Realized P&L</div>
            <div className={`font-medium ${totalRealizedPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalRealizedPnL >= 0 ? "+" : ""}${totalRealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Open Positions</div>
            <div className="text-blue-400 font-medium">{openTradeCount}</div>
          </div>
          <div>
            <div className="text-gray-500">Collateral in Use</div>
            <div className="text-white font-medium">${totalCollateralInUse.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-4 py-2 border-b border-gray-700/50 flex gap-1">
        {(["all", "open", "closed"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs ${
              filter === f ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {f === "all" ? `All (${trades.length})` : f === "open" ? `Open (${openTradeCount})` : `Closed (${trades.length - openTradeCount})`}
          </button>
        ))}
      </div>

      {/* Trade list */}
      <div className="divide-y divide-gray-700/50 max-h-96 overflow-y-auto">
        {filtered.map(trade => (
          <div key={trade.id} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-white font-medium text-sm">{trade.symbol}</span>
                <span className="text-gray-500 text-xs">${trade.strikePrice} put</span>
                <span className="text-gray-500 text-xs">{trade.expiration}</span>
                <span className="text-gray-600 text-xs">
                  {trade.numContracts}x{trade.contractSize}sh
                </span>
                <span className={`text-xs font-medium ${statusColors[trade.status]}`}>
                  {statusLabels[trade.status]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {trade.status === "open" && (
                  <>
                    {closeId === trade.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Buy-back $/sh"
                          value={closePrice}
                          onChange={e => setClosePrice(e.target.value)}
                          className="w-24 bg-gray-900 border border-gray-600 rounded px-2 py-0.5 text-xs text-white"
                        />
                        <select
                          value={closeReason}
                          onChange={e => setCloseReason(e.target.value)}
                          className="bg-gray-900 border border-gray-600 rounded px-1 py-0.5 text-xs text-white"
                        >
                          <option value="50% profit">50% profit</option>
                          <option value="2x stop loss">2x stop loss</option>
                          <option value="rolled">Rolled</option>
                          <option value="manual close">Manual close</option>
                          <option value="expired worthless">Expired OTM</option>
                          <option value="assigned">Assigned</option>
                        </select>
                        <button
                          onClick={() => {
                            const price = parseFloat(closePrice);
                            if (!isNaN(price) && price >= 0) {
                              closeTrade(trade.id, price, closeReason);
                              setCloseId(null);
                              setClosePrice("");
                            }
                          }}
                          className="text-xs text-green-400 hover:text-green-300 px-2 py-0.5 rounded border border-green-700/30"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => { setCloseId(null); setClosePrice(""); }}
                          className="text-xs text-gray-400 hover:text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setCloseId(trade.id)}
                        className="text-xs text-yellow-400 hover:text-yellow-300 px-2 py-0.5 rounded border border-yellow-700/30"
                      >
                        Close
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={() => removeTrade(trade.id)}
                  className="text-xs text-gray-500 hover:text-red-400"
                  title="Remove"
                >
                  x
                </button>
              </div>
            </div>

            {/* Premium-focused details */}
            <div className="grid grid-cols-5 gap-2 text-xs">
              <div>
                <span className="text-gray-500">Premium/sh: </span>
                <span className="text-green-400">${trade.premium.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-500">Total Premium: </span>
                <span className="text-green-400 font-medium">${trade.totalPremium.toFixed(0)}</span>
              </div>
              <div>
                <span className="text-gray-500">Collateral: </span>
                <span className="text-gray-300">${trade.collateral.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-500">Yield: </span>
                <span className="text-gray-300">{trade.premiumYield.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-gray-500">Ann. Return: </span>
                <span className="text-gray-300">{trade.annualizedReturn.toFixed(1)}%</span>
              </div>
            </div>

            {trade.status !== "open" && trade.realizedPnL !== undefined && (
              <div className="mt-1 text-xs">
                <span className="text-gray-500">P&L: </span>
                <span className={trade.realizedPnL >= 0 ? "text-green-400" : "text-red-400"}>
                  {trade.realizedPnL >= 0 ? "+" : ""}${trade.realizedPnL.toFixed(0)}
                </span>
                {trade.closePremium !== undefined && (
                  <span className="text-gray-600 ml-1">
                    (bought back ${trade.closePremium.toFixed(2)}/sh)
                  </span>
                )}
                <span className="text-gray-600 ml-1">
                  — {trade.closeReason}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
