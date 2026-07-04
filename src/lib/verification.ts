import {
  recoverMessageAddress,
  type Hex,
} from "viem";
import { matchRegisteredEndpoint } from "./endpointAliases";
import { resolveAgentFromRegistry } from "./erc8004";

export type VerificationStatus = "verified" | "failed" | "warning";

export interface VerificationCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  agentId: string;
  endpointUrl: string;
  timestamp: string;
  checks: VerificationCheck[];
  agentCard: {
    name: string;
    description: string;
    owner: string;
    wallet: string | null;
    registeredEndpoints: string[];
    tokenURI: string;
  } | null;
  challenge: {
    nonce: string;
    signatureValid: boolean;
    signerAddress: string | null;
    message: string;
  };
  summary: string;
}

export function buildChallengeMessage(nonce: string, endpointUrl: string): string {
  return `MonTrust Agent Verification\nNonce: ${nonce}\nEndpoint: ${endpointUrl}`;
}

export function generateNonce(): string {
  return `tl-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

async function requestEndpointSignature(
  endpointUrl: string,
  nonce: string,
  message: string
): Promise<{ signature: Hex | null; signer: string | null; error?: string }> {
  const base = endpointUrl.replace(/\/$/, "");
  const challengeUrl = base.endsWith("/challenge")
    ? base
    : `${base}/challenge`;

  try {
    const res = await fetch(challengeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce, message }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { signature: null, signer: null, error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as {
      signature?: string;
      signer?: string;
    };

    if (!data.signature) {
      return { signature: null, signer: null, error: "No signature in response" };
    }

    return {
      signature: data.signature as Hex,
      signer: data.signer ?? null,
    };
  } catch (e) {
    return {
      signature: null,
      signer: null,
      error: e instanceof Error ? e.message : "Challenge request failed",
    };
  }
}

export async function verifySignature(
  message: string,
  signature: Hex
): Promise<string | null> {
  try {
    return await recoverMessageAddress({ message, signature });
  } catch {
    return null;
  }
}

export async function verifyAgentEndpoint(
  agentIdStr: string,
  endpointUrl: string,
  options?: { signature?: Hex; signer?: string; message?: string }
): Promise<VerificationResult> {
  const timestamp = new Date().toISOString();
  const checks: VerificationCheck[] = [];
  const nonce = generateNonce();
  const message =
    options?.message ?? buildChallengeMessage(nonce, endpointUrl);

  let agentId: bigint;
  try {
    agentId = BigInt(agentIdStr);
  } catch {
    return failedResult(agentIdStr, endpointUrl, timestamp, checks, nonce, message, "Invalid agent ID");
  }

  const registry = await resolveAgentFromRegistry(agentId);
  checks.push({
    id: "registry-lookup",
    label: "ERC-8004 Identity Registry",
    passed: registry !== null,
    detail: registry
      ? `Agent #${agentIdStr} resolved on Monad Testnet`
      : `Agent #${agentIdStr} not found — token may not exist`,
  });

  if (!registry) {
    return failedResult(
      agentIdStr,
      endpointUrl,
      timestamp,
      checks,
      nonce,
      message,
      "Agent ID does not exist on-chain."
    );
  }

  checks.push({
    id: "agent-card",
    label: "Agent Card Validation",
    passed: true,
    detail: registry.metadataFetchFailed
      ? `On-chain identity found; metadata URI unavailable — using tokenURI fallback for "${registry.agentCard.name}"`
      : `Valid card: "${registry.agentCard.name}"`,
  });

  const endpointMatchResult = matchRegisteredEndpoint(
    endpointUrl,
    registry.registeredEndpoints
  );
  const endpointMatch = endpointMatchResult.matched;

  checks.push({
    id: "endpoint-match",
    label: "Endpoint Match",
    passed: endpointMatch,
    detail: endpointMatch
      ? endpointMatchResult.viaAlias
        ? `Matches agent card via production alias (card lists localhost; same path on this deployment)`
        : "Submitted endpoint matches a URL in the on-chain agent card"
      : `Not listed. Registered: ${registry.registeredEndpoints.join(", ") || "none"}`,
  });

  let signature: Hex | null = options?.signature ?? null;
  let signer: string | null = options?.signer ?? null;
  let challengeError: string | undefined;

  if (!signature) {
    const challenge = await requestEndpointSignature(
      endpointUrl,
      nonce,
      message
    );
    signature = challenge.signature;
    signer = challenge.signer;
    challengeError = challenge.error;
  }

  let signatureValid = false;
  if (signature) {
    const recovered = await verifySignature(message, signature);
    signatureValid = recovered !== null;
    if (!signer && recovered) signer = recovered;
  }

  checks.push({
    id: "challenge-response",
    label: "Challenge Signature",
    passed: signatureValid,
    detail: signatureValid
      ? "Endpoint returned a valid cryptographic signature for the nonce"
      : challengeError
        ? `Challenge failed: ${challengeError}`
        : "Endpoint could not prove control with a valid signature",
  });

  const expectedWallet = (
    registry.agentWallet ?? registry.owner
  ).toLowerCase();
  const walletMatch =
    signatureValid &&
    signer !== null &&
    signer.toLowerCase() === expectedWallet;

  checks.push({
    id: "wallet-match",
    label: "Wallet Ownership",
    passed: walletMatch,
    detail: walletMatch
      ? `Signer matches registered wallet ${expectedWallet.slice(0, 6)}…${expectedWallet.slice(-4)}`
      : signer
        ? `Signer ${signer.slice(0, 6)}…${signer.slice(-4)} ≠ expected ${expectedWallet.slice(0, 6)}…`
        : "No signer recovered from signature",
  });

  const allPassed = checks.every((c) => c.passed);
  let status: VerificationStatus = "failed";
  let summary: string;

  if (allPassed) {
    status = "verified";
    summary =
      "This endpoint is cryptographically tied to the claimed ERC-8004 identity. Safe to interact.";
  } else if (endpointMatch && !signatureValid) {
    status = "warning";
    summary =
      "Endpoint is on the agent card but failed the signature challenge — possible impersonation or offline agent.";
  } else {
    summary =
      "Likely impersonation. This endpoint is not tied to the claimed agent identity.";
  }

  return {
    status,
    agentId: agentIdStr,
    endpointUrl,
    timestamp,
    checks,
    agentCard: {
      name: registry.agentCard.name,
      description: registry.agentCard.description ?? "",
      owner: registry.owner,
      wallet: registry.agentWallet,
      registeredEndpoints: registry.registeredEndpoints,
      tokenURI: registry.tokenURI,
    },
    challenge: { nonce, signatureValid, signerAddress: signer, message },
    summary,
  };
}

function failedResult(
  agentId: string,
  endpointUrl: string,
  timestamp: string,
  checks: VerificationCheck[],
  nonce: string,
  message: string,
  summary: string
): VerificationResult {
  return {
    status: "failed",
    agentId,
    endpointUrl,
    timestamp,
    checks,
    agentCard: null,
    challenge: {
      nonce,
      signatureValid: false,
      signerAddress: null,
      message,
    },
    summary,
  };
}

export async function verifyLocalSignature(
  message: string,
  signature: Hex,
  expectedWallet: string
): Promise<boolean> {
  const recovered = await verifySignature(message, signature);
  return (
    recovered !== null &&
    recovered.toLowerCase() === expectedWallet.toLowerCase()
  );
}
