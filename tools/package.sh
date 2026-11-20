#!/usr/bin/env bash
set -euo pipefail
studio_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
studio_runtimes="$(cd -- "${1:?Use: package.sh RUNTIME_DIR OUTPUT_DIR}" && pwd)"
mkdir -p -- "${2:?Use: package.sh RUNTIME_DIR OUTPUT_DIR}"
studio_out="$(cd -- "$2" && pwd)"
studio_version="$(node -p "require(process.argv[1]).version" "$studio_root/package.json")"
electron_version="$(node -p "require(process.argv[1]).devDependencies.electron" "$studio_root/package.json")"
studio_stage="$(mktemp -d)"
trap 'rm -rf -- "$studio_stage"' EXIT

for studio_platform in win32 linux; do
  studio_bundle="electron-v${electron_version}-${studio_platform}-x64.zip"
  (
    cd "$studio_runtimes"
    awk -v name="$studio_bundle" '{ file=$2; sub(/^\*/, "", file) } file == name {print; found=1} END { if (!found) exit 1 }' SHASUMS256.txt | sha256sum -c
  )
  studio_dir="$studio_stage/ATE_Studio"
  rm -rf -- "$studio_dir"
  mkdir -p "$studio_dir"
  unzip -q "$studio_runtimes/$studio_bundle" -d "$studio_dir"
  rm -f "$studio_dir/resources/default_app.asar"
  studio_app="$studio_dir/resources/app"
  mkdir -p "$studio_app/node_modules" "$studio_dir/third-party"
  cp "$studio_root"/{main.mjs,preload.cjs,domain.mjs,catalog.mjs,csv.mjs,wiring.mjs,wiring-sample.mjs,wiring-report.mjs,receiver.mjs,receiver-catalog.mjs,pickering-catalog.mjs,llm.mjs,store.mjs,report.mjs,selftest.mjs,package.json} "$studio_app/"
  cp -a "$studio_root/dist" "$studio_app/"
  cp -a "$studio_root/node_modules/fflate" "$studio_app/node_modules/"
  cp "$studio_root/README.md" "$studio_dir/"
  for studio_dep in react react-dom lucide-react fflate scheduler; do
    cp "$studio_root/node_modules/$studio_dep/LICENSE" "$studio_dir/third-party/$studio_dep-LICENSE.txt"
  done
  cp "$studio_root/public/fonts/OFL.txt" "$studio_dir/third-party/Noto-OFL.txt"
  if [[ -d "$studio_root/examples" ]]; then
    mkdir -p "$studio_dir/examples"
    cp "$studio_root"/examples/*.ateproj "$studio_dir/examples/"
  fi
  if [[ "$studio_platform" == win32 ]]; then
    mv "$studio_dir/electron.exe" "$studio_dir/ATE Studio.exe"
    studio_archive="$studio_out/ATE_Studio_v${studio_version}_Windows_x64.zip"
    rm -f -- "$studio_archive"
    (cd "$studio_stage" && zip -q -r -4 "$studio_archive" ATE_Studio)
  else
    mv "$studio_dir/electron" "$studio_dir/ate-studio-bin"
    install -m 0755 "$studio_root/tools/Linux-launcher.sh" "$studio_dir/ate-studio"
    tar -C "$studio_stage" -czf "$studio_out/ATE_Studio_v${studio_version}_Linux_x64.tar.gz" ATE_Studio
  fi
done
