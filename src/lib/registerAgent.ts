import type { PublicClient, Address } from "viem";
import { ERC8004 } from "./constants";
import { identityRegistryAbi } from "@/abi/identityRegistry";
import { buildMonTrustAgentCard } from "./erc8004";
import { buildDataUriJsonBase64 } from "./base64Json";

/** ERC-8004 register() on Monad needs ~1.4M–2.1M gas depending on URI length. */
export const REGISTER_GAS_FLOOR = 2_100_000n;

const PRODUCTION_ORIGIN =
  process.env.NEXT_PUBLIC_MONTRUST_BASE_URL ??
  "https://montrust-monad-blitz-pune.vercel.app";

export function resolveAppOrigin(clientOrigin?: string): string {
  if (clientOrigin?.startsWith("http")) return clientOrigin.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location.origin.startsWith("http")) {
    return window.location.origin;
  }
  return PRODUCTION_ORIGIN.replace(/\/$/, "");
}

export function buildRegistrationUri(origin: string, walletAddress: string): string {
  const card = buildMonTrustAgentCard(origin, walletAddress);
  return buildDataUriJsonBase64({
    ...card,
    registrations: [
      {
        agentId: "PENDING",
        agentRegistry: `eip155:10143:${ERC8004.identityRegistry}`,
      },
    ],
  });
}

export async function estimateRegisterGas(
  publicClient: PublicClient,
  uri: string,
  account: Address
): Promise<bigint> {
  const estimated = await publicClient.estimateContractGas({
    address: ERC8004.identityRegistry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [uri],
    account,
  });
  const buffered = (estimated * 150n) / 100n;
  const padded = estimated + 700_000n;
  const gas = buffered > padded ? buffered : padded;
  return gas > REGISTER_GAS_FLOOR ? gas : REGISTER_GAS_FLOOR;
}

export function formatRegisterGasHint(gas: bigint): string {
  return `~${(Number(gas) / 1_000_000).toFixed(2)}M gas (Monad bills gas limit)`;
}
