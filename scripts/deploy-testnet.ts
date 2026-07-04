/**
 * Deploy MonTrust contracts on Monad Testnet.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npm run deploy:testnet
 *
 * Uses wallet 0xda49... when that key is provided.
 * Deploys ProofAnchor and registers ERC-8004 vision agent.
 */
import "dotenv/config";
import { config } from "dotenv";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import {
  createWalletClient,
  createPublicClient,
  http,
  decodeEventLog,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC8004, MONAD_TESTNET } from "../src/lib/constants";
import { identityRegistryAbi } from "../src/abi/identityRegistry";
import { proofAnchorAbi, proofAnchorBytecode } from "../src/abi/proofAnchor";
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
  "http://localhost:3000";

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key?.startsWith("0x")) {
    console.error(
      "Missing DEPLOYER_PRIVATE_KEY in .env.local (must start with 0x)"
    );
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

  const balance = await publicClient.getBalance({ address: account.address });
  console.log("Deployer:", account.address);
  console.log("Balance:", formatEther(balance), "MON");

  if (balance < BigInt(1e16)) {
    console.error("Insufficient MON. Get testnet MON from faucet.monad.xyz");
    process.exit(1);
  }

  // 1. Deploy ProofAnchor
  console.log("\n[1/2] Deploying ProofAnchor...");
  const deployHash = await walletClient.deployContract({
    abi: proofAnchorAbi,
    bytecode: proofAnchorBytecode,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({
    hash: deployHash,
  });
  const proofAnchorAddress = deployReceipt.contractAddress;
  if (!proofAnchorAddress) {
    throw new Error("ProofAnchor deployment failed — no contract address");
  }
  console.log("ProofAnchor deployed:", proofAnchorAddress);
  console.log("Tx:", deployHash);

  // 2. Register ERC-8004 agent
  console.log("\n[2/2] Registering ERC-8004 agent...");
  const card = buildMonTrustAgentCard(BASE_URL, account.address);
  const registration = {
    ...card,
    registrations: [
      {
        agentId: "PENDING",
        agentRegistry: `eip155:10143:${ERC8004.identityRegistry}`,
      },
    ],
  };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(registration)).toString("base64")}`;

  const gas = await publicClient.estimateContractGas({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [uri],
    account: account.address,
  });
  const gasLimit = gas > 1_800_000n ? (gas * 125n) / 100n : 1_800_000n;

  const registerHash = await walletClient.writeContract({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [uri],
    gas: gasLimit,
  });
  const registerReceipt = await publicClient.waitForTransactionReceipt({
    hash: registerHash,
  });

  let agentId: string | null = null;
  for (const log of registerReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: identityRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "Registered") {
        agentId = (
          decoded.args as { agentId: bigint }
        ).agentId.toString();
      }
    } catch {
      /* skip */
    }
  }

  if (!agentId) {
    throw new Error("Agent registration tx succeeded but Registered event not found");
  }
  console.log("Agent registered! ID:", agentId);
  console.log("Tx:", registerHash);

  const deployment = {
    network: "monad-testnet",
    chainId: MONAD_TESTNET.chainId,
    deployer: account.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      proofAnchor: proofAnchorAddress,
      identityRegistry: ERC8004.identityRegistry,
    },
    agent: {
      id: agentId,
      name: card.name,
      challengeEndpoint: `${BASE_URL}/api/agent/challenge`,
      tokenURI: uri.slice(0, 80) + "...",
    },
    transactions: {
      proofAnchorDeploy: deployHash,
      agentRegister: registerHash,
    },
  };

  const dataDir = path.join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "deployments.json");
  writeFileSync(outPath, JSON.stringify(deployment, null, 2));
  console.log("\nSaved deployment manifest:", outPath);

  // Keep src/lib/constants.ts in sync
  const constantsPath = path.join(process.cwd(), "src", "lib", "constants.ts");
  let constantsSrc = readFileSync(constantsPath, "utf8");
  constantsSrc = constantsSrc.replace(
    /proofAnchor: "0x[a-fA-F0-9]+"/,
    `proofAnchor: "${proofAnchorAddress}"`
  );
  constantsSrc = constantsSrc.replace(
    /agentId: "[^"]+"/,
    `agentId: "${agentId}"`
  );
  constantsSrc = constantsSrc.replace(
    /deployer: "0x[a-fA-F0-9]+"/,
    `deployer: "${account.address}"`
  );
  writeFileSync(constantsPath, constantsSrc);
  console.log("Updated src/lib/constants.ts");

  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
