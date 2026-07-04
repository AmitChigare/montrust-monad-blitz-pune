"use client";

import { createWalletClient, custom, type WalletClient } from "viem";
import { erc7715ProviderActions } from "@metamask/smart-accounts-kit/actions";
import { monadTestnet } from "@/lib/chain";
import { MONAD_TESTNET } from "@/lib/constants";

export type MetaMaskEthereum = {
  isMetaMask?: boolean;
  isRainbow?: boolean;
  selectedAddress?: string;
  chainId?: string;
  providers?: MetaMaskEthereum[];
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export function getMetaMaskProvider(): MetaMaskEthereum | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & { ethereum?: MetaMaskEthereum };
  const eth = w.ethereum;
  if (!eth) return undefined;

  const providers = eth.providers ?? [eth];
  return providers.find((p) => p.isMetaMask && !p.isRainbow) ?? (eth.isMetaMask ? eth : undefined);
}

export function isMetaMaskInstalled(): boolean {
  return Boolean(getMetaMaskProvider());
}

export function getMetaMaskChainIdHex(): string | null {
  const provider = getMetaMaskProvider();
  return provider?.chainId ?? null;
}

export async function requestMetaMaskAccounts(): Promise<`0x${string}`[]> {
  const provider = getMetaMaskProvider();
  if (!provider?.request) {
    throw new Error(
      "MetaMask is required. Install MetaMask and connect on Monad Testnet (10143)."
    );
  }

  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];

  return accounts as `0x${string}`[];
}

export async function getConnectedMetaMaskAccount(): Promise<`0x${string}` | null> {
  const provider = getMetaMaskProvider();
  if (!provider?.request) return null;

  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];

  return (accounts[0] as `0x${string}`) ?? null;
}

export function createMetaMaskWalletClient(): WalletClient | null {
  const provider = getMetaMaskProvider();
  if (!provider) return null;

  return createWalletClient({
    chain: monadTestnet,
    transport: custom(provider as import("viem").EIP1193Provider),
  }).extend(erc7715ProviderActions());
}

/** Switch MetaMask to Monad Testnet (10143), adding the chain if needed. */
export async function ensureMonadTestnetInMetaMask(): Promise<void> {
  const provider = getMetaMaskProvider();
  if (!provider?.request) {
    throw new Error(
      "MetaMask is required. Install MetaMask and connect on Monad Testnet (10143)."
    );
  }

  const chainIdHex = await provider.request({ method: "eth_chainId" });
  const current = parseInt(String(chainIdHex), 16);
  if (current === MONAD_TESTNET.chainId) return;

  const targetHex = `0x${MONAD_TESTNET.chainId.toString(16)}`;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: targetHex,
          chainName: MONAD_TESTNET.name,
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: [MONAD_TESTNET.rpcUrl],
          blockExplorerUrls: [MONAD_TESTNET.explorerUrl],
        },
      ],
    });
  }
}
