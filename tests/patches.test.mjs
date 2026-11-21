import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import {
  applyIpcWindowNewPatch,
  applyPreloadWindowMenuPatch,
  applySecondInstancePatch,
  applyTrayNewWindowPatch,
} from "../scripts/patches/descriptors.mjs";
import { patchExtractedAsar } from "../scripts/patch-asar.mjs";

const MAIN_FIXTURE = `"use strict";
const electron_1 = require("electron");
const utils_1 = require("./utils");
const languageServer_1 = require("./languageServer");
const constants_1 = require("./constants");
const tray_1 = require("./tray");

let storageManager = { id: "storage" };
let hasStartedMainApplication = true;
const HEADLESS = false;
const DEV_URL = undefined;
const PROTOCOL = "antigravity";

function sshHostFromArgs(argv) {
  const arg = argv.find((a) => a.startsWith("--ssh-host="));
  return arg?.slice("--ssh-host=".length).trim() || undefined;
}
function openSshHostFromArgs() {}
function handleDeepLink() {}

electron_1.app.on('second-instance', (_event, commandLine) => {
    if (!HEADLESS && hasStartedMainApplication) {
        (0, utils_1.showOrCreateWindow)((0, languageServer_1.getLsPort)());
        electron_1.app.focus({ steal: true });
    }
    const url = commandLine.find((arg) => arg.startsWith(\`\${PROTOCOL}://\`));
    if (url) {
        handleDeepLink(url);
    }
    else if (hasStartedMainApplication) {
        openSshHostFromArgs(commandLine);
    }
});

(0, tray_1.createTray)([
    {
        id: 'running-agents',
        label: 'No agents running',
        enabled: false,
    },
    { type: 'separator' },
    {
        label: \`Open \${electron_1.app.getName()}\`,
        click: () => (0, utils_1.showOrCreateWindow)((0, languageServer_1.getLsPort)()),
    },
    {
        label: 'Quit',
        click: () => electron_1.app.quit(),
    },
]);
`;

const IPC_FIXTURE = `"use strict";
const electron_1 = require("electron");
const utils_1 = require("./utils");
const wcvIpcHandlers_1 = require("./wcvIpcHandlers");
const windowBackends_1 = require("./remote/windowBackends");

function registerIpcHandlers(storageManager) {
    const getTargetHubWindow = () => null;
    electron_1.ipcMain.handle('window:close', async (event) => {
        const win = getTargetHubWindow(event?.sender);
        if (win) {
            win.close();
        }
    });
}
module.exports = { registerIpcHandlers };
`;

const PRELOAD_FIXTURE = `"use strict";
const electron_1 = require("electron");
const isRemoteWindow = false;
function installHubSurfaceThemeAutoSync() {}
function installCustomFlagOverridesSync() {}
if (!isRemoteWindow) {
    installHubSurfaceThemeAutoSync();
    installCustomFlagOverridesSync();
}
`;

test("applySecondInstancePatch handles --new-window, regular launches, deep links, and SSH args", () => {
  const first = applySecondInstancePatch(MAIN_FIXTURE);
  assert.equal(first.status, "applied");
  const second = applySecondInstancePatch(first.content);
  assert.equal(second.status, "already-applied");
  assert.equal(second.content, first.content);

  const calls = [];
  let secondInstanceHandler = null;
  const mockRequire = (id) => {
    if (id === "electron") {
      return {
        app: {
          on: (event, cb) => {
            if (event === "second-instance") secondInstanceHandler = cb;
          },
          focus: (opts) => calls.push(["focus", opts]),
          getName: () => "Antigravity",
          quit: () => {},
        },
      };
    }
    if (id === "./utils") {
      return {
        createWindow: (url, storage, opts) => calls.push(["createWindow", url, storage, opts]),
        showOrCreateWindow: (port) => calls.push(["showOrCreateWindow", port]),
      };
    }
    if (id === "./languageServer") return { getLsPort: () => 43210 };
    if (id === "./constants") return { WINDOW_ORIGIN: "https://127.0.0.1" };
    if (id === "./tray") return { createTray: () => {} };
    throw new Error(`Unexpected require: ${id}`);
  };

  vm.runInNewContext(first.content, { require: mockRequire, console, process });
  assert.ok(secondInstanceHandler);

  secondInstanceHandler({}, ["antigravity", "--new-window"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [
    ["createWindow", "https://127.0.0.1:43210/", { id: "storage" }, { cascade: true }],
    ["focus", { steal: true }],
  ]);

  secondInstanceHandler({}, ["antigravity"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [
    ["showOrCreateWindow", 43210],
    ["focus", { steal: true }],
  ]);

  secondInstanceHandler({}, ["antigravity", "--new-window", "antigravity://auth/callback"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [
    ["showOrCreateWindow", 43210],
    ["focus", { steal: true }],
  ]);

  secondInstanceHandler({}, ["antigravity", "--new-window", "--ssh-host=devbox"]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [
    ["showOrCreateWindow", 43210],
    ["focus", { steal: true }],
  ]);
});

test("applyTrayNewWindowPatch inserts New Window tray item that opens cascaded window", () => {
  const first = applyTrayNewWindowPatch(MAIN_FIXTURE);
  assert.equal(first.status, "applied");
  assert.equal(applyTrayNewWindowPatch(first.content).status, "already-applied");

  let trayTemplate = null;
  const calls = [];
  const mockRequire = (id) => {
    if (id === "electron") {
      return {
        app: {
          on: () => {},
          focus: (opts) => calls.push(["focus", opts]),
          getName: () => "Antigravity",
          quit: () => {},
        },
      };
    }
    if (id === "./utils") {
      return {
        createWindow: (url, storage, opts) => calls.push(["createWindow", url, storage, opts]),
        showOrCreateWindow: () => {},
      };
    }
    if (id === "./languageServer") return { getLsPort: () => 55555 };
    if (id === "./constants") return { WINDOW_ORIGIN: "https://127.0.0.1" };
    if (id === "./tray") return { createTray: (tpl) => { trayTemplate = tpl; } };
    throw new Error(`Unexpected require: ${id}`);
  };

  vm.runInNewContext(first.content, { require: mockRequire, console, process });
  const newWindowItem = trayTemplate.find((item) => item.label === "New Window");
  assert.ok(newWindowItem);
  newWindowItem.click();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["createWindow", "https://127.0.0.1:55555/", { id: "storage" }, { cascade: true }],
    ["focus", { steal: true }],
  ]);
});

test("applyIpcWindowNewPatch registers authorized window:new handler", async () => {
  const first = applyIpcWindowNewPatch(IPC_FIXTURE);
  assert.equal(first.status, "applied");
  assert.equal(applyIpcWindowNewPatch(first.content).status, "already-applied");

  const handlers = new Map();
  const calls = [];
  let isAuthorizedLocal = true;
  let isRemote = false;

  const mockRequire = (id) => {
    if (id === "electron") {
      return {
        ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
        app: { focus: (opts) => calls.push(["focus", opts]) },
      };
    }
    if (id === "./utils") {
      return {
        createWindow: (url, storage, opts) => calls.push(["createWindow", url, storage, opts]),
      };
    }
    if (id === "./wcvIpcHandlers") {
      return { isAuthorizedHubMainFrameEvent: () => isAuthorizedLocal };
    }
    if (id === "./remote/windowBackends") {
      return { remoteBackendOf: () => (isRemote ? { label: "devbox" } : null) };
    }
    if (id === "./constants") return { WINDOW_ORIGIN: "https://127.0.0.1" };
    if (id === "./languageServer") return { getLsPort: () => 61234 };
    throw new Error(`Unexpected require: ${id}`);
  };

  const mod = { exports: {} };
  vm.runInNewContext(first.content, { require: mockRequire, module: mod, exports: mod.exports, process });
  mod.exports.registerIpcHandlers({ id: "storage" });

  const handler = handlers.get("window:new");
  assert.ok(handler);

  assert.equal(await handler({ sender: {}, senderFrame: {} }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.splice(0))), [
    ["createWindow", "https://127.0.0.1:61234/", { id: "storage" }, { cascade: true }],
    ["focus", { steal: true }],
  ]);

  isAuthorizedLocal = false;
  await assert.rejects(() => handler({ sender: {}, senderFrame: {} }), /Unauthorized window:new/);

  isRemote = true;
  const mainFrame = {};
  assert.equal(await handler({ sender: { mainFrame }, senderFrame: mainFrame }), true);
  assert.equal(calls.length, 2);

  await assert.rejects(() => handler({ sender: { mainFrame }, senderFrame: {} }), /Unauthorized window:new/);
});

test("applyPreloadWindowMenuPatch injects New Window button into Window dropdown", async () => {
  const first = applyPreloadWindowMenuPatch(PRELOAD_FIXTURE);
  assert.equal(first.status, "applied");
  assert.equal(applyPreloadWindowMenuPatch(first.content).status, "already-applied");

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.attrs = new Map();
      this.listeners = new Map();
      this.className = "";
      this.textContent = "";
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    insertBefore(newChild, refChild) {
      newChild.parentElement = this;
      const idx = this.children.indexOf(refChild);
      if (idx === -1) this.children.push(newChild);
      else this.children.splice(idx, 0, newChild);
      return newChild;
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(ev) {
      for (const fn of this.listeners.get(ev.type) ?? []) fn(ev);
    }
    matches(selector) {
      const m = /^\[([^=\]]+)="([^"]+)"\]$/.exec(selector);
      if (!m) return false;
      return this.getAttribute(m[1]) === m[2];
    }
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        for (const c of node.children) {
          if (c.matches(selector)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }

  const root = new MockElement("html");
  const titleBar = new MockElement("div");
  titleBar.setAttribute("data-testid", "title-menu-bar");
  const winContainer = new MockElement("div");
  const winTrigger = new MockElement("button");
  winTrigger.setAttribute("data-testid", "title-menu-bar-item");
  winTrigger.textContent = "Window";
  const dropdown = new MockElement("div");
  dropdown.setAttribute("data-browser-occluder", "true");
  const minRow = new MockElement("div");
  const minBtn = new MockElement("button");
  minBtn.setAttribute("data-testid", "title-menu-bar-option");
  minBtn.className = "w-full px-3 py-1.5 hover:bg-secondary";
  minBtn.textContent = "Minimize";
  minRow.appendChild(minBtn);
  dropdown.appendChild(minRow);
  winContainer.appendChild(winTrigger);
  winContainer.appendChild(dropdown);
  titleBar.appendChild(winContainer);
  root.appendChild(titleBar);

  const docListeners = [];
  const doc = {
    documentElement: root,
    querySelector: (s) => root.querySelector(s),
    createElement: (tag) => new MockElement(tag),
    dispatchEvent: (ev) => docListeners.push(ev),
  };

  let observerCb = null;
  class MockMutationObserver {
    constructor(cb) { observerCb = cb; }
    observe() {}
  }
  class MockKeyboardEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  const invoked = [];
  const g = {
    document: doc,
    top: null,
    self: null,
    MutationObserver: MockMutationObserver,
    KeyboardEvent: MockKeyboardEvent,
  };
  g.top = g;
  g.self = g;

  vm.runInNewContext(first.content, {
    require: () => ({
      ipcRenderer: {
        invoke: (ch) => {
          invoked.push(ch);
          return Promise.resolve(true);
        },
      },
    }),
    globalThis: g,
    process: { platform: "linux" },
  });

  // Trigger observer once more to confirm no duplicate row is inserted.
  observerCb?.();
  const options = dropdown.querySelectorAll('[data-testid="title-menu-bar-option"]');
  assert.equal(options.length, 2);
  assert.equal(options[0].getAttribute("data-antigravity-new-window"), "true");
  assert.equal(options[0].className, minBtn.className);
  assert.equal(options[0].children[0].textContent, "New Window");
  assert.equal(options[0].children[1].textContent, "Ctrl+Shift+N");

  let stopped = false;
  options[0].dispatchEvent({ type: "click", stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(invoked, ["window:new"]);
  assert.equal(docListeners.length, 1);
  assert.equal(docListeners[0].key, "Escape");
});

test("patchExtractedAsar handles drift gracefully when non-strict and fails when strict", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-patch-test-"));
  try {
    fs.mkdirSync(path.join(tmpDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ version: "2.99.0" }));
    fs.writeFileSync(path.join(tmpDir, "dist/main.js"), "// drifted upstream\n");
    fs.writeFileSync(path.join(tmpDir, "dist/ipcHandlers.js"), IPC_FIXTURE);
    fs.writeFileSync(path.join(tmpDir, "dist/preload.js"), PRELOAD_FIXTURE);

    const reportPath = path.join(tmpDir, "patch-report.json");
    const report = patchExtractedAsar({
      extractedDir: tmpDir,
      reportPath,
      enableDesktopAction: true,
      enableTray: true,
      enableWindowMenu: true,
      strict: false,
    });
    assert.equal(report.appVersion, "2.99.0");
    assert.equal(report.patches.find((p) => p.id === "second-instance").status, "drift");
    assert.equal(report.patches.find((p) => p.id === "ipc-window-new").status, "applied");

    assert.throws(
      () =>
        patchExtractedAsar({
          extractedDir: tmpDir,
          reportPath,
          enableDesktopAction: true,
          enableTray: true,
          enableWindowMenu: true,
          strict: true,
        }),
      /Strict patch mode failed/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
