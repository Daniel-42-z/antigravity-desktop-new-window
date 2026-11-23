# Antigravity Desktop Linux — New Window

Declarative Nix flake layered on top of [`jacopone/antigravity-nix`](https://github.com/jacopone/antigravity-nix) that adds **New Window** support (opening a fresh window in the **same running Antigravity session**) to Google Antigravity 2 Desktop on Linux:

- **Desktop launcher action**: `[Desktop Action new-window]` in `antigravity.desktop` (`antigravity --new-window`), handled in Electron's `second-instance` listener.
- **In-app `Window → New Window` button**: Injected at the top of the existing frameless `Window` dropdown (`Ctrl+Shift+N`), preserving the single-bar UI without modifying `resources/bin/language_server`.
- **System tray menu**: `New Window` entry right below `Open Antigravity`.

Patching is drift-safe (inspired by [`ilysenko/codex-desktop-linux`](https://github.com/ilysenko/codex-desktop-linux)): each patch emits a status in `share/antigravity-new-window/patch-report.json`, and `[Desktop Action new-window]` is automatically omitted if an upstream update drifts.

## Usage in NixOS / Home Manager

Add this flake as an input in your `flake.nix`:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    antigravity-new-window.url = "github:Daniel-42-z/antigravity-desktop-new-window";
  };
}
```

### Option 1: Direct package

```nix
# FHS build (default)
environment.systemPackages = [
  inputs.antigravity-new-window.packages.${pkgs.stdenv.hostPlatform.system}.default
];

# Or non-FHS build
environment.systemPackages = [
  inputs.antigravity-new-window.packages.${pkgs.stdenv.hostPlatform.system}.google-antigravity-no-fhs
];
```

### Option 2: Overlay

```nix
nixpkgs.overlays = [ inputs.antigravity-new-window.overlays.default ];
# Then use pkgs.google-antigravity or pkgs.google-antigravity-no-fhs
```

### Customizing patch options

Using the overlay's `pkgs.antigravityNewWindowLib`:

```nix
(pkgs.antigravityNewWindowLib.patchFhs {
  strictPatches = true; # fail build if upstream drifts
  enableTrayNewWindow = true;
  enableWindowMenuButton = true;
  enableDesktopAction = true;
  antigravityArgs = {
    browserPkg = pkgs.chromium;
  };
})
```

## Development & Verification

```bash
nix flake check
nix build .#google-antigravity
```

## Auto-Update CI

`.github/workflows/update.yml` runs daily, updates the `antigravity-nix` input, runs unit tests, builds both variants with strict patch verification, opens a PR, and squash-merges it using `GITHUB_TOKEN` (falling back to `gh pr merge --auto --squash` if branch protection is enabled).

In GitHub repository settings:
1. Enable **Allow squash merging**.
2. Enable **Allow GitHub Actions to create and approve pull requests**.
3. Enable **Allow auto-merge** (only needed if you later add branch protection requiring status checks).
