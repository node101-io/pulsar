"use client";

import dynamic from "next/dynamic";

// Client-only: it carries the interchain-kit chain store, which cannot exist
// during prerender and whose dependency graph reaches libsodium's top-level
// await. Excluding it from the server bundle is what lets the pages prerender.
// `ssr: false` is only legal inside a client component, which is this file's
// whole reason to exist — it keeps the root layout a server component.
const WalletHeader = dynamic(() => import("./wallet-header"), {
  ssr: false,
  loading: () => <div className="h-[var(--header-height)] shrink-0" />,
});

export default function WalletHeaderSlot() {
  return <WalletHeader />;
}
