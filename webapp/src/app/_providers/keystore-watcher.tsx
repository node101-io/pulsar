"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectedWallet, useKeyStore } from "@/lib/hooks";

export function KeyStore() {
  const connectedWallet = useConnectedWallet();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["keyStore"] });
  }, [connectedWallet?.type, connectedWallet?.address, queryClient]);

  useKeyStore(connectedWallet?.address, {
    enabled: !!connectedWallet?.address,
  });

  return null;
}
