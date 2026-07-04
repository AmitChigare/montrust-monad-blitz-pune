import { publicClient } from "./chain";
import { ERC8004 } from "./constants";
import { identityRegistryAbi } from "@/abi/identityRegistry";
import {
  agentCardSchema,
  extractAgentWallet,
  extractEndpoints,
  normalizeUrl,
  type AgentCard,
} from "@/schemas/agentCard";

export interface RegistryAgent {
  agentId: bigint;
  owner: `0x${string}`;
  tokenURI: string;
  agentCard: AgentCard;
  registeredEndpoints: string[];
  agentWallet: string | null;
  metadataFetchFailed: boolean;
}

function coerceAgentCard(raw: unknown, agentId: bigint, tokenURI: string): AgentCard | null {
  if (!raw || typeof raw !== "object") return null;

  const parsed = agentCardSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const obj = raw as Record<string, unknown>;
  const name =
    typeof obj.name === "string" && obj.name.trim()
      ? obj.name
      : `Agent #${agentId.toString()}`;

  const servicesRaw = obj.services ?? obj.endpoints;
  const services = Array.isArray(servicesRaw)
    ? servicesRaw
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const s = entry as Record<string, unknown>;
          const endpoint =
            typeof s.endpoint === "string"
              ? s.endpoint
              : typeof s.url === "string"
                ? s.url
                : null;
          if (!endpoint?.startsWith("http")) return null;
          return {
            name: typeof s.name === "string" ? s.name : "service",
            endpoint,
            version: typeof s.version === "string" ? s.version : undefined,
          };
        })
        .filter(Boolean)
    : [];

  const wallet =
    typeof obj.walletAddress === "string"
      ? obj.walletAddress
      : typeof obj.agentWallet === "string"
        ? obj.agentWallet
        : undefined;

  const fallback = {
    type:
      typeof obj.type === "string"
        ? obj.type
        : "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description:
      typeof obj.description === "string"
        ? obj.description
        : tokenURI.startsWith("http")
          ? `ERC-8004 agent metadata at ${tokenURI}`
          : undefined,
    image: typeof obj.image === "string" ? obj.image : undefined,
    services: services.length > 0 ? services : undefined,
    walletAddress: wallet?.match(/^0x[a-fA-F0-9]{40}$/) ? wallet : undefined,
    active: obj.active !== false,
    x402Support:
      obj.x402Support === true ||
      obj.x402_support === true ||
      obj.x402Supported === true,
  };

  const retry = agentCardSchema.safeParse(fallback);
  return retry.success ? retry.data : null;
}

function buildFallbackAgentCard(
  agentId: bigint,
  tokenURI: string,
  owner: `0x${string}`
): AgentCard {
  const services =
    tokenURI.startsWith("http") || tokenURI.startsWith("https")
      ? [{ name: "metadata", endpoint: tokenURI }]
      : undefined;

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Agent #${agentId.toString()}`,
    description:
      tokenURI.startsWith("http")
        ? `ERC-8004 agent on Monad Testnet. On-chain metadata URI: ${tokenURI}`
        : "ERC-8004 agent on Monad Testnet.",
    services,
    active: true,
    walletAddress: owner,
  };
}

export async function resolveAgentFromRegistry(
  agentId: bigint
): Promise<RegistryAgent | null> {
  let owner: `0x${string}`;
  let tokenURI: string;

  try {
    [owner, tokenURI] = await Promise.all([
      publicClient.readContract({
        address: ERC8004.identityRegistry,
        abi: identityRegistryAbi,
        functionName: "ownerOf",
        args: [agentId],
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: ERC8004.identityRegistry,
        abi: identityRegistryAbi,
        functionName: "tokenURI",
        args: [agentId],
      }),
    ]);
  } catch {
    return null;
  }

  let metadataFetchFailed = false;
  let agentCard: AgentCard | null = null;

  try {
    const raw = await resolveUriToJson(tokenURI);
    agentCard = coerceAgentCard(raw, agentId, tokenURI);
  } catch {
    metadataFetchFailed = true;
  }

  if (!agentCard) {
    metadataFetchFailed = true;
    agentCard = buildFallbackAgentCard(agentId, tokenURI, owner);
  }

  const registeredEndpoints = extractEndpoints(agentCard);
  if (
    (tokenURI.startsWith("http://") || tokenURI.startsWith("https://")) &&
    !registeredEndpoints.some((ep) => normalizeUrl(ep) === normalizeUrl(tokenURI))
  ) {
    registeredEndpoints.push(normalizeUrl(tokenURI));
  }

  return {
    agentId,
    owner,
    tokenURI,
    agentCard,
    registeredEndpoints,
    agentWallet: extractAgentWallet(agentCard) ?? owner,
    metadataFetchFailed,
  };
}

export async function fetchAgentCard(uri: string): Promise<AgentCard | null> {
  try {
    const json = await resolveUriToJson(uri);
    return coerceAgentCard(json, 0n, uri);
  } catch {
    return null;
  }
}

async function resolveUriToJson(uri: string): Promise<unknown> {
  if (uri.startsWith("data:")) {
    const comma = uri.indexOf(",");
    const header = uri.slice(0, comma);
    const payload = uri.slice(comma + 1);
    if (header.includes("base64")) {
      return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    }
    return JSON.parse(decodeURIComponent(payload));
  }

  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    const res = await fetch(`https://ipfs.io/ipfs/${cid}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error("IPFS fetch failed");
    return res.json();
  }

  const res = await fetch(uri, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function buildAgentRegistrationUri(
  card: AgentCard,
  _baseUrl: string
): string {
  const registration = {
    ...card,
    registrations: [
      {
        agentId: "PENDING",
        agentRegistry: `eip155:10143:${ERC8004.identityRegistry}`,
      },
    ],
  };
  const json = JSON.stringify(registration);
  const b64 = Buffer.from(json, "utf8").toString("base64");
  return `data:application/json;base64,${b64}`;
}

export function buildMonTrustAgentCard(
  baseUrl: string,
  walletAddress: string
): AgentCard {
  const origin = baseUrl.replace(/\/$/, "");
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "TrustLens Photo Proof Agent",
    description:
      "Vision agent that inspects facility photos and anchors cryptographic proof hashes on Monad.",
    image: `${origin}/montrust-icon.svg`,
    services: [
      {
        name: "MCP",
        endpoint: `${origin}/api/agent/challenge`,
        version: "2025-06-18",
      },
      {
        name: "trust-report",
        endpoint: `${origin}/api/trust-report`,
        version: "1.0.0",
      },
      {
        name: "x402-trust-report",
        endpoint: `${origin}/api/x402/trust-report`,
        version: "1.0.0",
      },
      {
        name: "agentWallet",
        endpoint: `eip155:10143:${walletAddress}`,
      },
      {
        name: "web",
        endpoint: `${origin}/photo-proof`,
      },
    ],
    active: true,
    supportedTrust: ["reputation", "crypto-economic"],
    x402Support: true,
    walletAddress: walletAddress as `0x${string}`,
  };
}
