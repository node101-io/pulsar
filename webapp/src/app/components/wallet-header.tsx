"use client";

import { PulsarWalletProvider } from "@/app/_providers/pulsar-wallet";
import Header from "./header";

/**
 * The header and the Cosmos wallet context it needs, as one client-only unit.
 *
 * The context wraps nothing else: no page reads it, and keeping it out of the
 * root tree keeps interchain-kit — and libsodium's top-level await with it —
 * out of the server bundle, so pages still prerender.
 */
export default function WalletHeader() {
  return (
    <PulsarWalletProvider>
      <Header />
    </PulsarWalletProvider>
  );
}
