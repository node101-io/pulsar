"use client";

import { PulsarWalletProvider } from "@/app/_providers/pulsar-wallet";
import Header from "./header";

/**
 * The header and the Cosmos wallet context it needs, as one unit.
 *
 * The context wraps nothing else on purpose: no page reads it. Pages that
 * need the connected address read it straight off the extension via
 * lib/keplr.ts, and keeping the provider scoped here keeps that boundary
 * honest.
 */
export default function WalletHeader() {
  return (
    <PulsarWalletProvider>
      <Header />
    </PulsarWalletProvider>
  );
}
