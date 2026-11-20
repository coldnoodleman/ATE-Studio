#!/bin/sh
set -eu
studio_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
studio_bin="$studio_root/ate-studio-bin"
studio_loader=/lib64/ld-linux-x86-64.so.2
if [ "$(uname -m)" != x86_64 ] || [ ! -x "$studio_loader" ]; then
  echo "ATE Studio requires a glibc-based Linux x86_64 system." >&2
  exit 1
fi
if [ ! -x "$studio_bin" ]; then
  echo "Unpack the whole ATE Studio archive and run ./ate-studio from that folder." >&2
  exit 1
fi
if [ "${1:-}" != --check ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo "ATE Studio requires a Linux desktop session (X11 or Wayland)." >&2
  exit 1
fi
studio_runtime="system libraries"
if ! studio_error=$("$studio_loader" --list "$studio_bin" 2>&1); then
  if [ ! -d "$studio_root/linux-libs" ]; then
    printf 'ATE Studio could not load the system libraries.\n%s\n' "$studio_error" >&2
    exit 1
  fi
  export LD_LIBRARY_PATH="$studio_root/linux-libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  if ! studio_error=$("$studio_loader" --list "$studio_bin" 2>&1); then
    printf 'ATE Studio could not load the bundled libraries on this Linux system.\n%s\n' "$studio_error" >&2
    exit 1
  fi
  studio_runtime="bundled desktop libraries"
fi
if [ "${1:-}" = --check ]; then
  printf 'ATE Studio libraries OK (%s).\n' "$studio_runtime"
  exit 0
fi
exec "$studio_bin" "$@"
