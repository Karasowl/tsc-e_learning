import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readDumpStatements, splitSqlValues } from "./sql-dump.js";

type AuditReport = {
  generatedAt: string;
  dumpPath: string;
  tables: string[];
  insertRowCounts: Record<string, number>;
  activePlugins: string[];
  postTypes: Record<string, number>;
  postMetaKeys: Record<string, number>;
  userMetaKeys: Record<string, number>;
  commentTypes: Record<string, number>;
  codeSnippets: {
    total: number;
    active: number;
    activeNames: string[];
    signals: Array<{
      id: string;
      name: string;
      active: boolean;
      scope: string;
      keywords: string[];
    }>;
  };
  gamipress: {
    triggerCounts: Record<string, number>;
    userEarningCounts: Record<string, number>;
    configuredStepTriggers: Record<string, string>;
  };
  smtp: {
    debugEventCount: number;
    initiatorPluginCounts: Record<string, number>;
  };
  tutorCustomization: {
    customCssPosts: number;
    dashboardCssPosts: number;
    hidesCommercialOrSocialFeatures: boolean;
    renamesStudentsToCollaborators: boolean;
  };
  lmsSignals: string[];
  nextAccessNeeded: string[];
};

type Args = {
  dumpPath: string;
  outPath: string;
};

function parseArgs(argv: string[]): Args {
  const dumpIndex = argv.indexOf("--dump");
  const outIndex = argv.indexOf("--out");

  if (dumpIndex === -1 || !argv[dumpIndex + 1]) {
    throw new Error("Missing --dump C:\\path\\to\\wordpress.sql");
  }

  const dumpPath = argv[dumpIndex + 1]!;
  const outPath = outIndex !== -1 && argv[outIndex + 1] ? argv[outIndex + 1]! : "tmp/wp-audit.json";

  return {
    dumpPath,
    outPath
  };
}

function increment(map: Record<string, number>, key: string, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function extractActivePlugins(serialized: string): string[] {
  const matches = serialized.match(/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.php/g);
  return Array.from(new Set(matches ?? [])).sort();
}

function topKeys(map: Record<string, number>, limit: number) {
  return Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
  );
}

function toRecord(columns: string[], values: string[]) {
  const record: Record<string, string> = {};
  columns.forEach((column, index) => {
    record[column] = values[index] ?? "";
  });
  return record;
}

function snippetKeywords(code: string) {
  const keywords = ["tutor", "gamipress", "mail", "email", "smtp", "certificate", "pdf", "quiz", "profile", "dashboard"];
  const lower = code.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

function pluginFromInitiator(value: string) {
  const normalized = value.replaceAll("\\/", "/");
  const match = normalized.match(/\/plugins\/([^/\\"]+)/);
  return match?.[1] ?? "unknown";
}

function detectsHiddenTutorFeatures(css: string) {
  const lower = css.toLowerCase();
  return [
    "purchase_history",
    "earning",
    "withdraw",
    "wishlist",
    "question-answer",
    "announcements",
    "quiz-attempts",
    "reviews",
    "share"
  ].some((needle) => lower.includes(needle));
}

function inferSignals(report: AuditReport) {
  const joined = [
    ...report.tables,
    ...Object.keys(report.postTypes),
    ...Object.keys(report.postMetaKeys),
    ...report.activePlugins
  ].join(" ").toLowerCase();

  const signalChecks: Array<[string, string[]]> = [
    ["LearnPress data/plugin detected", ["learnpress", "learn_press", "lp_"]],
    ["Tutor LMS data/plugin detected", ["tutor", "tutor_"]],
    ["LearnDash data/plugin detected", ["learndash", "sfwd-"]],
    ["LifterLMS data/plugin detected", ["lifter", "llms"]],
    ["Certificate-related data detected", ["certificate", "certificado"]],
    ["Quiz-related data detected", ["quiz", "question", "pregunta"]],
    ["WooCommerce-related data detected", ["woocommerce", "shop_order"]],
    ["LoginPress customization detected", ["loginpress"]]
  ];

  for (const [label, needles] of signalChecks) {
    if (needles.some((needle) => joined.includes(needle))) {
      report.lmsSignals.push(label);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    dumpPath: args.dumpPath,
    tables: [],
    insertRowCounts: {},
    activePlugins: [],
    postTypes: {},
    postMetaKeys: {},
    userMetaKeys: {},
    commentTypes: {},
    codeSnippets: {
      total: 0,
      active: 0,
      activeNames: [],
      signals: []
    },
    gamipress: {
      triggerCounts: {},
      userEarningCounts: {},
      configuredStepTriggers: {}
    },
    smtp: {
      debugEventCount: 0,
      initiatorPluginCounts: {}
    },
    tutorCustomization: {
      customCssPosts: 0,
      dashboardCssPosts: 0,
      hidesCommercialOrSocialFeatures: false,
      renamesStudentsToCollaborators: false
    },
    lmsSignals: [],
    nextAccessNeeded: [
      "Authenticated staging screenshots for representative courses.",
      "Current certificate PDF templates and signature assets.",
      "Current pass/fail email recipients and email copy.",
      "Manual list of disabled/commented plugin behaviors that should stay disabled."
    ]
  };

  const tableSet = new Set<string>();
  const pluginSet = new Set<string>();
  const tableColumns = new Map<string, string[]>();
  for await (const statement of readDumpStatements(args.dumpPath)) {
    if (statement.type === "create-table") {
      tableSet.add(statement.table);
      tableColumns.set(statement.table, statement.columns);
      continue;
    }

    const table = statement.table;
    const rows = statement.rows;
    increment(report.insertRowCounts, table, rows.length);
    const columns = statement.columns ?? tableColumns.get(table) ?? [];

    if (table.endsWith("_options")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        const optionName = record.option_name;
        const optionValue = record.option_value ?? "";
        if (optionName === "active_plugins" || optionName === "active_sitewide_plugins") {
          for (const plugin of extractActivePlugins(optionValue)) {
            pluginSet.add(plugin);
          }
        }
      }
    }

    if (table.endsWith("_posts")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        const postType = record.post_type;
        if (postType) {
          increment(report.postTypes, postType);
        }

        if (postType === "custom_css") {
          const content = record.post_content ?? "";
          report.tutorCustomization.customCssPosts += 1;
          if (content.toLowerCase().includes("tutor")) {
            report.tutorCustomization.dashboardCssPosts += 1;
          }
          if (detectsHiddenTutorFeatures(content)) {
            report.tutorCustomization.hidesCommercialOrSocialFeatures = true;
          }
          if (content.includes("Total de Colaboradores")) {
            report.tutorCustomization.renamesStudentsToCollaborators = true;
          }
        }
      }
    }

    if (table.endsWith("_postmeta")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        const metaKey = record.meta_key;
        if (metaKey) {
          increment(report.postMetaKeys, metaKey);
        }

        if (metaKey === "_gamipress_trigger_type" && record.post_id && record.meta_value) {
          report.gamipress.configuredStepTriggers[record.post_id] = record.meta_value;
        }

        if (metaKey === "_uag_custom_page_level_css") {
          const css = record.meta_value ?? "";
          if (css.toLowerCase().includes("tutor")) {
            report.tutorCustomization.dashboardCssPosts += 1;
          }
          if (detectsHiddenTutorFeatures(css)) {
            report.tutorCustomization.hidesCommercialOrSocialFeatures = true;
          }
          if (css.includes("Total de Colaboradores")) {
            report.tutorCustomization.renamesStudentsToCollaborators = true;
          }
        }
      }
    }

    if (table.endsWith("_usermeta")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        const metaKey = record.meta_key;
        if (metaKey) {
          increment(report.userMetaKeys, metaKey);
        }
      }
    }

    if (table.endsWith("_comments")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        increment(report.commentTypes, record.comment_type || "comment");
      }
    }

    if (table.endsWith("_snippets")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        const active = record.active === "1";
        const name = record.name || record.title || `snippet:${record.id ?? ""}`;
        const keywords = snippetKeywords(record.code ?? record.snippet_code ?? "");
        report.codeSnippets.total += 1;
        if (active) {
          report.codeSnippets.active += 1;
          report.codeSnippets.activeNames.push(name);
        }
        report.codeSnippets.signals.push({
          id: record.id ?? record.snippet_id ?? "",
          name,
          active,
          scope: record.scope ?? "",
          keywords
        });
      }
    }

    if (table.endsWith("_gamipress_logs")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        increment(report.gamipress.triggerCounts, record.trigger_type || "unknown");
      }
    }

    if (table.endsWith("_gamipress_user_earnings")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        increment(report.gamipress.userEarningCounts, record.title || "unknown");
      }
    }

    if (table.endsWith("_wpmailsmtp_debug_events")) {
      for (const row of rows) {
        const record = toRecord(columns, splitSqlValues(row));
        report.smtp.debugEventCount += 1;
        increment(report.smtp.initiatorPluginCounts, pluginFromInitiator(record.initiator ?? ""));
      }
    }
  }

  report.tables = Array.from(tableSet).sort();
  report.activePlugins = Array.from(pluginSet).sort();
  report.postTypes = topKeys(report.postTypes, 100);
  report.postMetaKeys = topKeys(report.postMetaKeys, 200);
  report.userMetaKeys = topKeys(report.userMetaKeys, 200);
  report.commentTypes = topKeys(report.commentTypes, 50);
  report.gamipress.triggerCounts = topKeys(report.gamipress.triggerCounts, 50);
  report.gamipress.userEarningCounts = topKeys(report.gamipress.userEarningCounts, 50);
  report.smtp.initiatorPluginCounts = topKeys(report.smtp.initiatorPluginCounts, 50);
  report.codeSnippets.activeNames = report.codeSnippets.activeNames.sort();
  inferSignals(report);

  await mkdir(path.dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Wrote WordPress audit report to ${args.outPath}`);
  console.log(`Tables: ${report.tables.length}`);
  console.log(`Active plugins: ${report.activePlugins.length}`);
  console.log(`Post types: ${Object.keys(report.postTypes).length}`);
  console.log(`Signals: ${report.lmsSignals.join(", ") || "none"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
