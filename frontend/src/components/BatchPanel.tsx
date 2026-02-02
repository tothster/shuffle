"use client";

import { FC, useState } from "react";
import { ShuffleClient, BatchInfo, BatchResult } from "shuffle-sdk";

interface Props {
  client: ShuffleClient | null;
  isReady: boolean;
}

export const BatchPanel: FC<Props> = ({ client, isReady }) => {
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  const [batchLog, setBatchLog] = useState<BatchResult | null>(null);
  const [logBatchId, setLogBatchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const refreshBatchInfo = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const info = await client.getBatchInfo();
      setBatchInfo(info);
      setStatus("");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  const fetchBatchLog = async () => {
    if (!client || !logBatchId) return;
    setLoading(true);
    try {
      const log = await client.getBatchLog(Number(logBatchId));
      setBatchLog(log);
      setStatus("");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  const PAIR_NAMES = ["TSLA/USDC", "SPY/USDC", "AAPL/USDC", "TSLA/SPY", "TSLA/AAPL", "SPY/AAPL"];

  return (
    <div className="border border-gray-700 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Batch Info</h2>

      <button
        onClick={refreshBatchInfo}
        disabled={!isReady || loading}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50 mb-3"
      >
        Refresh Batch Info
      </button>

      {batchInfo && (
        <div className="text-sm mb-3">
          <p>Batch ID: <span className="font-mono">{batchInfo.batchId}</span></p>
          <p>Order Count: <span className="font-mono">{batchInfo.orderCount}</span></p>
          <p>Active Pairs: <span className="font-mono">{batchInfo.activePairs.toString(2).padStart(6, "0")}</span></p>
        </div>
      )}

      <div className="flex gap-2 items-end mt-3">
        <div>
          <label className="text-xs text-gray-400 block">Batch Log ID</label>
          <input
            type="number"
            value={logBatchId}
            onChange={(e) => setLogBatchId(e.target.value)}
            placeholder="0"
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm w-20"
          />
        </div>
        <button
          onClick={fetchBatchLog}
          disabled={!isReady || loading || !logBatchId}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
        >
          View Log
        </button>
      </div>

      {batchLog && (
        <div className="mt-3 overflow-x-auto">
          <table className="text-xs font-mono w-full">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left pr-3">Pair</th>
                <th className="text-right pr-3">Total A In</th>
                <th className="text-right pr-3">Total B In</th>
                <th className="text-right pr-3">Final A</th>
                <th className="text-right">Final B</th>
              </tr>
            </thead>
            <tbody>
              {batchLog.results.map((r, i) => (
                <tr key={i} className={r.totalAIn.isZero() && r.totalBIn.isZero() ? "text-gray-600" : ""}>
                  <td className="pr-3">{PAIR_NAMES[i]}</td>
                  <td className="text-right pr-3">{r.totalAIn.toString()}</td>
                  <td className="text-right pr-3">{r.totalBIn.toString()}</td>
                  <td className="text-right pr-3">{r.finalPoolA.toString()}</td>
                  <td className="text-right">{r.finalPoolB.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status && <p className="text-sm text-gray-400 mt-2">{status}</p>}
    </div>
  );
};
