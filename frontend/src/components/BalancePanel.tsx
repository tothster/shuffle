"use client";

import { FC, useState } from "react";
import { ShuffleClient, AssetId, ASSET_LABELS, UserBalance } from "shuffle-sdk";

interface Props {
  client: ShuffleClient | null;
  isReady: boolean;
}

const ASSETS = [AssetId.USDC, AssetId.TSLA, AssetId.SPY, AssetId.AAPL];

export const BalancePanel: FC<Props> = ({ client, isReady }) => {
  const [balances, setBalances] = useState<UserBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AssetId>(AssetId.USDC);
  const [amount, setAmount] = useState("");

  const refreshBalances = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const b = await client.getBalance();
      setBalances(b);
      setStatus("Balances refreshed");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  const handleDeposit = async () => {
    if (!client || !amount) return;
    setLoading(true);
    setStatus("Depositing...");
    try {
      const amountBase = Math.round(parseFloat(amount) * 1_000_000);
      await client.deposit(selectedAsset, amountBase);
      setStatus(`Deposited ${amount} ${ASSET_LABELS[selectedAsset]}`);
      setAmount("");
      await refreshBalances();
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  const handleWithdraw = async () => {
    if (!client || !amount) return;
    setLoading(true);
    setStatus("Withdrawing...");
    try {
      const amountBase = Math.round(parseFloat(amount) * 1_000_000);
      await client.withdraw(selectedAsset, amountBase);
      setStatus(`Withdrew ${amount} ${ASSET_LABELS[selectedAsset]}`);
      setAmount("");
      await refreshBalances();
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  const formatBalance = (val: bigint) => {
    const whole = val / 1_000_000n;
    const frac = (val % 1_000_000n).toString().padStart(6, "0");
    return `${whole}.${frac}`;
  };

  return (
    <div className="border border-gray-700 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Balances</h2>

      {balances && (
        <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
          <div>USDC: <span className="font-mono">{formatBalance(balances.usdc)}</span></div>
          <div>TSLA: <span className="font-mono">{formatBalance(balances.tsla)}</span></div>
          <div>SPY: <span className="font-mono">{formatBalance(balances.spy)}</span></div>
          <div>AAPL: <span className="font-mono">{formatBalance(balances.aapl)}</span></div>
        </div>
      )}

      <button
        onClick={refreshBalances}
        disabled={!isReady || loading}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50 mb-3"
      >
        Refresh Balances
      </button>

      <div className="flex gap-2 items-end mt-2">
        <div>
          <label className="text-xs text-gray-400 block">Asset</label>
          <select
            value={selectedAsset}
            onChange={(e) => setSelectedAsset(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
          >
            {ASSETS.map((a) => (
              <option key={a} value={a}>{ASSET_LABELS[a]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm w-28"
          />
        </div>
        <button
          onClick={handleDeposit}
          disabled={!isReady || loading || !amount}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-sm disabled:opacity-50"
        >
          Deposit
        </button>
        <button
          onClick={handleWithdraw}
          disabled={!isReady || loading || !amount}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-sm disabled:opacity-50"
        >
          Withdraw
        </button>
      </div>

      {status && <p className="text-sm text-gray-400 mt-2">{status}</p>}
    </div>
  );
};
