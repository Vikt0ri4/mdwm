#!/bin/sh
# POSIX sh tests for install.sh (functions only; main is guarded).
set -eu

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fails=0

check() {
	desc=$1; shift
	if "$@"; then
		printf 'ok   %s\n' "$desc"
	else
		printf 'FAIL %s\n' "$desc"
		fails=$((fails + 1))
	fi
}

# Source the script: the main body must not run when sourced.
# shellcheck source=../install.sh
. "$ROOT/install.sh"

DRY=0
ASSUME_YES=0

# 1. answer n: keep the original, no backup
mkdir -p "$TMP/n"
printf 'old\n' >"$TMP/n/dest"
printf 'new\n' >"$TMP/n/src"
printf 'n\n' | install_config "$TMP/n/src" "$TMP/n/dest" 644 >/dev/null
check "n keeps the original" grep -qx old "$TMP/n/dest"
check "n creates no backup" test ! -e "$TMP/n/dest.bak"

# 2. answer y: back up then overwrite
mkdir -p "$TMP/y"
printf 'old\n' >"$TMP/y/dest"
printf 'new\n' >"$TMP/y/src"
printf 'y\n' | install_config "$TMP/y/src" "$TMP/y/dest" 644 >/dev/null
check "y overwrites" grep -qx new "$TMP/y/dest"
check "y backs up old content" grep -qx old "$TMP/y/dest.bak"

# 3. --yes: no prompt, backup still happens
mkdir -p "$TMP/yes"
printf 'old\n' >"$TMP/yes/dest"
printf 'new\n' >"$TMP/yes/src"
ASSUME_YES=1 install_config "$TMP/yes/src" "$TMP/yes/dest" 644 >/dev/null
check "yes overwrites" grep -qx new "$TMP/yes/dest"
check "yes backs up" grep -qx old "$TMP/yes/dest.bak"

# 4. --dry-run: nothing is written
mkdir -p "$TMP/dry"
printf 'old\n' >"$TMP/dry/dest"
printf 'new\n' >"$TMP/dry/src"
DRY=1 ASSUME_YES=1 install_config "$TMP/dry/src" "$TMP/dry/dest" 644 >/dev/null
check "dry-run keeps old" grep -qx old "$TMP/dry/dest"
check "dry-run creates no backup" test ! -e "$TMP/dry/dest.bak"

# 5. fresh target: no prompt, no backup
mkdir -p "$TMP/fresh"
printf 'new\n' >"$TMP/fresh/src"
DRY=0 ASSUME_YES=0 install_config "$TMP/fresh/src" "$TMP/fresh/dest" 644 >/dev/null
check "fresh installs" grep -qx new "$TMP/fresh/dest"
check "fresh has no backup" test ! -e "$TMP/fresh/dest.bak"

if [ "$fails" -ne 0 ]; then
	printf '%d install.sh test(s) failed\n' "$fails" >&2
	exit 1
fi
printf 'all install.sh tests passed\n'
