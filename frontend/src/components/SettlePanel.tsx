"use client";

import { FC, useState } from "react";
import { ShuffleClient, OrderInfo } from "shuffle-sdk";

interface Props {
  client: ShuffleClient | null;
  isReady: boolean;
}

export const SettlePanel: FC<Props> = ({ client, isReady }) => {
  const [pendingOrder, setPendingOrder] = useState<OrderInfo | null>(null);
  const [pairId, setPairId] = useState(0);
  const [direction, setDirection] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const refreshPending = async () => {
    if (!client) return;
    try {
      const order = await client.getPendingOrder();
      setPendingOrder(order);
      if (!order) setStatus("No pending order");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const settle = async () => {
    if (!client) return;
    setLoading(true);
    setStatus("Settling order...");
    try {
      await client.settleOrder(pairId, direction);
      setStatus("Order settled!");
      setPendingOrder(null);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="border border-gray-700 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Settle Order</h2>

      <button
        onClick={refreshPending}
        disabled={!isReady || loading}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50 mb-3"
      >
        Check Pending Order
      </button>

      {pendingOrder && (
        <div className="mb-3 text-sm">
          <p>Batch: #{pendingOrder.batchId}</p>
          <div className="flex gap-2 mt-2">
            <div>
              <label className="text-xs text-gray-400 block">Pair ID</label>
              <input
                type="number"
                value={pairId}
                onChange={(e) => setPairId(Number(e.target.value))}
                min={0} max={5}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm w-20"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block">Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(Number(e.target.value))}
                className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
              >
                <option value={0}>A to B</option>
                <option value={1}>B to A</option>
              </select>
            </div>
            <button
              onClick={settle}
              disabled={loading}
              className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 rounded text-sm disabled:opacity-50 self-end"
            >
              Settle
            </button>
          </div>
        </div>
      )}

      {status && <p className="text-sm text-gray-400 mt-2">{status}</p>}
    </div>
  );
};
