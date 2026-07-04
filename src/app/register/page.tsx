"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { decodeEventLog } from "viem";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Card, PageHeader, Button, SectionTitle } from "@/components/ui";
import { ERC8004 } from "@/lib/constants";
import { monadTestnet } from "@/lib/chain";
import { identityRegistryAbi } from "@/abi/identityRegistry";
import { buildMonTrustAgentCard } from "@/lib/erc8004";
import {
  buildRegistrationUri,
  estimateRegisterGas,
  formatRegisterGasHint,
  resolveAppOrigin,
} from "@/lib/registerAgent";
import {
  ensureMonadTestnetInMetaMask,
  isMetaMaskInstalled,
} from "@/lib/metamaskWallet";
import { notify } from "@/lib/toast";
import { Loader2, CheckCircle2, UserPlus, AlertTriangle } from "lucide-react";

const AGENT_ID_KEY = "montrust-agent-id";

function parseUserError(error: unknown): string {
  if (!(error instanceof Error)) return "Registration failed";
  const msg = error.message;
  if (/user rejected|denied|cancelled|canceled/i.test(msg)) {
    return "Transaction cancelled in MetaMask.";
  }
  if (/insufficient funds|exceeds balance/i.test(msg)) {
    return "Insufficient MON for gas. Get testnet MON from faucet.monad.xyz";
  }
  if (/gas/i.test(msg)) {
    return `${msg} — registration needs ~2.1M+ gas on Monad Testnet.`;
  }
  return msg;
}

export default function RegisterPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: monadTestnet.id });
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const onMonadTestnet = chainId === monadTestnet.id;

  const [origin, setOrigin] = useState(() => resolveAppOrigin());
  const [registeredId, setRegisteredId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [gasHint, setGasHint] = useState<string | null>(null);

  const { writeContractAsync, data: txHash, isPending, error: writeError } =
    useWriteContract();
  const {
    isLoading: confirming,
    isSuccess: receiptSuccess,
    data: receipt,
    isError: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    setOrigin(resolveAppOrigin(window.location.origin));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(AGENT_ID_KEY);
    if (saved) setRegisteredId(saved);
  }, []);

  useEffect(() => {
    if (!writeError) return;
    const msg = parseUserError(writeError);
    setError(msg);
    notify.dismiss();
    notify.error("Registration failed", { description: msg });
    setSubmitting(false);
  }, [writeError]);

  useEffect(() => {
    if (!txHash || confirming) return;
    if (receiptError || receipt?.status === "reverted") {
      const msg =
        "Transaction reverted on-chain. This usually means gas limit was too low — please try again.";
      setError(msg);
      notify.dismiss();
      notify.error("Registration failed", { description: msg });
      setSubmitting(false);
      return;
    }
    if (!receiptSuccess || !publicClient) return;

    publicClient.getTransactionReceipt({ hash: txHash }).then((r) => {
      if (r.status === "reverted") {
        setError("Transaction reverted on-chain.");
        notify.dismiss();
        notify.error("Registration failed", {
          description: "Transaction reverted — retry with higher gas.",
        });
        setSubmitting(false);
        return;
      }

      for (const log of r.logs) {
        try {
          const decoded = decodeEventLog({
            abi: identityRegistryAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "Registered") {
            const id = (decoded.args as { agentId: bigint }).agentId.toString();
            setRegisteredId(id);
            localStorage.setItem(AGENT_ID_KEY, id);
          }
        } catch {
          /* skip */
        }
      }
      setSubmitting(false);
    });
  }, [
    txHash,
    confirming,
    receiptSuccess,
    receiptError,
    receipt,
    publicClient,
  ]);

  useEffect(() => {
    if (registeredId && txHash && receipt?.status === "success") {
      notify.dismiss();
      notify.txSuccess(
        `Agent #${registeredId} registered on Monad`,
        txHash
      );
    }
  }, [registeredId, txHash, receipt?.status]);

  async function ensureMonadNetwork(): Promise<boolean> {
    try {
      await ensureMonadTestnetInMetaMask();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Could not switch MetaMask to Monad Testnet.";
      setError(msg);
      notify.error("Network switch failed", { description: msg });
      return false;
    }

    if (chainId !== monadTestnet.id) {
      try {
        await switchChainAsync({ chainId: monadTestnet.id });
      } catch (e) {
        const msg = parseUserError(e);
        setError(msg);
        notify.error("Wrong network", { description: msg });
        return false;
      }
    }

    return true;
  }

  async function registerAgent() {
    if (!isMetaMaskInstalled()) {
      const msg = "Install MetaMask to register your agent on Monad Testnet.";
      setError(msg);
      notify.error("MetaMask required", { description: msg });
      return;
    }
    if (!address) {
      setError("Connect MetaMask on Monad Testnet first.");
      notify.error("Wallet required", {
        description: "Connect MetaMask on Monad Testnet first.",
      });
      return;
    }
    if (!publicClient) {
      setError("RPC client not ready. Refresh and try again.");
      return;
    }

    setError(null);
    setSubmitting(true);

    const ready = await ensureMonadNetwork();
    if (!ready) {
      setSubmitting(false);
      return;
    }

    const appOrigin = resolveAppOrigin(origin);
    const uri = buildRegistrationUri(appOrigin, address);

    let gas: bigint;
    try {
      gas = await estimateRegisterGas(publicClient, uri, address);
      setGasHint(formatRegisterGasHint(gas));
    } catch (e) {
      notify.dismiss();
      const msg = parseUserError(e);
      setError(msg);
      notify.error("Gas estimation failed", { description: msg });
      setSubmitting(false);
      return;
    }

    notify.loading(`Confirm in MetaMask (${formatRegisterGasHint(gas)})…`);

    try {
      await writeContractAsync({
        address: ERC8004.identityRegistry,
        abi: identityRegistryAbi,
        functionName: "register",
        args: [uri],
        chainId: monadTestnet.id,
        gas,
      });
    } catch (e) {
      notify.dismiss();
      const msg = parseUserError(e);
      setError(msg);
      notify.error("Registration failed", { description: msg });
      setSubmitting(false);
    }
  }

  const challengeEndpoint = `${origin}/api/agent/challenge`;
  const busy = submitting || isPending || confirming;

  const steps = [
    <>
      Connect <strong className="text-foreground">MetaMask</strong> with MON on{" "}
      <strong className="text-foreground">Monad Testnet</strong> (chain 10143).
      Faucet:{" "}
      <a
        href="https://faucet.monad.xyz"
        target="_blank"
        rel="noreferrer"
        className="text-accent underline"
      >
        faucet.monad.xyz
      </a>
    </>,
    <>
      Register agent — mints NFT on Identity Registry{" "}
      <code className="text-accent">
        {ERC8004.identityRegistry.slice(0, 10)}…
      </code>
      . Needs ~2.1–2.3M gas on Monad (billed on gas limit).
    </>,
    <>
      Agent card uses <strong className="text-foreground">this site&apos;s URL</strong>{" "}
      ({origin}) for challenge endpoint{" "}
      <code className="text-accent">{challengeEndpoint}</code>
    </>,
  ];

  return (
    <AppShell>
      <PageHeader
        step="Module 3 · Registration"
        title="Register MonTrust Vision Agent"
        description="Mint an ERC-8004 identity on Monad Testnet. Works on localhost and production — your agent card always uses the URL of the site you register from."
      />

      <Card className="mb-6" glow>
        <ol className="space-y-4 text-sm text-muted-foreground">
          {steps.map((content, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent-subtle text-xs font-bold text-accent">
                {i + 1}
              </span>
              <span className="pt-0.5">{content}</span>
            </li>
          ))}
        </ol>

        {isConnected && !onMonadTestnet && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>MetaMask is on the wrong network.</span>
            <Button
              size="sm"
              variant="secondary"
              disabled={switching || busy}
              onClick={() => void ensureMonadNetwork()}
            >
              {switching ? "Switching…" : "Switch to Monad Testnet"}
            </Button>
          </div>
        )}

        {gasHint && (
          <p className="mt-4 text-xs text-muted-foreground">
            Last gas estimate: {gasHint}
          </p>
        )}

        <Button
          size="lg"
          className="mt-6"
          onClick={() => void registerAgent()}
          disabled={!isConnected || busy}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          <UserPlus className="h-4 w-4" />
          Register Agent On-Chain
        </Button>
        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        {registeredId && receipt?.status === "success" && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <div className="text-emerald-800">
              <p className="font-semibold">Agent registered!</p>
              <p className="mt-0.5">
                Agent ID: <strong>#{registeredId}</strong> — saved for Photo
                Proof and Agent Verifier.
              </p>
              <Link
                href={`/verify?agentId=${registeredId}&endpoint=${encodeURIComponent(challengeEndpoint)}`}
                className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
              >
                Verify this agent now →
              </Link>
              {txHash && (
                <a
                  href={`${monadTestnet.blockExplorers.default.url}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-xs text-accent hover:underline"
                >
                  View transaction
                </a>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Agent card preview ({origin})</SectionTitle>
        <pre className="overflow-x-auto rounded-xl border border-border bg-muted p-4 font-mono text-xs text-muted-foreground">
          {JSON.stringify(
            address
              ? buildMonTrustAgentCard(origin, address)
              : { note: "Connect MetaMask to preview" },
            null,
            2
          )}
        </pre>
      </Card>
    </AppShell>
  );
}
