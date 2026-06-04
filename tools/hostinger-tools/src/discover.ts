import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_API_BASE_URL = "https://developers.hostinger.com";

type Args = {
  domainFilter: string | null;
  outPath: string;
};

type HostingerWebsite = {
  domain?: string;
  username?: string;
  type?: string;
  status?: string;
  root_dir?: string;
  directory?: string;
  [key: string]: unknown;
};

function parseArgs(argv: string[]): Args {
  const domainIndex = argv.indexOf("--domain");
  const outIndex = argv.indexOf("--out");

  return {
    domainFilter: domainIndex !== -1 && argv[domainIndex + 1] ? argv[domainIndex + 1]! : null,
    outPath:
      outIndex !== -1 && argv[outIndex + 1]
        ? argv[outIndex + 1]!
        : "tmp/hostinger-discovery.json"
  };
}

async function requestHostinger<T>(token: string, endpoint: string): Promise<T> {
  const baseUrl = process.env.HOSTINGER_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Hostinger ${endpoint} failed: HTTP ${response.status} ${body.slice(0, 500)}`);
  }

  return JSON.parse(body) as T;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.HOSTINGER_API_TOKEN;

  if (!token) {
    throw new Error("Set HOSTINGER_API_TOKEN in the environment before running this command.");
  }

  const websitesResponse = await requestHostinger<unknown>(token, "/api/hosting/v1/websites");
  const websites = normalizeCollection<HostingerWebsite>(websitesResponse);
  const matchedWebsites = args.domainFilter
    ? websites.filter((website) => String(website.domain ?? "").includes(args.domainFilter!))
    : websites;

  const subdomains: Record<string, unknown> = {};
  const optionalDiscovery: Record<string, unknown> = {};

  for (const website of matchedWebsites) {
    if (!website.username || !website.domain) {
      continue;
    }

    const endpoint = `/api/hosting/v1/accounts/${encodeURIComponent(
      website.username
    )}/websites/${encodeURIComponent(website.domain)}/subdomains`;

    try {
      subdomains[String(website.domain)] = await requestHostinger<unknown>(token, endpoint);
    } catch (error) {
      subdomains[String(website.domain)] = {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  for (const [name, endpoint] of Object.entries({
    domains: "/api/domains/v1/portfolio",
    vps: "/api/vps/v1/virtual-machines"
  })) {
    try {
      optionalDiscovery[name] = await requestHostinger<unknown>(token, endpoint);
    } catch (error) {
      optionalDiscovery[name] = {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    domainFilter: args.domainFilter,
    websites: matchedWebsites,
    subdomains,
    optionalDiscovery,
    nextSteps: [
      "If capacita subdomain/root directory is visible, use SFTP/SSH or hPanel backup for files and SQL.",
      "If VPS resources are visible, determine whether WordPress runs there and use VPS backups/SSH.",
      "The public Hostinger OpenAPI does not expose hosting-shared SQL dump or wp-content download endpoints.",
      "Do not commit this output if it includes account identifiers."
    ]
  };

  await mkdir(path.dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote Hostinger discovery to ${args.outPath}`);
  console.log(`Websites matched: ${matchedWebsites.length}`);
}

function normalizeCollection<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    for (const key of ["data", "items", "websites", "result"]) {
      const candidate = objectValue[key];
      if (Array.isArray(candidate)) {
        return candidate as T[];
      }
    }
  }

  return [];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
