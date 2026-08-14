"use client";

import React, {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { consumerChain } from "@/lib/constants";

/**
 * The Cosmos-side wallet context, spoken straight to window.keplr.
 *
 * This used to be interchain-kit's ChainProvider. Piece by piece the app had
 * already routed around that library — pubkey reads, signing, broadcast and
 * install detection all live in lib/keplr.ts because interchain-kit's async
 * init races the extension and its store lookups fail silently. What remained
 * of it was this file: connection status and a remembered session. That much
 * is enable() + getKey() + one localStorage flag, so now it is exactly that,
 * and nothing pulls interchain-kit — or libsodium's top-level await — into
 * the bundle anymore.
 */

/** Mirrors the interchain-kit enum this replaced, so `status === "Connected"` reads unchanged. */
export enum WalletState {
  Disconnected = "Disconnected",
  Connecting = "Connecting",
  Connected = "Connected",
}

/** The user approved this chain here before; try to resume without a prompt. */
const RECONNECT_FLAG = "pulsar-wallet-connected";

const CHAIN_ID = consumerChain.chainId!;

type PulsarWalletContextType = {
  status: WalletState;
  address: string | null;
  username: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

const PulsarWalletContext = createContext<PulsarWalletContextType | null>(null);

export function usePulsarWallet(): PulsarWalletContextType {
  const ctx = useContext(PulsarWalletContext);
  if (!ctx)
    throw new Error("usePulsarWallet must be used within PulsarWalletProvider");
  return ctx;
}

function getKeplr(): any | undefined {
  if (typeof window === "undefined") return undefined;
  // @ts-ignore - Keplr injects itself on window
  return window.keplr;
}

export function PulsarWalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletState>(WalletState.Disconnected);
  const [address, setAddress] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const keplr = getKeplr();
    if (!keplr) throw new Error("Keplr extension not detected");

    setStatus(WalletState.Connecting);
    try {
      await keplr.enable(CHAIN_ID);
      const key = await keplr.getKey(CHAIN_ID);
      setAddress((key?.bech32Address as string | undefined) ?? null);
      setUsername((key?.name as string | undefined) ?? null);
      setStatus(WalletState.Connected);
      localStorage.setItem(RECONNECT_FLAG, "1");
    } catch (e) {
      setStatus(WalletState.Disconnected);
      throw e;
    }
  }, []);

  const disconnect = useCallback(async () => {
    localStorage.removeItem(RECONNECT_FLAG);
    setStatus(WalletState.Disconnected);
    setAddress(null);
    setUsername(null);
    try {
      // Newer Keplr versions can revoke the site's approval; older ones just
      // don't have the method. Forgetting the session locally is the part
      // that matters.
      await getKeplr()?.disable?.(CHAIN_ID);
    } catch {
      // The local state is already cleared; a wallet that refuses is fine.
    }
  }, []);

  // Resume a previously approved session. Keplr injects itself after our
  // bundle is already running, so poll briefly instead of reading once.
  useEffect(() => {
    if (localStorage.getItem(RECONNECT_FLAG) !== "1") return;

    let cancelled = false;
    let tries = 0;

    const resume = async () => {
      if (cancelled) return;
      try {
        // enable() resolves without a prompt for an already-approved chain;
        // for anything else it throws or prompts, and failing quietly is the
        // right answer for an automatic resume.
        await connect();
      } catch {
        if (!cancelled) setStatus(WalletState.Disconnected);
      }
    };

    if (getKeplr()) {
      void resume();
      return;
    }
    const timer = setInterval(() => {
      if (getKeplr()) {
        clearInterval(timer);
        void resume();
      } else if (++tries >= 20) {
        clearInterval(timer);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connect]);

  // The user switched accounts inside the extension: same session, new key.
  useEffect(() => {
    const refresh = async () => {
      const keplr = getKeplr();
      if (!keplr || localStorage.getItem(RECONNECT_FLAG) !== "1") return;
      try {
        const key = await keplr.getKey(CHAIN_ID);
        setAddress((key?.bech32Address as string | undefined) ?? null);
        setUsername((key?.name as string | undefined) ?? null);
      } catch {
        // A key that can no longer be read is a disconnect in all but name.
      }
    };
    window.addEventListener("keplr_keystorechange", refresh);
    return () => window.removeEventListener("keplr_keystorechange", refresh);
  }, []);

  const value = useMemo(
    () => ({ status, address, username, connect, disconnect }),
    [status, address, username, connect, disconnect],
  );

  return (
    <PulsarWalletContext.Provider value={value}>
      {children}
    </PulsarWalletContext.Provider>
  );
}
