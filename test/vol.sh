#!/bin/sh
# POSIX sh tests for scripts/vol using fake wpctl/pactl/amixer backends.
set -eu

ROOT=$(cd -- "$(dirname -- "$0")/.." && pwd)
VOL="$ROOT/scripts/vol"
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

expect() {
	desc=$1 want=$2 got=$3
	if [ "$want" = "$got" ]; then
		printf 'ok   %s\n' "$desc"
	else
		printf 'FAIL %s (want %s, got %s)\n' "$desc" "$want" "$got"
		fails=$((fails + 1))
	fi
}

# --- fake PipeWire ---
mkdir -p "$TMP/wire"
cat >"$TMP/wire/wpctl" <<'EOF'
#!/bin/sh
state="$FAKE_STATE"
case "$1" in
get-volume)
	if [ -f "$state.mute" ]; then
		echo "Volume: $(cat "$state") [MUTED]"
	else
		echo "Volume: $(cat "$state")"
	fi
	;;
set-volume)
	case "$3" in
	*%+) awk -v v="${3%\%+}" -v c="$(cat "$state")" 'BEGIN { printf "%.2f", (c * 100 + v) / 100 }' >"$state" ;;
	*%-) awk -v v="${3%\%-}" -v c="$(cat "$state")" 'BEGIN { printf "%.2f", (c * 100 - v) / 100 }' >"$state" ;;
	*) awk -v v="${3%\%}" 'BEGIN { printf "%.2f", v / 100 }' >"$state" ;;
	esac
	;;
set-mute)
	if [ -f "$state.mute" ]; then rm -f "$state.mute"; else : >"$state.mute"; fi
	;;
esac
EOF
chmod +x "$TMP/wire/wpctl"

run_wire() {
	state=$TMP/wire/state
	[ -f "$state" ] || echo "0.50" >"$state"
	VOL_BACKEND=pipewire FAKE_STATE="$state" PATH="$TMP/wire:$PATH" "$VOL" "$@"
}

echo 0.50 >"$TMP/wire/state"
expect "pipewire get 50" 50 "$(run_wire get)"
expect "pipewire up 10 -> 60" 60 "$(run_wire up 10; run_wire get)"
expect "pipewire down 20 -> 40" 40 "$(run_wire down 20; run_wire get)"
expect "pipewire set 80" 80 "$(run_wire set 80; run_wire get)"
expect "pipewire clamp high" 100 "$(run_wire set 150; run_wire get)"
expect "pipewire clamp low" 0 "$(run_wire set -5; run_wire get)"

# --- fake pactl ---
mkdir -p "$TMP/pulse"
cat >"$TMP/pulse/pactl" <<'EOF'
#!/bin/sh
state="$FAKE_STATE"
case "$1" in
get-sink-volume) printf 'Volume: front-left: 32768 / %s%% / -18.06 dB\n' "$(cat "$state")" ;;
set-sink-volume)
	case "$3" in
	*%+) echo "$(($(cat "$state") + ${3%\%+}))" >"$state" ;;
	*%-) echo "$(($(cat "$state") - ${3%\%-}))" >"$state" ;;
	*) echo "${3%\%}" >"$state" ;;
	esac
	;;
get-sink-mute) cat "$state.mute" 2>/dev/null || echo "Mute: no" ;;
set-sink-mute) echo "Mute: yes" >"$state.mute" ;;
esac
EOF
chmod +x "$TMP/pulse/pactl"
echo 30 >"$TMP/pulse/state"
expect "pulse get 30" 30 "$(VOL_BACKEND=pulse FAKE_STATE=$TMP/pulse/state PATH="$TMP/pulse:$PATH" "$VOL" get)"
expect "pulse up 5" 35 "$(VOL_BACKEND=pulse FAKE_STATE=$TMP/pulse/state PATH="$TMP/pulse:$PATH" "$VOL" up 5; VOL_BACKEND=pulse FAKE_STATE=$TMP/pulse/state PATH="$TMP/pulse:$PATH" "$VOL" get)"

# --- fake ALSA ---
mkdir -p "$TMP/alsa"
cat >"$TMP/alsa/amixer" <<'EOF'
#!/bin/sh
state="$FAKE_STATE"
case "$1 $2" in
"get Master")
	if [ "$(cat "$state.mute" 2>/dev/null)" = off ]; then
		printf 'Front Left: Playback 128 [%s%%] [off]\n' "$(cat "$state")"
	else
		printf 'Front Left: Playback 128 [%s%%] [on]\n' "$(cat "$state")"
	fi
	;;
"sset Master")
	case "$3" in
	*%+) echo "$(($(cat "$state") + ${3%\%+}))" >"$state" ;;
	*%-) echo "$(($(cat "$state") - ${3%\%-}))" >"$state" ;;
	*%) echo "${3%\%}" >"$state" ;;
	toggle) cat "$state.mute" 2>/dev/null | grep -q on && echo off >"$state.mute" || echo on >"$state.mute" ;;
	unmute) echo on >"$state.mute" ;;
	esac
	;;
esac
EOF
chmod +x "$TMP/alsa/amixer"
echo 70 >"$TMP/alsa/state"
expect "alsa get 70" 70 "$(VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" get)"
expect "alsa set 20" 20 "$(VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" set 20; VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" get)"
echo on >"$TMP/alsa/state.mute"
VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" mute
expect "alsa mute shows 0" 0 "$(VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" get)"
VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" toggle
expect "alsa toggle unmute" 20 "$(VOL_BACKEND=alsa FAKE_STATE=$TMP/alsa/state PATH="$TMP/alsa:$PATH" "$VOL" get)"

# --- no backend ---
expect "no backend get 0" 0 "$(VOL_BACKEND=none PATH="/usr/bin:/bin" "$VOL" get 2>/dev/null || true)"

if [ "$fails" -ne 0 ]; then
	printf '%d vol test(s) failed\n' "$fails" >&2
	exit 1
fi
printf 'all vol tests passed\n'
