#!/bin/sh
set -eu
studio_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo "ATE Studio requires a Linux desktop session (X11 or Wayland)." >&2
  exit 1
fi
if command -v ldd >/dev/null 2>&1; then
  studio_missing=$(ldd "$studio_root/ate-studio-bin" | awk '/not found/ { print $1 }')
  if [ -n "$studio_missing" ]; then
    echo "Missing desktop libraries for ATE Studio:" >&2
    echo "$studio_missing" >&2
    exit 1
  fi
fi
exec "$studio_root/ate-studio-bin" "$@"
