#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

runtime="${1:?Use: collect-linux-libs.sh ELECTRON_BINARY PACKAGE_DIR}"
package_dir="${2:?Use: collect-linux-libs.sh ELECTRON_BINARY PACKAGE_DIR}"
runtime_dir="$(dirname "$(realpath "$runtime")")"
libraries="$package_dir/linux-libs"
licenses="$package_dir/third-party/linux"
mkdir -p "$libraries" "$licenses"
manifest="$package_dir/LINUX-LIBRARIES.tsv"
printf 'Library\tBinary package\tVersion\tSource package\tSource version\n' > "$manifest"

copy_library() {
  local soname="$1" file="$2" real owner package copyright
  case "$soname" in
    ld-linux*|libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|libresolv.so.*|librt.so.*|libutil.so.*) return ;;
  esac
  real="$(realpath "$file")"
  [[ "$real" == "$runtime_dir/"* || -e "$libraries/$soname" ]] && return
  if ! owner="$(dpkg-query -S "$real" 2>/dev/null)"; then
    owner="$(dpkg-query -S "${real#/usr}")"
  fi
  package="${owner%%: /*}"
  copyright="/usr/share/doc/${package%%:*}/copyright"
  install -m 0644 "$file" "$libraries/$soname"
  install -m 0644 "$copyright" "$licenses/${package%%:*}.txt"
  printf '%s\t' "$soname" >> "$manifest"
  dpkg-query -W -f='${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n' "$package" >> "$manifest"
}

trace="$(ldd "$runtime")"
if [[ "$trace" == *"not found"* ]]; then
  printf 'Build host is missing Electron libraries.\n%s\n' "$trace" >&2
  exit 1
fi
while IFS=$'\t' read -r soname file; do
  copy_library "$soname" "$file"
  if [[ "$soname" == libnss3.so ]]; then
    for plugin in libsoftokn3.so libfreebl3.so libfreeblpriv3.so libnssckbi.so libnssdbm3.so; do
      module="$(dirname "$file")/$plugin"
      if [[ -f "$module" ]]; then copy_library "$plugin" "$module"; fi
    done
  fi
done < <(awk '$2 == "=>" && $3 ~ /^\// { print $1 "\t" $3 }' <<< "$trace")

[[ -f "$libraries/libgtk-3.so.0" && -f "$libraries/libnss3.so" && -f "$libraries/libasound.so.2" ]]
LD_LIBRARY_PATH="$libraries" /lib64/ld-linux-x86-64.so.2 --list "$runtime" >/dev/null
