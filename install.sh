#!/usr/bin/env bash
# monet-desktop one-shot installer.
#   sudo ./install.sh            # install (asks before overwriting configs)
#   sudo ./install.sh --dry-run  # print what would happen
#   sudo ./install.sh --yes      # overwrite existing configs without asking
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PREFIX=${PREFIX:-/usr/local}
DRY=0
ASSUME_YES=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

run() {
	if [ "$DRY" = 1 ]; then
		printf '[dry-run]'; printf ' %q' "$@"; echo
	else
		"$@"
	fi
}

as_user() {
	if [ "$DRY" = 1 ]; then
		printf '[dry-run] sudo -u %s -H' "$SUDO_USER"; printf ' %q' "$@"; echo
	else
		sudo -u "$SUDO_USER" -H "$@"
	fi
}

# Install a config file. If the target exists: ask [y/N] (unless --yes),
# back it up to <target>.bak, then overwrite.
install_config() {
	local src=$1 dest=$2 mode=$3 answer=
	if [ -e "$dest" ]; then
		if [ "$DRY" = 0 ] && [ "$ASSUME_YES" = 0 ]; then
			printf '  ? %s already exists. Overwrite? [y/N] ' "$dest"
			read -r answer || answer=n
			case "$answer" in
			[yY]*) ;;
			*) echo "  - kept $dest"; return ;;
			esac
		fi
		if [ "$DRY" = 1 ]; then
			echo "[dry-run] cp -a $dest $dest.bak"
		else
			run cp -a "$dest" "$dest.bak"
			echo "  > backed up $dest -> $dest.bak"
		fi
	fi
	run install -m"$mode" "$src" "$dest"
}

need() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1 (install it first)"; }

main() {
	local arg user_home user_group dest c b p
	for arg in "$@"; do
		case "$arg" in
		--dry-run) DRY=1 ;;
		--yes|-y) ASSUME_YES=1 ;;
		-h|--help) sed -n '2,5p' "$0"; exit 0 ;;
		*) echo "unknown argument: $arg" >&2; exit 2 ;;
		esac
	done

	[ "${EUID:-$(id -u)}" -eq 0 ] || die "run with sudo: sudo $0"
	[ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ] \
		|| die "invoke via sudo from your normal user, not as root directly"
	user_home=$(getent passwd "$SUDO_USER" | cut -d: -f6)
	[ -n "$user_home" ] && [ -d "$user_home" ] \
		|| die "cannot resolve home directory for $SUDO_USER"
	user_group=$(id -gn "$SUDO_USER")

	for c in cc make pkg-config node tic xsetroot xprop picom; do need "$c"; done
	pkg-config --exists x11 xft fontconfig freetype2 \
		|| die "missing dev headers: libX11/libXft/fontconfig/freetype2"

	echo "==> building dwm/st/dmenu as $SUDO_USER"
	for p in dwm st dmenu; do
		echo "  - $p"
		as_user make -C "$ROOT/$p" clean
		as_user make -C "$ROOT/$p"
	done

	echo "==> installing binaries to $PREFIX/bin"
	run install -d "$PREFIX/bin"
	run install -m755 "$ROOT/dwm/dwm" "$PREFIX/bin/dwm"
	run install -m755 "$ROOT/st/st" "$PREFIX/bin/st"
	run install -m755 "$ROOT/dmenu/dmenu" "$PREFIX/bin/dmenu"
	run tic -sx "$ROOT/st/st.info"

	echo "==> installing wall-monet for $SUDO_USER"
	dest="$user_home/.local/share/wall-monet"
	run install -d "$dest"
	if [ "$DRY" = 1 ]; then
		echo "[dry-run] cp -a $ROOT/wall-monet/. $dest/"
		echo "[dry-run] symlink wall-monet/check-palette/monet-apply/dmenu_palette in $user_home/.local/bin"
	else
		cp -a "$ROOT/wall-monet/." "$dest/"
		install -d "$user_home/.local/bin"
		for b in wall-monet check-palette monet-apply dmenu_palette; do
			ln -sf "$dest/bin/$b" "$user_home/.local/bin/$b"
		done
		install -m755 "$ROOT/scripts/vol" "$user_home/.local/bin/vol"
		chown -R "$SUDO_USER:$user_group" "$dest" "$user_home/.local/bin"
	fi

	echo "==> installing user configs for $SUDO_USER"
	run install -d "$user_home/.config/dwm" "$user_home/.config/picom"
	install_config "$ROOT/scripts/statusbar.sh" "$user_home/.config/dwm/statusbar.sh" 755
	install_config "$ROOT/scripts/shell-rc-monet.sh" "$user_home/.config/shell-rc-monet.sh" 755
	install_config "$ROOT/config/picom.conf" "$user_home/.config/picom/picom.conf" 644
	if [ -f "$ROOT/config/picom_toggle.sh" ]; then
		install_config "$ROOT/config/picom_toggle.sh" "$user_home/.config/picom/picom_toggle.sh" 755
	fi
	if [ "$DRY" = 0 ]; then
		chown -R "$SUDO_USER:$user_group" \
			"$user_home/.config/dwm" "$user_home/.config/picom" "$user_home/.config/shell-rc-monet.sh"
	fi

	cat <<EOF

done.

next:
  - restart dwm
  - pkill -x picom; picom --config "$user_home/.config/picom/picom.conf" >/dev/null 2>&1 &
  - wall-monet --current        # generate the palette (or wait for a wallpaper change)
  - make sure $user_home/.local/bin is in PATH
EOF
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	main "$@"
fi
