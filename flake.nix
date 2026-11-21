{
  description = "Google Antigravity 2 Linux package with New Window desktop action, Window menu button, and tray entry";

  inputs = {
    antigravity-nix.url = "github:jacopone/antigravity-nix";
    nixpkgs.follows = "antigravity-nix/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      antigravity-nix,
      nixpkgs,
      flake-utils,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
    in
    flake-utils.lib.eachSystem supportedSystems (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        patchLib = import ./nix/patch-antigravity.nix {
          inherit pkgs;
          antigravityNixPath = antigravity-nix.outPath;
          repoRoot = self;
        };

        google-antigravity = patchLib.patchFhs { };
        google-antigravity-no-fhs = patchLib.patchNoFhs { };
        google-antigravity-no-fhs-strict = patchLib.patchNoFhs { strictPatches = true; };
      in
      {
        packages = {
          default = google-antigravity;
          inherit google-antigravity google-antigravity-no-fhs;
          google-antigravity-ide = antigravity-nix.packages.${system}.google-antigravity-ide;
          google-antigravity-cli = antigravity-nix.packages.${system}.google-antigravity-cli;
        };

        checks = {
          unit-tests = pkgs.runCommand "antigravity-new-window-unit-tests" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            cp -r ${self}/* .
            node --test tests/*.test.mjs
            touch "$out"
          '';

          verify-no-fhs = pkgs.runCommand "verify-antigravity-no-fhs-new-window" {
            nativeBuildInputs = [ pkgs.nodejs ];
          } ''
            node ${self}/scripts/verify-patch-report.mjs \
              --strict \
              --desktop "${google-antigravity-no-fhs-strict}/share/applications/antigravity.desktop" \
              "${google-antigravity-no-fhs-strict}/share/antigravity-new-window/patch-report.json"
            touch "$out"
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs
            asar
            pigz
            jq
            gh
          ];
        };
      }
    )
    // {
      overlays.default =
        final: prev:
        let
          patchLib = import ./nix/patch-antigravity.nix {
            pkgs = final;
            antigravityNixPath = antigravity-nix.outPath;
            repoRoot = self;
          };
        in
        {
          google-antigravity = patchLib.patchFhs { };
          google-antigravity-no-fhs = patchLib.patchNoFhs { };
          google-antigravity-ide = antigravity-nix.packages.${final.stdenv.hostPlatform.system}.google-antigravity-ide;
          google-antigravity-cli = antigravity-nix.packages.${final.stdenv.hostPlatform.system}.google-antigravity-cli;
          antigravityNewWindowLib = patchLib;
        };
    };
}
