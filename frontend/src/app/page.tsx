"use client";

import dynamic from "next/dynamic";
import { WalletProviderWrapper, WalletButton } from "@/components/WalletProvider";
import { useShuffle } from "@/hooks/useShuffle";
import { useEncryption } from "@/hooks/useEncryption";
import { AccountPanel } from "@/components/AccountPanel";
import { BalancePanel } from "@/components/BalancePanel";
import { OrderPanel } from "@/components/OrderPanel";
import { SettlePanel } from "@/components/SettlePanel";
import { BatchPanel } from "@/components/BatchPanel";

function Dashboard() {
  const { privateKey, isReady: encReady } = useEncryption();
  const { client, isReady, error } = useShuffle(encReady ? privateKey : null);

  const ready = isReady && encReady;

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Shuffle</h1>
        <WalletButton />
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {!isReady && !error && (
        <p className="text-gray-400 text-sm mb-4">Connect your wallet to get started.</p>
      )}

      <div className="grid gap-4">
        <AccountPanel client={client} isReady={ready} />
        <BalancePanel client={client} isReady={ready} />
        <OrderPanel client={client} isReady={ready} />
        <SettlePanel client={client} isReady={ready} />
        <BatchPanel client={client} isReady={ready} />
      </div>
    </div>
  );
}

// Dynamically import the App component with SSR disabled to prevent hydration mismatches
// Wallet adapters and localStorage access cause issues with SSR
function App() {
  return (
    <WalletProviderWrapper>
      <Dashboard />
    </WalletProviderWrapper>
  );
}

// Export with no SSR to prevent hydration errors from wallet adapter and localStorage
export default dynamic(() => Promise.resolve(App), { ssr: false });
