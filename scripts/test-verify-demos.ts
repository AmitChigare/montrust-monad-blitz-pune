import { verifyAgentEndpoint } from "../src/lib/verification";

async function main() {
  const cases = [
    ["1786", "https://montrust-monad-blitz-pune.vercel.app/api/agent/challenge"],
    ["1790", "https://crosscheck.io/metadata/reviewer.json"],
    ["1791", "https://crosscheck.io/metadata/worker-pool.json"],
    ["1", "https://monad-demo-agent.example.com/mcp"],
  ] as const;

  for (const [id, url] of cases) {
    const r = await verifyAgentEndpoint(id, url);
    console.log(`#${id} -> ${r.status} | ${r.summary.slice(0, 90)}`);
  }
}

main().catch(console.error);
