"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ProviderError, ChainInfoArgs, SignMessageArgs, SignedData } from '../../lib/types';
import toast from 'react-hot-toast';

interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  account: string | null;
  network: ChainInfoArgs | null;
}

interface WalletContextType extends WalletState {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  signMessage: (args: SignMessageArgs) => Promise<SignedData>;
  isWalletInstalled: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function useMinaWallet() {
  const context = useContext(WalletContext);

  if (context === undefined)
    throw new Error('useMinaWallet must be used within a MinaWalletProvider');

  return context;
}

export function MinaWalletProvider({ children }: {
  children: ReactNode;
}) {
  const [walletState, setWalletState] = useState<WalletState>({
    isConnected: false,
    isConnecting: false,
    account: null,
    network: null,
  });

  const isWalletInstalled = typeof window !== 'undefined' && typeof window.mina !== 'undefined';

  useEffect(() => {
    if (!isWalletInstalled) return;

    checkExistingConnection();
    setupEventListeners();
  }, [isWalletInstalled]);

  const checkExistingConnection = async () => {
    try {
      const accounts = await window.mina?.getAccounts();
      if (accounts && accounts.length > 0) {
        const network = await window.mina?.requestNetwork();
        setWalletState(prev => ({
          ...prev,
          isConnected: true,
          account: accounts[0] || null,
          network: network && !('message' in network) ? network : null,
        }));
      }
    } catch (error) {
      console.error('Failed to check existing connection:', error);
    }
  };

  const setupEventListeners = () => {
    if (!window.mina) return;

    window.mina.on('accountsChanged', (accounts: string[]) => {
      if (accounts.length === 0) {
        setWalletState(prev => ({
          ...prev,
          isConnected: false,
          account: null,
        }));
      } else {
        setWalletState(prev => ({
          ...prev,
          isConnected: true,
          account: accounts[0] || null,
        }));
      }
    });

    window.mina.on('chainChanged', (chainInfo: ChainInfoArgs) => {
      setWalletState(prev => ({
        ...prev,
        network: chainInfo,
      }));
    });
  };

  const connectWallet = async () => {
    if (!isWalletInstalled) {
      toast.error('Auro Wallet is not installed. Please install it from the Chrome Web Store.', {
        id: 'wallet-not-found'
      });
      return;
    }

    setWalletState(prev => ({
      ...prev,
      isConnecting: true,
    }));

    try {
      const accounts = await window.mina?.requestAccounts();

      if (accounts && 'message' in accounts) {
        throw new Error((accounts as ProviderError).message);
      }

      if (accounts && accounts.length > 0) {
        const network = await window.mina?.requestNetwork();

        setWalletState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          account: accounts[0] || null,
          network: network && !('message' in network) ? network : null,
        }));
      }
    } catch (error) {
      setWalletState(prev => ({
        ...prev,
        isConnecting: false,
      }));
    }
  };

  const disconnectWallet = () => {
    setWalletState({
      isConnected: false,
      isConnecting: false,
      account: null,
      network: null,
    });
  };

  const signMessage = async (args: SignMessageArgs): Promise<SignedData> => {
    if (!isWalletInstalled) {
      throw new Error('Auro Wallet is not installed');
    }

    if (!walletState.isConnected) {
      throw new Error('Wallet is not connected');
    }

    try {
      const result = await window.mina?.signMessage(args);

      if (result && 'message' in result) {
        throw new Error((result as ProviderError).message);
      }

      if (!result) {
        throw new Error('Failed to sign message');
      }

      return result as SignedData;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to sign message');
    }
  };

  const value: WalletContextType = {
    ...walletState,
    connectWallet,
    disconnectWallet,
    signMessage,
    isWalletInstalled,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}