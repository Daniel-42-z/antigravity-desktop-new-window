{
  pkgs,
  antigravityNixPath,
  repoRoot,
}:
let
  lib = pkgs.lib;
  patchScriptsDir = "${repoRoot}/scripts";

  mkPatchFlags =
    {
      enableDesktopAction ? true,
      enableTrayNewWindow ? true,
      enableWindowMenuButton ? true,
      strictPatches ? false,
    }:
    lib.concatStringsSep " " (
      [
        "--enable-desktop-action=${lib.boolToString enableDesktopAction}"
        "--enable-tray=${lib.boolToString enableTrayNewWindow}"
        "--enable-window-menu=${lib.boolToString enableWindowMenuButton}"
      ]
      ++ lib.optional strictPatches "--strict"
    );

  renderDesktopSnippet = ''
    desktopFile="$out/share/applications/antigravity.desktop"
    if [ -f "$desktopFile" ]; then
      if [ -L "$desktopFile" ]; then
        cp --remove-destination "$(readlink -f "$desktopFile")" "$desktopFile"
      fi
      chmod u+w "$desktopFile"
      ${pkgs.nodejs}/bin/node ${patchScriptsDir}/render-desktop-actions.mjs \
        --report "$reportFile" \
        --input "$desktopFile" \
        --output "$desktopFile.tmp"
      mv "$desktopFile.tmp" "$desktopFile"
    else
      echo "ERROR: expected $desktopFile to exist after copyDesktopItems" >&2
      exit 1
    fi
  '';
in
{
  patchNoFhs =
    {
      basePackage ? pkgs.callPackage "${antigravityNixPath}/pkgs/google-antigravity2.nix" { useFHS = false; },
      enableDesktopAction ? true,
      enableTrayNewWindow ? true,
      enableWindowMenuButton ? true,
      strictPatches ? false,
    }:
    let
      flags = mkPatchFlags {
        inherit
          enableDesktopAction
          enableTrayNewWindow
          enableWindowMenuButton
          strictPatches
          ;
      };
    in
    basePackage.overrideAttrs (old: {
      nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [
        pkgs.nodejs
        pkgs.asar
      ];

      postPatch = (old.postPatch or "") + ''
        if [ -f "resources/app.asar" ]; then
          ${pkgs.asar}/bin/asar extract "resources/app.asar" "__agy_asar_tmp"
          ${pkgs.nodejs}/bin/node ${patchScriptsDir}/patch-asar.mjs \
            --extracted-dir "__agy_asar_tmp" \
            --report "__agy_patch_report.json" \
            ${flags}
          rm -f "resources/app.asar"
          ${pkgs.asar}/bin/asar pack "__agy_asar_tmp" "resources/app.asar"
          rm -rf "__agy_asar_tmp"
        else
          echo "ERROR: expected resources/app.asar in Antigravity package" >&2
          exit 1
        fi
      '';

      postInstall = (old.postInstall or "") + ''
        install -Dm644 "__agy_patch_report.json" "$out/share/antigravity-new-window/patch-report.json"
      '';

      postFixup = (old.postFixup or "") + ''
        reportFile="$out/share/antigravity-new-window/patch-report.json"
        ${renderDesktopSnippet}
      '';
    });

  patchFhs =
    {
      antigravityArgs ? { },
      enableDesktopAction ? true,
      enableTrayNewWindow ? true,
      enableWindowMenuButton ? true,
      strictPatches ? false,
    }:
    let
      versions = builtins.fromJSON (builtins.readFile "${antigravityNixPath}/artifacts/versions.json");
      system = pkgs.stdenv.hostPlatform.system;
      platformInfo =
        versions."Antigravity 2.0".${system}
          or (throw "Unsupported system for Antigravity 2.0: ${system}");

      upstreamSrc = pkgs.fetchurl {
        url = platformInfo.url;
        sha256 = platformInfo.hash;
      };

      flags = mkPatchFlags {
        inherit
          enableDesktopAction
          enableTrayNewWindow
          enableWindowMenuButton
          strictPatches
          ;
      };

      patchedSrc = pkgs.stdenvNoCC.mkDerivation {
        pname = "google-antigravity2-patched-src";
        version =
          let
            match = builtins.match ".*/([0-9]+\\.[0-9]+\\.[0-9]+-[0-9]+)/.*" platformInfo.url;
          in
          if match != null then builtins.elemAt match 0 else "unknown";

        dontUnpack = true;
        dontConfigure = true;
        dontBuild = true;

        outputs = [
          "out"
          "report"
        ];

        nativeBuildInputs = [
          pkgs.asar
          pkgs.nodejs
          pkgs.pigz
        ];

        installPhase = ''
          runHook preInstall

          mkdir -p unpacked
          tar -xzf "${upstreamSrc}" -C unpacked
          topDir="$(find unpacked -mindepth 1 -maxdepth 1 -type d | head -n1)"
          if [ -z "$topDir" ] || [ ! -f "$topDir/resources/app.asar" ]; then
            echo "ERROR: could not find resources/app.asar inside upstream tarball" >&2
            exit 1
          fi

          ${pkgs.asar}/bin/asar extract "$topDir/resources/app.asar" asar-src
          ${pkgs.nodejs}/bin/node ${patchScriptsDir}/patch-asar.mjs \
            --extracted-dir asar-src \
            --report "$report" \
            ${flags}
          rm -f "$topDir/resources/app.asar"
          ${pkgs.asar}/bin/asar pack asar-src "$topDir/resources/app.asar"
          rm -rf asar-src

          tar -I "${pkgs.pigz}/bin/pigz -1" -cf "$out" -C unpacked "$(basename "$topDir")"

          runHook postInstall
        '';
      };

      baseFhs = pkgs.callPackage "${antigravityNixPath}/pkgs/google-antigravity2.nix" (
        antigravityArgs
        // {
          useFHS = true;
          srcOverride = patchedSrc;
        }
      );
    in
    baseFhs.overrideAttrs (old: {
      postInstall = (old.postInstall or "") + ''
        install -Dm644 "${patchedSrc.report}" "$out/share/antigravity-new-window/patch-report.json"
      '';

      postFixup = (old.postFixup or "") + ''
        reportFile="$out/share/antigravity-new-window/patch-report.json"
        ${renderDesktopSnippet}
      '';
    });
}
