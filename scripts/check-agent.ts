import { createPublicClient, http } from "viem";
import { ERC8004, MONAD_TESTNET } from "../src/lib/constants";
import { identityRegistryAbi } from "../src/abi/identityRegistry";
import { resolveAgentFromRegistry, fetchAgentCard } from "../src/lib/erc8004";

const client = createPublicClient({
  transport: http(MONAD_TESTNET.rpcUrl),
});

async function main() {
  for (const id of process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["1790", "1791", "1786"]) {
    const agentId = BigInt(id);
    try {
      const uri = await client.readContract({
        address: ERC8004.identityRegistry,
        abi: identityRegistryAbi,
        functionName: "tokenURI",
        args: [agentId],
      });
      console.log(`\n#${id} tokenURI:`, uri);
      const card = await fetchAgentCard(uri);
      console.log("  card parsed:", card ? card.name : "FAILED");
      const resolved = await resolveAgentFromRegistry(agentId);
      console.log("  resolved:", resolved ? resolved.agentCard.name : "NULL");
      if (resolved) {
        console.log("  endpoints:", resolved.registeredEndpoints);
      }
    } catch (e) {
      console.log(`#${id} error:`, e instanceof Error ? e.message : e);
    }
  }
}

main();
