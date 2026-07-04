import { config } from "dotenv";
config({ path: ".env.local" });
import {
  createPublicClient,
  createWalletClient,
  http,
  decodeErrorResult,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC8004, MONAD_TESTNET } from "../src/lib/constants";
import { identityRegistryAbi } from "../src/abi/identityRegistry";
import { buildRegistrationUri, estimateRegisterGas } from "../src/lib/registerAgent";

const chain = {
  id: MONAD_TESTNET.chainId,
  name: MONAD_TESTNET.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [MONAD_TESTNET.rpcUrl] } },
} as const;

async function tryRegister(baseUrl: string, dryRun: boolean) {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key?.startsWith("0x")) throw new Error("no DEPLOYER_PRIVATE_KEY");
  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(),
  });

  const uri = buildRegistrationUri(baseUrl, account.address);

  console.log(`\n=== ${baseUrl} ===`);
  console.log("URI length:", uri.length);

  try {
    const gas = await estimateRegisterGas(publicClient, uri, account.address);
    console.log("Gas limit:", gas.toString());
  } catch (e: unknown) {
    const err = e as { shortMessage?: string; cause?: { data?: `0x${string}` } };
    console.log("Estimate FAILED:", err.shortMessage ?? e);
    if (err.cause?.data) {
      try {
        const decoded = decodeErrorResult({
          abi: identityRegistryAbi,
          data: err.cause.data,
        });
        console.log("Revert:", decoded.errorName, decoded.args);
      } catch {
        console.log("Revert data:", err.cause.data);
      }
    }
    return;
  }

  if (dryRun) return;

  const gas = await estimateRegisterGas(publicClient, uri, account.address);
  const hash = await walletClient.writeContract({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [uri],
    gas,
  });
  console.log("Tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Status:", receipt.status, "gasUsed:", receipt.gasUsed.toString());
}

async function main() {
  const dryRun = !process.argv.includes("--send");
  await tryRegister("http://localhost:3000", dryRun);
  await tryRegister("https://montrust-monad-blitz-pune.vercel.app", dryRun);
}

main().catch(console.error);
