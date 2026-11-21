import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hasDesktopNewWindowPatch, renderDesktopActions } from "../scripts/render-desktop-actions.mjs";
import { verifyDesktopFile, verifyPatchReport } from "../scripts/verify-patch-report.mjs";

const DESKTOP_SAMPLE = `[Desktop Entry]
Categories=Development;IDE
Comment=Next-generation agentic IDE
Exec=antigravity %U
Icon=antigravity
MimeType=x-scheme-handler/antigravity
Name=Google Antigravity
StartupNotify=true
StartupWMClass=Antigravity
Type=Application
Version=1.5
`;

test("renderDesktopActions adds new-window action when second-instance patch is applied", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-desktop-test-"));
  try {
    const reportPath = path.join(tmpDir, "patch-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "2.33.0",
        patches: [
          { id: "second-instance", file: "dist/main.js", status: "applied" },
          { id: "tray-new-window", file: "dist/main.js", status: "applied" },
          { id: "ipc-window-new", file: "dist/ipcHandlers.js", status: "applied" },
          { id: "preload-window-menu", file: "dist/preload.js", status: "applied" },
        ],
      }),
    );

    assert.equal(hasDesktopNewWindowPatch(reportPath), true);
    const rendered = renderDesktopActions(DESKTOP_SAMPLE, true);
    assert.match(rendered, /^Actions=new-window;$/m);
    assert.match(rendered, /^\[Desktop Action new-window\]$/m);
    assert.match(rendered, /^Exec=antigravity --new-window$/m);
    verifyDesktopFile(rendered);

    // Idempotent when re-rendered
    assert.equal(renderDesktopActions(rendered, true), rendered);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("renderDesktopActions omits new-window action when drifted or disabled", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-desktop-drift-"));
  try {
    const reportPath = path.join(tmpDir, "patch-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        appVersion: "2.33.0",
        patches: [{ id: "second-instance", file: "dist/main.js", status: "drift" }],
      }),
    );

    assert.equal(hasDesktopNewWindowPatch(reportPath), false);
    const withAction = renderDesktopActions(DESKTOP_SAMPLE, true);
    const stripped = renderDesktopActions(withAction, false);
    assert.equal(stripped, DESKTOP_SAMPLE);
    assert.throws(() => verifyDesktopFile(stripped), /missing new-window action/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("verifyPatchReport enforces strict mode on drift", () => {
  assert.throws(
    () =>
      verifyPatchReport(
        {
          schemaVersion: 1,
          appVersion: "2.33.0",
          patches: [{ id: "second-instance", file: "dist/main.js", status: "drift" }],
        },
        { strict: true, expectedIds: ["second-instance"] },
      ),
    /Drifted patches/,
  );

  const summary = verifyPatchReport(
    {
      schemaVersion: 1,
      appVersion: "2.33.0",
      patches: [{ id: "second-instance", file: "dist/main.js", status: "applied" }],
    },
    { strict: true, expectedIds: ["second-instance"] },
  );
  assert.equal(summary.appliedCount, 1);
  assert.equal(summary.driftedCount, 0);
});
