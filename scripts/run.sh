#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: scripts/run.sh <script-dir> [args...]" >&2
  echo "  example: scripts/run.sh create-wrangler-json" >&2
  echo "  example: scripts/run.sh create-presign-spec [out-json-path]" >&2
  echo "  Runs: bun install [--frozen-lockfile in CI] --cwd scripts/<script-dir>" >&2
  echo "  then: bun run scripts/<script-dir>/index.ts [args...]" >&2
  exit 1
}

[[ $# -ge 1 ]] || usage
SCRIPT="$1"; shift

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pkg="scripts/${SCRIPT}"
script="${pkg}/index.ts"
if [[ ! -d "$pkg" ]] || [[ ! -f "$script" ]]; then
  echo "error: missing $script" >&2
  exit 1
fi

local bun_install_args
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  bun_install_args=--frozen-lockfile
fi
bun install --cwd "$pkg" $bun_install_args
exec bun run "$script" "$@"
