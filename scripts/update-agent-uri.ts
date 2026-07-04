/**
 * Update on-chain agent card URI for an existing ERC-8004 token.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... MONTRUST_BASE_URL=https://your-app.vercel.app \
 *     npm run update:agent-uri -- 1786
 */
import "dotenv/config";
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC8004, MONAD_TESTNET } from "../src/lib/constants";
import { identityRegistryAbi } from "../src/abi/identityRegistry";
import { buildMonTrustAgentCard } from "../src/lib/erc8004";

config({ path: ".env.local" });

const monadTestnet = {
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
} as const;

const BASE_URL =
  process.env.MONTRUST_BASE_URL ??
  process.env.TRUSTLENS_BASE_URL ??
  "https://montrust-monad-blitz-pune.vercel.app";

async function main() {
  const agentIdArg = process.argv[2] ?? "1786";
  const agentId = BigInt(agentIdArg);

  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key?.startsWith("0x")) {
    console.error("Missing DEPLOYER_PRIVATE_KEY in .env.local");
    process.exit(1);
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(MONAD_TESTNET.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(MONAD_TESTNET.rpcUrl),
  });

  const owner = await publicClient.readContract({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [agentId],
  });

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(
      `Wallet ${account.address} is not owner of agent #${agentIdArg} (owner: ${owner})`
    );
    process.exit(1);
  }

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Agent ID:", agentIdArg);
  console.log("Owner:", owner);
  console.log("Base URL:", BASE_URL);
  console.log("Balance:", formatEther(balance), "MON");

  const card = buildMonTrustAgentCard(BASE_URL, account.address);
  const registration = {
    ...card,
    name: "TrustLens Photo Proof Agent",
    description:
      "Vision agent that inspects facility photos and anchors cryptographic proof hashes on Monad.",
    registrations: [
      {
        agentId: Number(agentId),
        agentRegistry: `eip155:10143:${ERC8004.identityRegistry}`,
      },
    ],
  };

  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString("base64")}`;

  console.log("\nUpdating setAgentURI...");
  const gas = await publicClient.estimateContractGas({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "setAgentURI",
    args: [agentId, uri],
    account: account.address,
  });
  const gasLimit = gas > 800_000n ? (gas * 125n) / 100n : 1_000_000n;

  const hash = await walletClient.writeContract({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "setAgentURI",
    args: [agentId, uri],
    gas: gasLimit,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Updated! Tx:", hash);
  console.log("Block:", receipt.blockNumber);
  console.log("MCP endpoint:", `${BASE_URL}/api/agent/challenge`);

  const dataPath = path.join(process.cwd(), "data", "deployments.json");
  try {
    const deployment = JSON.parse(readFileSync(dataPath, "utf8")) as {
      agent?: Record<string, unknown>;
    };
    deployment.agent = {
      ...(deployment.agent ?? {}),
      id: agentIdArg,
      challengeEndpoint: `${BASE_URL}/api/agent/challenge`,
      tokenURI: uri.slice(0, 80) + "...",
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(dataPath, JSON.stringify(deployment, null, 2));
    console.log("Updated data/deployments.json");
  } catch {
    /* optional */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
