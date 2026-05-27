#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bunx github:git-lfs-hub/config#main init-test-worker "$root" "$root/test"
