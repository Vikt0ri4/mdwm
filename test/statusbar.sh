#!/bin/bash
# POSIX sh tests for statusbar.sh's palette parsing (functions only; main is guarded).
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

# shellcheck source=../scripts/statusbar.sh
. "$ROOT/scripts/statusbar.sh"

# 1. valid palette overrides the defaults
cat >"$TMP/valid" <<'EOF'
# comment
stat_cpu=#112233
stat_mem=#445566
stat_disk=#778899
stat_net=#aabbcc
stat_vol=#ddeeff
stat_time=#012345
tag_sel_fg=#abcdef
EOF
parse_palette "$TMP/valid" >"$TMP/parsed"
check "cpu parsed" grep -qx 'stat_cpu=#112233' "$TMP/parsed"
check "text parsed" grep -qx 'tag_sel_fg=#abcdef' "$TMP/parsed"

# 2. bad colour is ignored, good lines survive
cat >"$TMP/bad" <<'EOF'
stat_cpu=not-a-colour
stat_mem=#445566
tag_sel_fg=#abc
EOF
parse_palette "$TMP/bad" >"$TMP/parsed-bad"
check "bad cpu dropped" sh -c "! grep -qx 'stat_cpu=not-a-colour' '$TMP/parsed-bad'"
check "bad text dropped" sh -c "! grep -qx 'tag_sel_fg=#abc' '$TMP/parsed-bad'"
check "good mem kept" grep -qx 'stat_mem=#445566' "$TMP/parsed-bad"

# 3. missing file prints nothing
check "missing file is empty" test -z "$(parse_palette "$TMP/nope")"

# 4. unknown keys are ignored
cat >"$TMP/unknown" <<'EOF'
foo=#112233
stat_cpu=#112233
EOF
parse_palette "$TMP/unknown" >"$TMP/parsed-unknown"
check "unknown key dropped" sh -c "! grep -qx 'foo=#112233' '$TMP/parsed-unknown'"

if [ "$fails" -ne 0 ]; then
	printf '%d statusbar test(s) failed\n' "$fails" >&2
	exit 1
fi
printf 'all statusbar tests passed\n'
