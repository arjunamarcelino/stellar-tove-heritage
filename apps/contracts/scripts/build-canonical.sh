#!/usr/bin/env bash
# build-canonical.sh — deterministic canonical WASM build + hash manifest (TOV-146).
#
# The Tove fractional-ownership model ships ONE audited FractionToken bytecode
# for every artwork (per-artwork parameters are constructor args, never code).
# This script formalises that: it builds all production contracts, hashes each
# release WASM, and records the result in the committed `wasm-manifest.txt` so
# any unintended bytecode drift is caught in review and in CI.
#
# Test-fixture executables (deliberately hostile, NEVER deployed — e.g.
# tove_evil_fraction_token.wasm from TOV-151) are built by `stellar contract
# build` alongside the real crates but are excluded from the canonical set here.
#
# Modes:
#   (default)   build + (re)write wasm-manifest.txt
#   --check     build + compare against the committed wasm-manifest.txt; exit 1
#               on any drift (out-of-date manifest OR changed bytecode). Used by
#               CI to fail red when the manifest and source disagree.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MANIFEST="wasm-manifest.txt"
WASM_DIR="target/wasm32v1-none/release"
# Test-fixture artifacts excluded from the canonical (deployable) set. Match on
# basename; add patterns here if more non-deploy fixtures are ever built.
EXCLUDE_GLOB="tove_evil_*"

MODE="write"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
elif [[ -n "${1:-}" ]]; then
  echo "ERROR: unknown argument '$1' (expected none or --check)" >&2
  exit 2
fi

# --- Build --------------------------------------------------------------------
echo "==> stellar contract build"
stellar contract build

# --- Enumerate canonical production WASM --------------------------------------
# Glob every release WASM, then filter out the excluded test fixtures. Nullglob
# so a missing/empty dir yields an empty array (handled below) rather than a
# literal unexpanded glob.
shopt -s nullglob
ALL_WASM=("$WASM_DIR"/*.wasm)
shopt -u nullglob

CANONICAL=()
EXCLUDED=()
for wasm in "${ALL_WASM[@]}"; do
  base="$(basename "$wasm")"
  # shellcheck disable=SC2053
  if [[ "$base" == $EXCLUDE_GLOB ]]; then
    EXCLUDED+=("$base")
  else
    CANONICAL+=("$wasm")
  fi
done

if ((${#CANONICAL[@]} == 0)); then
  echo "ERROR: no canonical WASM found under $WASM_DIR (did the build produce artifacts?)" >&2
  exit 1
fi

# --- Compute manifest ---------------------------------------------------------
# Lines: "<sha256>  <basename>", sorted by basename for a stable, diffable file.
COMPUTED="$(
  for wasm in "${CANONICAL[@]}"; do
    sum="$(sha256sum "$wasm" | awk '{print $1}')"
    printf '%s  %s\n' "$sum" "$(basename "$wasm")"
  done | sort -k2
)"

# --- Summary ------------------------------------------------------------------
echo "==> canonical WASM set: ${#CANONICAL[@]} artifact(s)"
if ((${#EXCLUDED[@]})); then
  echo "    excluded (test fixtures): ${EXCLUDED[*]}"
else
  echo "    excluded (test fixtures): none"
fi

# --- Mode dispatch ------------------------------------------------------------
if [[ "$MODE" == "check" ]]; then
  if [[ ! -f "$MANIFEST" ]]; then
    echo "ERROR: --check requested but $MANIFEST does not exist; run '$0' to generate it" >&2
    exit 1
  fi
  if diff -u "$MANIFEST" <(printf '%s\n' "$COMPUTED") >/tmp/wasm-manifest.diff 2>&1; then
    echo "==> --check OK: $MANIFEST matches the freshly-built canonical set"
    exit 0
  else
    echo "ERROR: canonical WASM drift — $MANIFEST is out of date vs the current build:" >&2
    cat /tmp/wasm-manifest.diff >&2
    echo "       run '$0' and commit the updated $MANIFEST" >&2
    exit 1
  fi
else
  printf '%s\n' "$COMPUTED" >"$MANIFEST"
  echo "==> wrote $MANIFEST:"
  sed 's/^/    /' "$MANIFEST"
fi
