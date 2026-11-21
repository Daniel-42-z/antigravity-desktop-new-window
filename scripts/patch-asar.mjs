import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PATCH_DESCRIPTORS } from "./patches/descriptors.mjs";

function parseArgs(argv) {
  const opts = {
    extractedDir: "",
    reportPath: "",
    enableDesktopAction: true,
    enableTray: true,
    enableWindowMenu: true,
    strict: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--extracted-dir") {
      opts.extractedDir = argv[++i] ?? "";
    } else if (arg === "--report") {
      opts.reportPath = argv[++i] ?? "";
    } else if (arg === "--strict") {
      opts.strict = true;
    } else if (arg.startsWith("--enable-desktop-action=")) {
      opts.enableDesktopAction = arg.split("=")[1] === "true";
    } else if (arg.startsWith("--enable-tray=")) {
      opts.enableTray = arg.split("=")[1] === "true";
    } else if (arg.startsWith("--enable-window-menu=")) {
      opts.enableWindowMenu = arg.split("=")[1] === "true";
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.extractedDir) {
    throw new Error("--extracted-dir is required");
  }
  return opts;
}

function readAppVersion(extractedDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(extractedDir, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export function patchExtractedAsar(opts) {
  const flags = {
    enableDesktopAction: opts.enableDesktopAction,
    enableTray: opts.enableTray,
    enableWindowMenu: opts.enableWindowMenu,
  };

  const results = [];
  const modifiedFiles = new Set();

  for (const descriptor of PATCH_DESCRIPTORS) {
    if (!flags[descriptor.flag]) {
      results.push({
        id: descriptor.id,
        file: descriptor.file,
        status: "disabled",
      });
      continue;
    }

    const targetPath = path.join(opts.extractedDir, descriptor.file);
    if (!fs.existsSync(targetPath)) {
      const reason = `Target file missing: ${descriptor.file}`;
      console.warn(`WARN: [${descriptor.id}] ${reason}`);
      results.push({
        id: descriptor.id,
        file: descriptor.file,
        status: "drift",
        reason,
      });
      continue;
    }

    const original = fs.readFileSync(targetPath, "utf8");
    const outcome = descriptor.apply(original);
    if (outcome.status === "applied") {
      fs.writeFileSync(targetPath, outcome.content, "utf8");
      modifiedFiles.add(targetPath);
    } else if (outcome.status === "drift") {
      console.warn(`WARN: [${descriptor.id}] ${outcome.reason}`);
    }

    results.push({
      id: descriptor.id,
      file: descriptor.file,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    });
  }

  for (const filePath of modifiedFiles) {
    execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
  }

  const report = {
    schemaVersion: 1,
    appVersion: readAppVersion(opts.extractedDir),
    patches: results,
  };

  if (opts.reportPath) {
    fs.mkdirSync(path.dirname(opts.reportPath), { recursive: true });
    fs.writeFileSync(opts.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  const drifted = results.filter((entry) => entry.status === "drift");
  if (opts.strict && drifted.length > 0) {
    throw new Error(
      `Strict patch mode failed due to drift in: ${drifted.map((entry) => entry.id).join(", ")}`,
    );
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    patchExtractedAsar(opts);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
