import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readDumpStatements, splitSqlValues } from "./sql-dump.js";

type Args = {
  dumpPath: string;
  outPath: string;
};

type ExportedUser = {
  sourceSystem: "wordpress";
  sourceId: string;
  login: string;
  email: string;
  displayName: string;
  registeredAt: string | null;
  status: "ACTIVE" | "DISABLED";
  serviceLabel: string | null;
  legacyPasswordHash: string;
  legacyPasswordAlgo: string;
  wordpressRoles: string[];
  mappedRoles: Array<"ADMIN" | "TEACHER" | "STUDENT">;
};

type UserMeta = {
  capabilities: string[];
  serviceLabel: string | null;
};

function parseArgs(argv: string[]): Args {
  const dumpIndex = argv.indexOf("--dump");
  const outIndex = argv.indexOf("--out");

  if (dumpIndex === -1 || !argv[dumpIndex + 1]) {
    throw new Error("Missing --dump C:\\path\\to\\wordpress.sql");
  }

  const dumpPath = argv[dumpIndex + 1]!;
  const outPath = outIndex !== -1 && argv[outIndex + 1] ? argv[outIndex + 1]! : "tmp/wp-users.json";

  return {
    dumpPath,
    outPath
  };
}

function detectPasswordAlgo(hash: string) {
  if (hash.startsWith("$wp")) {
    return "wordpress-bcrypt";
  }

  if (hash.startsWith("$P$") || hash.startsWith("$H$")) {
    return "phpass";
  }

  if (/^[a-f0-9]{32}$/i.test(hash)) {
    return "md5";
  }

  if (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")) {
    return "bcrypt";
  }

  return "unsupported";
}

function extractSerializedRoles(value: string) {
  const roles = new Set<string>();
  const matches = value.replaceAll('\\"', '"').matchAll(/s:\d+:"([^"]+)";b:1/g);

  for (const match of matches) {
    if (match[1]) {
      roles.add(match[1]);
    }
  }

  return Array.from(roles).sort();
}

function mapRoles(wordpressRoles: string[]): Array<"ADMIN" | "TEACHER" | "STUDENT"> {
  const mapped = new Set<"ADMIN" | "TEACHER" | "STUDENT">();
  const lowered = wordpressRoles.map((role) => role.toLowerCase());

  if (lowered.some((role) => role.includes("administrator") || role === "admin")) {
    mapped.add("ADMIN");
  }

  if (
    lowered.some((role) =>
      ["teacher", "instructor", "lp_teacher", "tutor_instructor", "wdm_instructor"].includes(role)
    )
  ) {
    mapped.add("TEACHER");
  }

  if (mapped.size === 0 || lowered.some((role) => role.includes("student") || role === "subscriber")) {
    mapped.add("STUDENT");
  }

  return Array.from(mapped);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const users = new Map<string, ExportedUser>();
  const userMeta = new Map<string, UserMeta>();

  for await (const statement of readDumpStatements(args.dumpPath)) {
    if (statement.type !== "insert") {
      continue;
    }

    if (statement.table.endsWith("_users")) {
      for (const row of statement.rows) {
        const values = splitSqlValues(row);
        const id = values[0];
        const login = values[1];
        const legacyPasswordHash = values[2];
        const email = values[4];
        const registeredAt = values[6] || null;
        const numericStatus = Number(values[8] ?? 0);
        const displayName = values[9] || login || email;

        if (!id || !email || !legacyPasswordHash) {
          continue;
        }

        const userId = id;
        const userEmail = email.toLowerCase();
        const userLogin = login || userEmail;
        const userDisplayName = displayName || userLogin;
        const userLegacyPasswordHash = legacyPasswordHash;

        users.set(userId, {
          sourceSystem: "wordpress",
          sourceId: userId,
          login: userLogin,
          email: userEmail,
          displayName: userDisplayName,
          registeredAt,
          status: numericStatus === 0 ? "ACTIVE" : "DISABLED",
          serviceLabel: null,
          legacyPasswordHash: userLegacyPasswordHash,
          legacyPasswordAlgo: detectPasswordAlgo(userLegacyPasswordHash),
          wordpressRoles: [],
          mappedRoles: ["STUDENT"]
        });
      }
    }

    if (statement.table.endsWith("_usermeta")) {
      for (const row of statement.rows) {
        const values = splitSqlValues(row);
        const userId = values[1];
        const metaKey = values[2] ?? "";
        const metaValue = values[3] ?? "";

        if (!userId) {
          continue;
        }

        const existing = userMeta.get(userId) ?? { capabilities: [], serviceLabel: null };

        if (metaKey.endsWith("_capabilities")) {
          existing.capabilities = Array.from(
            new Set([...existing.capabilities, ...extractSerializedRoles(metaValue)])
          ).sort();
        }

        if (metaKey === "empresa_servicio") {
          existing.serviceLabel = metaValue || null;
        }

        userMeta.set(userId, existing);
      }
    }
  }

  const exportedUsers = Array.from(users.values()).map((user) => {
    const meta = userMeta.get(user.sourceId);
    const wordpressRoles = meta?.capabilities ?? [];
    return {
      ...user,
      serviceLabel: meta?.serviceLabel ?? null,
      wordpressRoles,
      mappedRoles: mapRoles(wordpressRoles)
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDump: args.dumpPath,
    containsSensitivePasswordHashes: true,
    users: exportedUsers,
    summary: {
      totalUsers: exportedUsers.length,
      byLegacyPasswordAlgo: countBy(exportedUsers, (user) => user.legacyPasswordAlgo),
      byMappedRole: countRoles(exportedUsers)
    }
  };

  await mkdir(path.dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Wrote WordPress users export to ${args.outPath}`);
  console.log("The output contains password hashes. Keep it out of git and public chats.");
  console.log(`Users: ${exportedUsers.length}`);
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function countRoles(users: ExportedUser[]) {
  const counts: Record<string, number> = {};
  for (const user of users) {
    for (const role of user.mappedRoles) {
      counts[role] = (counts[role] ?? 0) + 1;
    }
  }
  return counts;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
