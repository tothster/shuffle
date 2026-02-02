"use client";

import { FC, useState } from "react";
import { ShuffleClient } from "shuffle-sdk";

interface Props {
  client: ShuffleClient | null;
  isReady: boolean;
}

export const AccountPanel: FC<Props> = ({ client, isReady }) => {
  const [exists, setExists] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const checkAccount = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const result = await client.accountExists();
      setExists(result);
      setStatus(result ? "Account exists" : "No account found");
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  const createAccount = async () => {
    if (!client) return;
    setLoading(true);
    setStatus("Creating account...");
    try {
      const sig = await client.createUserAccount();
      setExists(true);
      setStatus(`Account created! Tx: ${sig.slice(0, 16)}...`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="border border-gray-700 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Account</h2>
      <div className="flex gap-2 mb-2">
        <button
          onClick={checkAccount}
          disabled={!isReady || loading}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
        >
          Check Account
        </button>
        <button
          onClick={createAccount}
          disabled={!isReady || loading || exists === true}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50"
        >
          Create Account
        </button>
      </div>
      {status && <p className="text-sm text-gray-400 mt-1">{status}</p>}
    </div>
  );
};
