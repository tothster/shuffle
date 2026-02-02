import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shuffle - Private DeFi on Solana",
  description: "Privacy-preserving DeFi protocol for private trading of tokenized stocks",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
