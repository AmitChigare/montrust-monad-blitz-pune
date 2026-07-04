import { DEMO_AGENT, DEPLOYED } from "./constants";

export const CROSSCHECK_AGENTS = {
  reviewer: {
    id: "1790",
    metadataUrl: "https://crosscheck.io/metadata/reviewer.json",
    owner: "0xca4ce2169d4ffee7c2560a136df4cc9792eebd74",
  },
  workerPool: {
    id: "1791",
    metadataUrl: "https://crosscheck.io/metadata/worker-pool.json",
    owner: "0xca4ce2169d4ffee7c2560a136df4cc9792eebd74",
  },
} as const;

export type DemoExpectedStatus = "verified" | "warning" | "failed";

export interface VerifyDemoPreset {
  id: string;
  label: string;
  agentId: string;
  /** Static endpoint, or "origin" to use current site + pathSuffix */
  endpoint: string | { kind: "origin"; path: string };
  expectedStatus: DemoExpectedStatus;
  description: string;
  scanUrl: string;
}

export const VERIFY_DEMO_PRESETS: VerifyDemoPreset[] = [
  {
    id: "montrust-verified",
    label: "MonTrust #1786 · Verified",
    agentId: DEPLOYED.agentId,
    endpoint: { kind: "origin", path: "/api/agent/challenge" },
    expectedStatus: "verified",
    description:
      "Your ERC-8004 agent with live challenge signing on this deployment.",
    scanUrl: `https://8004scan.io/api/v1/public/agents/10143/${DEPLOYED.agentId}`,
  },
  {
    id: "monad-demo-warning",
    label: "Monad Demo #1 · Warning",
    agentId: DEMO_AGENT.id,
    endpoint: DEMO_AGENT.mcpEndpoint,
    expectedStatus: "warning",
    description:
      "Official Monad testnet demo agent — on-chain identity exists but MCP host is offline.",
    scanUrl: "https://8004scan.io/api/v1/public/agents/10143/1",
  },
  {
    id: "monad-demo-a2a",
    label: "Monad Demo #1 · A2A card",
    agentId: DEMO_AGENT.id,
    endpoint: "https://monad-demo-agent.example.com/.well-known/agent-card.json",
    expectedStatus: "warning",
    description:
      "Same agent — A2A endpoint from the on-chain card (also offline).",
    scanUrl: "https://8004scan.io/api/v1/public/agents/10143/1",
  },
  {
    id: "crosscheck-1790",
    label: "CrossCheck #1790 · x402",
    agentId: CROSSCHECK_AGENTS.reviewer.id,
    endpoint: CROSSCHECK_AGENTS.reviewer.metadataUrl,
    expectedStatus: "warning",
    description:
      "Fresh Monad testnet agent with x402 — metadata URI on-chain (crosscheck.io/reviewer). Host offline; registry + URI match still work.",
    scanUrl: `https://8004scan.io/api/v1/public/agents/10143/${CROSSCHECK_AGENTS.reviewer.id}`,
  },
  {
    id: "crosscheck-1791",
    label: "CrossCheck #1791 · x402",
    agentId: CROSSCHECK_AGENTS.workerPool.id,
    endpoint: CROSSCHECK_AGENTS.workerPool.metadataUrl,
    expectedStatus: "warning",
    description:
      "Fresh Monad testnet agent with x402 — worker-pool metadata on-chain. Same wallet as #1790.",
    scanUrl: `https://8004scan.io/api/v1/public/agents/10143/${CROSSCHECK_AGENTS.workerPool.id}`,
  },
  {
    id: "monowire-alpha",
    label: "Monowire Alpha #1777 · Warning",
    agentId: "1777",
    endpoint: "https://monowire-blitz.vercel.app",
    expectedStatus: "warning",
    description:
      "Monowire prediction agent — web endpoint on card but no MCP challenge server.",
    scanUrl: "https://8004scan.io/api/v1/public/agents/10143/1777",
  },
  {
    id: "impersonator",
    label: "Impersonator · Failed",
    agentId: DEPLOYED.agentId,
    endpoint: "https://fake-impersonator.evil.test/mcp",
    expectedStatus: "failed",
    description:
      "Endpoint not listed on the agent card — spoof detection demo.",
    scanUrl: `https://8004scan.io/api/v1/public/agents/10143/${DEPLOYED.agentId}`,
  },
];

export function resolvePresetEndpoint(
  preset: VerifyDemoPreset,
  origin: string
): string {
  if (typeof preset.endpoint === "string") return preset.endpoint;
  const base = origin.replace(/\/$/, "");
  return `${base}${preset.endpoint.path}`;
}
