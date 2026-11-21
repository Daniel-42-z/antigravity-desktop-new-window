import fs from "node:fs";

const APPLIED_STATUSES = new Set(["applied", "already-applied"]);

export function verifyPatchReport(report, { strict = false, expectedIds } = {}) {
  if (!report || typeof report !== "object" || report.schemaVersion !== 1) {
    throw new Error("Invalid patch-report.json schemaVersion");
  }
  if (!Array.isArray(report.patches) || report.patches.length === 0) {
    throw new Error("patch-report.json contains no patch entries");
  }

  const byId = new Map(report.patches.map((entry) => [entry.id, entry]));
  if (expectedIds) {
    for (const id of expectedIds) {
      if (!byId.has(id)) {
        throw new Error(`Missing expected patch entry: ${id}`);
      }
    }
  }

  const drifted = report.patches.filter((entry) => entry.status === "drift");
  if (strict && drifted.length > 0) {
    throw new Error(
      `Drifted patches in strict mode: ${drifted.map((entry) => entry.id).join(", ")}`,
    );
  }

  const active = report.patches.filter((entry) => APPLIED_STATUSES.has(entry.status));
  return {
    appVersion: report.appVersion,
    appliedCount: active.length,
    driftedCount: drifted.length,
  };
}

export function verifyDesktopFile(desktopContent) {
  const hasActionList = /^Actions=.*new-window;/m.test(desktopContent);
  const hasActionGroup = /^\[Desktop Action new-window\]$/m.test(desktopContent);
  const hasExecFlag = /^Exec=.*--new-window\b/m.test(desktopContent);
  if (!hasActionList || !hasActionGroup || !hasExecFlag) {
    throw new Error(
      `Desktop file is missing new-window action (Actions=${hasActionList}, Group=${hasActionGroup}, Exec=${hasExecFlag})`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let strict = false;
  let reportPath = "";
  let desktopPath = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--strict") strict = true;
    else if (arg === "--desktop") desktopPath = args[++i] ?? "";
    else if (!reportPath) reportPath = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!reportPath) {
    console.error("Usage: verify-patch-report.mjs [--strict] [--desktop <path>] <patch-report.json>");
    process.exit(1);
  }

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const summary = verifyPatchReport(report, {
      strict,
      expectedIds: ["second-instance", "tray-new-window", "ipc-window-new", "preload-window-menu"],
    });
    if (desktopPath) {
      verifyDesktopFile(fs.readFileSync(desktopPath, "utf8"));
    }
    console.log(
      `Verified patch report (appVersion=${summary.appVersion}, applied=${summary.appliedCount}, drifted=${summary.driftedCount})`,
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
