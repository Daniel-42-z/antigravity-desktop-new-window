import fs from "node:fs";

const APPLIED_STATUSES = new Set(["applied", "already-applied"]);

export function hasDesktopNewWindowPatch(reportPath) {
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return (
      Array.isArray(report.patches) &&
      report.patches.some(
        (entry) => entry.id === "second-instance" && APPLIED_STATUSES.has(entry.status),
      )
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(
        `[WARN] Could not read patch report from ${reportPath}: ${error.message}`,
      );
    }
    return false;
  }
}

function extractExecBinary(lines) {
  for (const line of lines) {
    if (!line.startsWith("Exec=")) continue;
    const raw = line.slice("Exec=".length).trim();
    const tokens = raw.split(/\s+/).filter((token) => !/^%[a-zA-Z]$/.test(token));
    if (tokens.length > 0) {
      return tokens.join(" ");
    }
  }
  return "antigravity";
}

export function renderDesktopActions(source, includeNewWindow) {
  const rawLines = source.trimEnd().split(/\r?\n/);
  const execCmd = extractExecBinary(rawLines);
  const lines = [];
  let skipGroup = false;
  let sawActionsLine = false;

  for (const line of rawLines) {
    if (line.startsWith("[")) {
      const actionMatch = /^\[Desktop Action ([^\]]+)\]$/.exec(line);
      skipGroup = actionMatch != null && actionMatch[1] === "new-window";
    }
    if (skipGroup) continue;

    if (line.startsWith("Actions=")) {
      sawActionsLine = true;
      const existing = line
        .slice("Actions=".length)
        .split(";")
        .filter((id) => id && id !== "new-window");
      if (includeNewWindow) {
        existing.push("new-window");
      }
      if (existing.length > 0) {
        lines.push(`Actions=${existing.join(";")};`);
      }
      continue;
    }

    lines.push(line);
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (includeNewWindow) {
    if (!sawActionsLine) {
      const desktopEntryEnd = lines.findIndex((line, idx) => idx > 0 && line.startsWith("["));
      const insertAt = desktopEntryEnd === -1 ? lines.length : desktopEntryEnd;
      lines.splice(insertAt, 0, "Actions=new-window;");
    }
    lines.push("", "[Desktop Action new-window]", "Name=New Window", `Exec=${execCmd} --new-window`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let reportPath = "";
  let inputPath = "";
  let outputPath = "";

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--report") reportPath = args[++i] ?? "";
    else if (arg === "--input") inputPath = args[++i] ?? "";
    else if (arg === "--output") outputPath = args[++i] ?? "";
    else if (!reportPath) reportPath = arg;
  }

  const input = inputPath ? fs.readFileSync(inputPath, "utf8") : fs.readFileSync(0, "utf8");
  const includeNewWindow = hasDesktopNewWindowPatch(reportPath);
  const rendered = renderDesktopActions(input, includeNewWindow);

  if (outputPath) {
    fs.writeFileSync(outputPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
}
