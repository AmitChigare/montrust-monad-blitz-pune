import { z } from "zod";

const serviceSchema = z.object({
  name: z.string(),
  endpoint: z.string().min(1),
  version: z.string().optional(),
  capabilities: z.array(z.unknown()).optional(),
});

const legacyEndpointSchema = z
  .object({
    type: z.string().optional(),
    url: z.string().optional(),
    endpoint: z.string().optional(),
    protocol: z.string().optional(),
  })
  .refine((e) => Boolean(e.url || e.endpoint), {
    message: "legacy endpoint requires url or endpoint",
  });

export const agentCardSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    image: z.string().optional(),
    services: z.array(serviceSchema).optional(),
    endpoints: z.array(legacyEndpointSchema).optional(),
    x402Support: z.boolean().optional(),
    active: z.boolean().optional(),
    registrations: z
      .array(
        z.object({
          agentId: z.union([z.number(), z.string()]),
          agentRegistry: z.string(),
        })
      )
      .optional(),
    supportedTrust: z.array(z.string()).optional(),
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  })
  .passthrough();

export type AgentCard = z.infer<typeof agentCardSchema>;

export function extractEndpoints(card: AgentCard): string[] {
  const urls: string[] = [];

  if (card.services) {
    for (const s of card.services) {
      if (s.endpoint.startsWith("http")) urls.push(normalizeUrl(s.endpoint));
    }
  }

  if (card.endpoints) {
    for (const e of card.endpoints) {
      const url = "url" in e && e.url ? e.url : (e as { endpoint?: string }).endpoint;
      if (url?.startsWith("http")) urls.push(normalizeUrl(url));
    }
  }

  return [...new Set(urls)];
}

export function extractAgentWallet(card: AgentCard): string | null {
  if (card.walletAddress) return card.walletAddress;

  const walletService = card.services?.find(
    (s) => s.name.toLowerCase() === "agentwallet"
  );
  if (!walletService?.endpoint) return null;

  const match = walletService.endpoint.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return u.origin + u.pathname.replace(/\/$/, "") || u.origin;
  } catch {
    return url.trim().replace(/\/$/, "");
  }
}

export function endpointsMatch(claimed: string, registered: string): boolean {
  const a = normalizeUrl(claimed);
  const b = normalizeUrl(registered);
  if (a === b) return true;
  try {
    const ua = new URL(claimed);
    const ub = new URL(registered);
    return ua.hostname === ub.hostname && ua.pathname === ub.pathname;
  } catch {
    return false;
  }
}
