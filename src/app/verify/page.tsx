"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { AppShell } from "@/components/AppShell";
import {
  Card,
  PageHeader,
  StatusBadge,
  Button,
  Input,
  Label,
  SectionTitle,
} from "@/components/ui";
import {
  VERIFY_DEMO_PRESETS,
  resolvePresetEndpoint,
  type VerifyDemoPreset,
} from "@/lib/demoAgents";
import {
  buildChallengeMessage,
  generateNonce,
  type VerificationResult,
} from "@/lib/verification";
import { notify } from "@/lib/toast";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";

export default function VerifyPage() {
  const searchParams = useSearchParams();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [activePresetId, setActivePresetId] = useState<string>(
    VERIFY_DEMO_PRESETS[0].id
  );
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";

  const defaultPreset = VERIFY_DEMO_PRESETS[0];
  const [agentId, setAgentId] = useState<string>(defaultPreset.agentId);
  const [endpointUrl, setEndpointUrl] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activePreset = useMemo(
    () =>
      VERIFY_DEMO_PRESETS.find((p) => p.id === activePresetId) ??
      VERIFY_DEMO_PRESETS[0],
    [activePresetId]
  );

  function resolveEndpoint(preset: VerifyDemoPreset): string {
    if (typeof preset.endpoint === "string") return preset.endpoint;
    if (!origin) return "";
    return resolvePresetEndpoint(preset, origin);
  }

  function applyPreset(preset: VerifyDemoPreset) {
    setActivePresetId(preset.id);
    setAgentId(preset.agentId);
    setEndpointUrl(resolveEndpoint(preset));
    setResult(null);
    setError(null);
  }

  useEffect(() => {
    const qpAgent = searchParams.get("agentId");
    const qpEndpoint = searchParams.get("endpoint");
    if (qpAgent) setAgentId(qpAgent);
    if (qpEndpoint) setEndpointUrl(qpEndpoint);
    if (qpAgent || qpEndpoint) setResult(null);
  }, [searchParams]);

  useEffect(() => {
    if (origin && !endpointUrl && !searchParams.get("endpoint")) {
      setEndpointUrl(resolveEndpoint(defaultPreset));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once when origin is known
  }, [origin]);

  async function runVerify(
    withSignature?: {
      signature: string;
      signer: string;
      message?: string;
    },
    endpointOverride?: string
  ) {
    const targetEndpoint = endpointOverride ?? endpointUrl;
    if (!targetEndpoint) {
      setError("Enter an endpoint URL or pick a demo preset.");
      return;
    }
    if (endpointOverride) setEndpointUrl(endpointOverride);

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          endpointUrl: targetEndpoint,
          ...withSignature,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setResult(data);

      if (data.status === "verified") {
        notify.success("Agent verified", { description: data.summary });
      } else if (data.status === "warning") {
        notify.info("Partial verification", { description: data.summary });
      } else {
        notify.error("Verification failed", { description: data.summary });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setError(msg);
      notify.error("Verification error", { description: msg });
    } finally {
      setLoading(false);
    }
  }

  async function verifyWithWallet() {
    if (!isConnected || !address) {
      setError("Connect MetaMask to sign the challenge locally.");
      return;
    }
    const endpoint = `${origin}/api/agent/challenge`;
    setLoading(true);
    setError(null);
    try {
      const nonce = generateNonce();
      const message = buildChallengeMessage(nonce, endpoint);
      const signature = await signMessageAsync({ message });
      setEndpointUrl(endpoint);
      await runVerify({ signature, signer: address, message }, endpoint);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Signing failed";
      setError(msg);
      notify.error("Signing failed", { description: msg });
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        step="Module 1 · Agent Verifier"
        title="Verify Agent Endpoint"
        description="Real ERC-8004 agents on Monad Testnet (chain 10143). Pick a demo preset or enter any agent ID + endpoint from 8004scan."
      />

      <Card className="mb-6" glow>
        <SectionTitle>Monad testnet demo presets</SectionTitle>
        <p className="mb-4 text-sm text-muted-foreground">
          One-click examples sourced from{" "}
          <a
            href="https://8004scan.io/agents"
            target="_blank"
            rel="noreferrer"
            className="text-accent underline"
          >
            8004scan
          </a>
          . Expected:{" "}
          <StatusBadge status={activePreset.expectedStatus} />
        </p>

        <div className="mb-5 flex flex-wrap gap-2">
          {VERIFY_DEMO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`rounded-full px-3 py-1.5 text-left text-xs font-semibold transition ${
                activePresetId === preset.id
                  ? "border border-accent/30 bg-accent-subtle text-accent"
                  : "border border-border bg-surface text-muted-foreground hover:bg-hover"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <p className="mb-4 rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs text-muted-foreground">
          {activePreset.description}{" "}
          <a
            href={activePreset.scanUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent underline"
          >
            8004scan API
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <Label>Agent ID</Label>
            <Input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="e.g. 1786"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <Label>Endpoint URL</Label>
            <Input
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            disabled={loading}
            onClick={() => {
              const url = endpointUrl || resolveEndpoint(activePreset);
              if (!url) {
                setError("Enter an endpoint URL or wait for page to load.");
                return;
              }
              void runVerify(undefined, url);
            }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify Endpoint
          </Button>
          {activePreset.id === "montrust-verified" && (
            <Button
              variant="secondary"
              disabled={loading || !isConnected}
              onClick={verifyWithWallet}
            >
              Sign with MetaMask
            </Button>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
      </Card>

      {result && (
        <Card glow>
          <div className="mb-4 flex items-center justify-between">
            <SectionTitle icon={<ShieldCheck className="h-4 w-4 text-accent" />}>
              Verification Result
            </SectionTitle>
            <StatusBadge status={result.status} />
          </div>
          <p className="mb-4 text-sm text-muted-foreground">{result.summary}</p>

          {result.agentCard && (
            <div className="mb-4 rounded-xl border border-accent/20 bg-accent-subtle/50 p-4 text-sm">
              <p className="font-medium text-foreground">{result.agentCard.name}</p>
              <p className="text-muted-foreground">{result.agentCard.description}</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Owner: {result.agentCard.owner}
              </p>
              {result.agentCard.registeredEndpoints.length > 0 && (
                <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                  {result.agentCard.registeredEndpoints.map((ep) => (
                    <li key={ep}>· {ep}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ul className="space-y-2">
            {result.checks.map((c) => (
              <li
                key={c.id}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                  c.passed
                    ? "border-emerald-200 bg-emerald-50"
                    : result.status === "warning" &&
                        (c.id === "challenge-response" || c.id === "wallet-match")
                      ? "border-amber-200 bg-amber-50"
                      : "border-rose-500/20 bg-rose-500/5"
                }`}
              >
                <span
                  className={
                    c.passed
                      ? "text-emerald-600"
                      : result.status === "warning" &&
                          (c.id === "challenge-response" || c.id === "wallet-match")
                        ? "text-amber-600"
                        : "text-rose-600"
                  }
                >
                  {c.passed ? "✓" : "○"}
                </span>
                <div>
                  <p className="font-medium text-foreground">{c.label}</p>
                  <p className="text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </AppShell>
  );
}
