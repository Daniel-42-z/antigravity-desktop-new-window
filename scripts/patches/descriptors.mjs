export const NEW_WINDOW_ARGS = ["--new-window", "--antigravity-new-window"];

function findUniqueMatch(source, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const matches = [...source.matchAll(re)];
  return matches.length === 1 ? matches[0] : null;
}

function findConstantsModuleName(source) {
  const match = findUniqueMatch(
    source,
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])\.\/constants\2\s*\)/g,
  );
  return match ? match[1] : null;
}

function findModuleName(source, modulePath) {
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = findUniqueMatch(
    source,
    new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*(['"])${escaped}\\2\\s*\\)`, "g"),
  );
  return match ? match[1] : null;
}

export function applySecondInstancePatch(source) {
  const marker = "/* antigravity-new-window:second-instance */";
  if (source.includes(marker)) {
    return { status: "already-applied", content: source };
  }

  const match = findUniqueMatch(
    source,
    /([A-Za-z_$][\w$]*)\.app\.on\(\s*(['"])second-instance\2\s*,\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\{[\s\S]{0,600}?(if\s*\(\s*!HEADLESS\s*&&\s*hasStartedMainApplication\s*\)\s*\{\s*\(\s*0\s*,\s*([A-Za-z_$][\w$]*)\.showOrCreateWindow\s*\)\(\s*\(\s*0\s*,\s*([A-Za-z_$][\w$]*)\.getLsPort\s*\)\(\)\s*\);\s*\1\.app\.focus\(\s*\{\s*steal:\s*true\s*\}\s*\);\s*\})/g,
  );
  if (!match) {
    return {
      status: "drift",
      reason: "Could not uniquely locate app.on('second-instance', ...) window activation block in dist/main.js",
      content: source,
    };
  }

  const [fullMatch, electronMod, , argvName, oldIfBlock, utilsMod, lsMod] = match;
  const constantsMod = findConstantsModuleName(source);
  const windowOriginExpr = constantsMod ? `${constantsMod}.WINDOW_ORIGIN` : "'https://127.0.0.1'";

  const replacementIfBlock =
    `${marker}` +
    `if (!HEADLESS && hasStartedMainApplication) { ` +
    `const __agyHasDeepLink = ${argvName}.some((arg) => typeof arg === 'string' && arg.startsWith(\`\${PROTOCOL}://\`)); ` +
    `const __agyWantsNewWindow = !__agyHasDeepLink && !sshHostFromArgs(${argvName}) && ${argvName}.some((arg) => arg === '--new-window' || arg === '--antigravity-new-window'); ` +
    `if (__agyWantsNewWindow) { ` +
    `(0, ${utilsMod}.createWindow)(DEV_URL ?? \`\${${windowOriginExpr}}:\${(0, ${lsMod}.getLsPort)()}/\`, storageManager, { cascade: true }); ` +
    `} else { ` +
    `(0, ${utilsMod}.showOrCreateWindow)((0, ${lsMod}.getLsPort)()); ` +
    `} ` +
    `${electronMod}.app.focus({ steal: true }); ` +
    `}`;

  const updatedMatch = fullMatch.replace(oldIfBlock, replacementIfBlock);
  const updated = source.slice(0, match.index) + updatedMatch + source.slice(match.index + fullMatch.length);
  return { status: "applied", content: updated };
}

export function applyTrayNewWindowPatch(source) {
  const marker = "/* antigravity-new-window:tray */";
  if (source.includes(marker)) {
    return { status: "already-applied", content: source };
  }

  const match = findUniqueMatch(
    source,
    /(\{\s*label:\s*`Open \$\{([A-Za-z_$][\w$]*)\.app\.getName\(\)\}`,\s*click:\s*\(\)\s*=>\s*\(\s*0\s*,\s*([A-Za-z_$][\w$]*)\.showOrCreateWindow\s*\)\(\s*\(\s*0\s*,\s*([A-Za-z_$][\w$]*)\.getLsPort\s*\)\(\)\s*\),\s*\},)/g,
  );
  if (!match) {
    return {
      status: "drift",
      reason: "Could not uniquely locate 'Open <app>' tray menu item in dist/main.js",
      content: source,
    };
  }

  const [anchor, , electronMod, utilsMod, lsMod] = match;
  const constantsMod = findConstantsModuleName(source);
  const windowOriginExpr = constantsMod ? `${constantsMod}.WINDOW_ORIGIN` : "'https://127.0.0.1'";

  const trayItem =
    `\n            ${marker}\n` +
    `            {\n` +
    `                label: 'New Window',\n` +
    `                click: () => {\n` +
    `                    (0, ${utilsMod}.createWindow)(DEV_URL ?? \`\${${windowOriginExpr}}:\${(0, ${lsMod}.getLsPort)()}/\`, storageManager, { cascade: true });\n` +
    `                    ${electronMod}.app.focus({ steal: true });\n` +
    `                },\n` +
    `            },`;

  const updated =
    source.slice(0, match.index + anchor.length) +
    trayItem +
    source.slice(match.index + anchor.length);
  return { status: "applied", content: updated };
}

export function applyIpcWindowNewPatch(source) {
  const marker = "/* antigravity-new-window:ipc-window-new */";
  if (source.includes(marker)) {
    return { status: "already-applied", content: source };
  }

  const match = findUniqueMatch(
    source,
    /(([A-Za-z_$][\w$]*)\.ipcMain\.handle\(\s*(['"])window:close\3\s*,\s*async\s*\(\s*event\s*\)\s*=>\s*\{\s*const\s+win\s*=\s*getTargetHubWindow\(event\?\.sender\);\s*if\s*\(\s*win\s*\)\s*\{\s*win\.close\(\);\s*\}\s*\}\s*\);)/g,
  );
  if (!match) {
    return {
      status: "drift",
      reason: "Could not uniquely locate window:close IPC handler in dist/ipcHandlers.js",
      content: source,
    };
  }

  const utilsMod = findModuleName(source, "./utils");
  const wcvIpcMod = findModuleName(source, "./wcvIpcHandlers");
  const windowBackendsMod = findModuleName(source, "./remote/windowBackends");
  if (!utilsMod || !wcvIpcMod || !windowBackendsMod) {
    return {
      status: "drift",
      reason: "Could not locate required module imports (utils, wcvIpcHandlers, remote/windowBackends) in dist/ipcHandlers.js",
      content: source,
    };
  }

  const [anchor, , electronMod] = match;
  const handler =
    `\n    ${marker}\n` +
    `    ${electronMod}.ipcMain.handle('window:new', async (event) => {\n` +
    `        const allowed = (0, ${windowBackendsMod}.remoteBackendOf)(event?.sender)\n` +
    `            ? Boolean(event?.senderFrame && event.senderFrame === event.sender.mainFrame)\n` +
    `            : (0, ${wcvIpcMod}.isAuthorizedHubMainFrameEvent)(event);\n` +
    `        if (!allowed) {\n` +
    `            throw new Error('Unauthorized window:new sender');\n` +
    `        }\n` +
    `        const constants = require('./constants');\n` +
    `        const languageServer = require('./languageServer');\n` +
    `        const targetUrl = process.env.DEV_URL || \`\${constants.WINDOW_ORIGIN}:\${languageServer.getLsPort()}/\`;\n` +
    `        (0, ${utilsMod}.createWindow)(targetUrl, storageManager, { cascade: true });\n` +
    `        ${electronMod}.app.focus({ steal: true });\n` +
    `        return true;\n` +
    `    });`;

  const updated =
    source.slice(0, match.index + anchor.length) +
    handler +
    source.slice(match.index + anchor.length);
  return { status: "applied", content: updated };
}

export function applyPreloadWindowMenuPatch(source) {
  const marker = "/* antigravity-new-window:preload-window-menu */";
  if (source.includes(marker)) {
    return { status: "already-applied", content: source };
  }

  const electronMod = findModuleName(source, "electron");
  const match = findUniqueMatch(
    source,
    /(if\s*\(\s*!isRemoteWindow\s*\)\s*\{\s*(?:install[A-Za-z0-9_$]+\(\);\s*)+\})/g,
  );
  if (!electronMod || !match) {
    return {
      status: "drift",
      reason: "Could not uniquely locate preload bootstrap block in dist/preload.js",
      content: source,
    };
  }

  const [anchor] = match;
  const injection =
    `\n${marker}\n` +
    `function installWindowMenuNewWindowButton() {\n` +
    `    const g = globalThis;\n` +
    `    if (!g.document || (g.top && g.self && g.top !== g.self)) {\n` +
    `        return;\n` +
    `    }\n` +
    `    const injectIntoWindowMenu = () => {\n` +
    `        const bar = g.document.querySelector('[data-testid="title-menu-bar"]');\n` +
    `        if (!bar) {\n` +
    `            return;\n` +
    `        }\n` +
    `        const items = bar.querySelectorAll('[data-testid="title-menu-bar-item"]');\n` +
    `        let windowMenuItem = null;\n` +
    `        for (const item of items) {\n` +
    `            if ((item.textContent || '').trim() === 'Window') {\n` +
    `                windowMenuItem = item;\n` +
    `                break;\n` +
    `            }\n` +
    `        }\n` +
    `        const container = windowMenuItem?.parentElement;\n` +
    `        if (!container) {\n` +
    `            return;\n` +
    `        }\n` +
    `        const dropdown = container.querySelector('[data-browser-occluder="true"]');\n` +
    `        if (!dropdown || dropdown.querySelector('[data-antigravity-new-window="true"]')) {\n` +
    `            return;\n` +
    `        }\n` +
    `        const firstOption = dropdown.querySelector('[data-testid="title-menu-bar-option"]');\n` +
    `        const firstRow = firstOption?.parentElement;\n` +
    `        if (!firstOption || !firstRow) {\n` +
    `            return;\n` +
    `        }\n` +
    `        const row = g.document.createElement('div');\n` +
    `        const btn = g.document.createElement('button');\n` +
    `        btn.type = 'button';\n` +
    `        btn.setAttribute('data-testid', 'title-menu-bar-option');\n` +
    `        btn.setAttribute('data-antigravity-new-window', 'true');\n` +
    `        btn.className = firstOption.className;\n` +
    `        const labelSpan = g.document.createElement('span');\n` +
    `        labelSpan.textContent = 'New Window';\n` +
    `        const shortcutSpan = g.document.createElement('span');\n` +
    `        shortcutSpan.className = 'ml-4 text-sm opacity-50 font-sans';\n` +
    `        shortcutSpan.textContent = process.platform === 'darwin' ? '\\u2318\\u21E7N' : 'Ctrl+Shift+N';\n` +
    `        btn.appendChild(labelSpan);\n` +
    `        btn.appendChild(shortcutSpan);\n` +
    `        btn.addEventListener('click', (event) => {\n` +
    `            event.stopPropagation();\n` +
    `            void ${electronMod}.ipcRenderer.invoke('window:new').catch(() => undefined);\n` +
    `            g.document.dispatchEvent(new g.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));\n` +
    `        });\n` +
    `        row.appendChild(btn);\n` +
    `        dropdown.insertBefore(row, firstRow);\n` +
    `    };\n` +
    `    const startObserver = () => {\n` +
    `        const target = g.document.documentElement || g.document.body;\n` +
    `        if (!target || typeof g.MutationObserver !== 'function') {\n` +
    `            return;\n` +
    `        }\n` +
    `        injectIntoWindowMenu();\n` +
    `        new g.MutationObserver(() => injectIntoWindowMenu()).observe(target, {\n` +
    `            childList: true,\n` +
    `            subtree: true,\n` +
    `        });\n` +
    `    };\n` +
    `    if (g.document.documentElement) {\n` +
    `        startObserver();\n` +
    `    } else {\n` +
    `        g.document.addEventListener?.('DOMContentLoaded', startObserver, { once: true });\n` +
    `    }\n` +
    `}\n` +
    `installWindowMenuNewWindowButton();`;

  const updated =
    source.slice(0, match.index + anchor.length) +
    injection +
    source.slice(match.index + anchor.length);
  return { status: "applied", content: updated };
}

export const PATCH_DESCRIPTORS = [
  {
    id: "second-instance",
    file: "dist/main.js",
    flag: "enableDesktopAction",
    apply: applySecondInstancePatch,
  },
  {
    id: "tray-new-window",
    file: "dist/main.js",
    flag: "enableTray",
    apply: applyTrayNewWindowPatch,
  },
  {
    id: "ipc-window-new",
    file: "dist/ipcHandlers.js",
    flag: "enableWindowMenu",
    apply: applyIpcWindowNewPatch,
  },
  {
    id: "preload-window-menu",
    file: "dist/preload.js",
    flag: "enableWindowMenu",
    apply: applyPreloadWindowMenuPatch,
  },
];
