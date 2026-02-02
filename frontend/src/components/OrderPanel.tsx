"use client";

import { FC, useState, useEffect } from "react";
import {
  ShuffleClient,
  AssetId,
  PairId,
  Direction,
  ASSET_LABELS,
  PAIR_TOKENS,
  DecryptedOrderInfo,
} from "shuffle-sdk";

interface Props {
  client: ShuffleClient | null;
  isReady: boolean;
}

const PAIR_LABELS: Record<PairId, string> = {
  [PairId.TSLA_USDC]: "TSLA/USDC",
  [PairId.SPY_USDC]: "SPY/USDC",
  [PairId.AAPL_USDC]: "AAPL/USDC",
  [PairId.TSLA_SPY]: "TSLA/SPY",
  [PairId.TSLA_AAPL]: "TSLA/AAPL",
  [PairId.SPY_AAPL]: "SPY/AAPL",
};

const DIRECTION_LABELS: Record<Direction, string> = {
  [Direction.AtoB]: "A to B (Sell Base)",
  [Direction.BtoA]: "B to A (Buy Base)",
};

export const OrderPanel: FC<Props> = ({ client, isReady }) => {
  const [pairId, setPairId] = useState<PairId>(PairId.TSLA_USDC);
  const [direction, setDirection] = useState<Direction>(Direction.AtoB);
  const [amount, setAmount] = useState("");
  const [sourceAsset, setSourceAsset] = useState<AssetId>(AssetId.TSLA);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [pendingOrder, setPendingOrder] = useState<DecryptedOrderInfo | null>(
    null,
  );

  useEffect(() => {
    const [base, quote] = PAIR_TOKENS[pairId];
    setSourceAsset(direction === Direction.AtoB ? base : quote);
  }, [pairId, direction]);

  const checkPendingOrder = async () => {
    if (!client) return;
    try {
      // Use getDecryptedOrder to get user-readable order details
      const order = await client.getDecryptedOrder();
      setPendingOrder(order);
    } catch {
      setPendingOrder(null);
    }
  };

  const placeOrder = async () => {
    if (!client || !amount) return;
    setLoading(true);
    setStatus("Placing order...");
    try {
      const amountBase = Math.round(parseFloat(amount) * 1_000_000);
      await client.placeOrder(pairId, direction, amountBase, sourceAsset);
      setStatus("Order placed!");
      setAmount("");
      await checkPendingOrder();
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="border border-gray-700 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Place Order</h2>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="text-xs text-gray-400 block">Pair</label>
          <select
            value={pairId}
            onChange={(e) => setPairId(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm w-full"
          >
            {Object.entries(PAIR_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block">Direction</label>
          <select
            value={direction}
            onChange={(e) => setDirection(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm w-full"
          >
            <option value={Direction.AtoB}>A to B (Sell Base)</option>
            <option value={Direction.BtoA}>B to A (Buy Base)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm w-full"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block">Source Asset</label>
          <div className="px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded">
            {ASSET_LABELS[sourceAsset]}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={placeOrder}
          disabled={!isReady || loading || !amount}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50"
        >
          Place Order
        </button>
        <button
          onClick={checkPendingOrder}
          disabled={!isReady || loading}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
        >
          Check Pending
        </button>
        <button
          disabled
          title="Coming in Phase 11"
          className="px-3 py-1.5 bg-gray-800 rounded text-sm opacity-50 cursor-not-allowed"
        >
          Cancel Order
        </button>
      </div>

      {pendingOrder && (
        <div className="mt-3 p-3 bg-gray-800 rounded border border-gray-700">
          <div className="text-sm font-medium text-green-400 mb-2">
            ✓ Pending Order (Decrypted)
          </div>
          <div className="text-sm text-gray-300 space-y-1">
            <div>Batch: #{pendingOrder.batchId}</div>
            <div>
              Pair:{" "}
              {PAIR_LABELS[pendingOrder.pairId as PairId] ||
                `Pair ${pendingOrder.pairId}`}
            </div>
            <div>
              Direction:{" "}
              {DIRECTION_LABELS[pendingOrder.direction as Direction] ||
                `Direction ${pendingOrder.direction}`}
            </div>
            <div>
              Amount: {(Number(pendingOrder.amount) / 1_000_000).toFixed(6)}
            </div>
          </div>
        </div>
      )}

      {status && <p className="text-sm text-gray-400 mt-2">{status}</p>}
    </div>
  );
};
