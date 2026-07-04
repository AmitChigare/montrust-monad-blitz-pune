import { normalizeUrl } from "@/schemas/agentCard";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/** Known MonTrust deployments — cards often register localhost before Vercel deploy. */
export function getKnownDeploymentOrigins(): string[] {
  const origins = new Set<string>();

  for (const raw of [
    process.env.MONTRUST_BASE_URL,
    process.env.TRUSTLENS_BASE_URL,
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : null,
    "https://montrust-monad-blitz-pune.vercel.app",
  ]) {
    if (!raw?.startsWith("http")) continue;
    try {
      origins.add(new URL(raw).origin);
    } catch {
      /* skip */
    }
  }

  return [...origins];
}

export function expandRegisteredEndpointAliases(
  registeredEndpoints: string[]
): string[] {
  const expanded = new Set(registeredEndpoints.map(normalizeUrl));
  const deploymentOrigins = getKnownDeploymentOrigins();

  for (const endpoint of registeredEndpoints) {
    try {
      const parsed = new URL(endpoint);
      if (!LOCAL_HOSTS.has(parsed.hostname)) continue;

      const path = parsed.pathname.replace(/\/$/, "") || "";
      for (const origin of deploymentOrigins) {
        expanded.add(normalizeUrl(`${origin}${path}`));
      }
    } catch {
      /* skip */
    }
  }

  return [...expanded];
}

export interface EndpointMatchResult {
  matched: boolean;
  matchedEndpoint?: string;
  viaAlias: boolean;
}

/**
 * Match claimed URL against on-chain card endpoints.
 * Allows localhost → production alias when pathname matches (common on testnet).
 */
export function matchRegisteredEndpoint(
  claimed: string,
  registeredEndpoints: string[]
): EndpointMatchResult {
  const candidates = [
    ...registeredEndpoints,
    ...expandRegisteredEndpointAliases(registeredEndpoints),
  ];

  for (const registered of candidates) {
    if (normalizeUrl(claimed) === normalizeUrl(registered)) {
      const viaAlias = !registeredEndpoints.some(
        (ep) => normalizeUrl(ep) === normalizeUrl(registered)
      );
      return { matched: true, matchedEndpoint: registered, viaAlias };
    }
  }

  try {
    const claimedUrl = new URL(claimed);
    const claimedPath = claimedUrl.pathname.replace(/\/$/, "") || "/";

    for (const registered of registeredEndpoints) {
      const registeredUrl = new URL(registered);
      if (!LOCAL_HOSTS.has(registeredUrl.hostname)) continue;

      const registeredPath =
        registeredUrl.pathname.replace(/\/$/, "") || "/";
      if (claimedPath === registeredPath && claimedPath !== "/") {
        return {
          matched: true,
          matchedEndpoint: registered,
          viaAlias: true,
        };
      }
    }
  } catch {
    /* invalid URL */
  }

  return { matched: false, viaAlias: false };
}
