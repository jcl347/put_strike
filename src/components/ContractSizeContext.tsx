"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ContractSizeContextType {
  contractSize: number;
  setContractSize: (size: number) => void;
}

const ContractSizeContext = createContext<ContractSizeContextType>({
  contractSize: 100,
  setContractSize: () => {},
});

export function useContractSize() {
  return useContext(ContractSizeContext);
}

const CONTRACT_SIZE_OPTIONS = [1, 10, 25, 50, 100, 200, 500, 1000];

export function ContractSizeProvider({ children }: { children: ReactNode }) {
  const [contractSize, setContractSize] = useState(100);

  return (
    <ContractSizeContext.Provider value={{ contractSize, setContractSize }}>
      {children}
    </ContractSizeContext.Provider>
  );
}

export function ContractSizeSelector() {
  const { contractSize, setContractSize } = useContractSize();

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 whitespace-nowrap">Shares/Contract</label>
      <select
        value={contractSize}
        onChange={(e) => setContractSize(Number(e.target.value))}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
      >
        {CONTRACT_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size} shares
          </option>
        ))}
      </select>
      {contractSize !== 100 && (
        <span className="text-xs text-yellow-400">
          (standard: 100)
        </span>
      )}
    </div>
  );
}
