#!/bin/bash
# xsetroot status bar, recoloured from the wall-monet palette every tick.

PALETTE_FILE="${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette"
COLOR_CPU="#FF6B6B"
COLOR_MEM="#4ECDC4"
COLOR_DISK="#FFD166"
COLOR_NET="#06D6A0"
COLOR_VOL="#118AB2"
COLOR_TIME="#9D4EDD"
# Fallback text colour: the compiled-in nord foreground. The old #00263e was
# invisible on the dark bar.
COLOR_TEXT="#d8dee9"

# Print the recognised palette entries as key=value lines. Pure: no globals,
# no side effects, safe to source and test.
parse_palette() {
	local file=$1 k v
	[ -r "$file" ] || return 0
	while IFS='=' read -r k v; do
		case "$v" in
		\#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
		*) continue ;;
		esac
		case "$k" in
		stat_cpu|stat_mem|stat_disk|stat_net|stat_vol|stat_time|tag_sel_fg)
			printf '%s=%s\n' "$k" "$v" ;;
		esac
	done <"$file"
}

load_palette() {
	local k v
	while IFS='=' read -r k v; do
		case "$k" in
		stat_cpu) COLOR_CPU=$v ;;
		stat_mem) COLOR_MEM=$v ;;
		stat_disk) COLOR_DISK=$v ;;
		stat_net) COLOR_NET=$v ;;
		stat_vol) COLOR_VOL=$v ;;
		stat_time) COLOR_TIME=$v ;;
		tag_sel_fg) COLOR_TEXT=$v ;;
		esac
	done < <(parse_palette "$PALETTE_FILE")
}

SAMPLE_INTERVAL=1
SLOW_INTERVAL=5
LAST_SLOW_UPDATE=0

init_cache() {
	echo "0" >"$CACHE_DIR/cpu_usage"
	echo "0" >"$CACHE_DIR/cpu_total"
	echo "0" >"$CACHE_DIR/cpu_idle"
	echo "0" >"$CACHE_DIR/net_rx"
	echo "0" >"$CACHE_DIR/net_tx"
	echo "0" >"$CACHE_DIR/last_net_time"
	echo "0" >"$CACHE_DIR/last_cpu_check"
	echo "0" >"$CACHE_DIR/last_mem_check"
	echo "0" >"$CACHE_DIR/last_disk_check"
	echo "0" >"$CACHE_DIR/last_net_check"
}

get_cpu_usage() {
	local current_time last_check cache_file cpu_lines line user nice system idle
	local iowait irq softirq steal total_user=0 total_nice=0 total_system=0
	local total_idle=0 total_iowait=0 total_irq=0 total_softirq=0 total_steal=0
	local total idle_total last_total last_idle diff_total diff_idle usage=0

	current_time=$(date +%s)
	last_check=$(cat "$CACHE_DIR/last_cpu_check" 2>/dev/null || echo "0")
	cache_file="$CACHE_DIR/cpu_usage"

	if ((current_time - last_check >= 1)); then
		cpu_lines=$(grep '^cpu[0-9]' /proc/stat)
		while IFS= read -r line; do
			user=$(echo $line | awk '{print $2}')
			nice=$(echo $line | awk '{print $3}')
			system=$(echo $line | awk '{print $4}')
			idle=$(echo $line | awk '{print $5}')
			iowait=$(echo $line | awk '{print $6}')
			irq=$(echo $line | awk '{print $7}')
			softirq=$(echo $line | awk '{print $8}')
			steal=$(echo $line | awk '{print $9}')
			total_user=$((total_user + user))
			total_nice=$((total_nice + nice))
			total_system=$((total_system + system))
			total_idle=$((total_idle + idle))
			total_iowait=$((total_iowait + iowait))
			total_irq=$((total_irq + irq))
			total_softirq=$((total_softirq + softirq))
			total_steal=$((total_steal + steal))
		done <<<"$cpu_lines"

		total=$((total_user + total_nice + total_system + total_idle + \
			total_iowait + total_irq + total_softirq + total_steal))
		idle_total=$((total_idle + total_iowait))
		last_total=$(cat "$CACHE_DIR/cpu_total" 2>/dev/null || echo "$total")
		last_idle=$(cat "$CACHE_DIR/cpu_idle" 2>/dev/null || echo "$idle_total")
		diff_total=$((total - last_total))
		diff_idle=$((idle_total - last_idle))
		if [[ $diff_total -gt 0 ]]; then
			usage=$((100 * (diff_total - diff_idle) / diff_total))
		fi
		if [[ $usage -gt 100 ]]; then
			usage=100
		elif [[ $usage -lt 0 ]]; then
			usage=0
		fi
		echo "$usage" >"$cache_file"
		echo "$total" >"$CACHE_DIR/cpu_total"
		echo "$idle_total" >"$CACHE_DIR/cpu_idle"
		echo "$current_time" >"$CACHE_DIR/last_cpu_check"
	fi
	cat "$cache_file"
}

get_mem_usage() {
	local current_time last_check cache_file meminfo mem_total mem_free buffers cached
	local mem_used usage

	current_time=$(date +%s)
	last_check=$(cat "$CACHE_DIR/last_mem_check" 2>/dev/null || echo "0")
	cache_file="$CACHE_DIR/mem_usage"

	if ((current_time - last_check >= SLOW_INTERVAL)); then
		meminfo=$(</proc/meminfo)
		mem_total=$(echo "$meminfo" | grep MemTotal | awk '{print $2}')
		mem_free=$(echo "$meminfo" | grep MemFree | awk '{print $2}')
		buffers=$(echo "$meminfo" | grep Buffers | awk '{print $2}')
		cached=$(echo "$meminfo" | grep ^Cached: | awk '{print $2}')
		mem_used=$((mem_total - mem_free - buffers - cached))
		if ((mem_used < 0)); then
			mem_used=0
		fi
		usage=$((100 * mem_used / mem_total))
		if ((usage > 100)); then
			usage=100
		fi
		echo "$usage" >"$cache_file"
		echo "$current_time" >"$CACHE_DIR/last_mem_check"
	fi
	cat "$cache_file"
}

get_disk_usage() {
	local current_time last_check cache_file usage

	current_time=$(date +%s)
	last_check=$(cat "$CACHE_DIR/last_disk_check" 2>/dev/null || echo "0")
	cache_file="$CACHE_DIR/disk_usage"

	if ((current_time - last_check >= SLOW_INTERVAL)); then
		usage=$(df -h / --output=pcent | tail -1 | tr -d '% ')
		echo "$usage" >"$cache_file"
		echo "$current_time" >"$CACHE_DIR/last_disk_check"
	fi
	cat "$cache_file"
}

get_network_info() {
	local current_time last_check iface active_iface= rx_bytes tx_bytes
	local last_rx last_tx last_time time_diff rx_speed tx_speed rx_human tx_human
	local iface_type=

	current_time=$(date +%s)
	last_check=$(cat "$CACHE_DIR/last_net_check" 2>/dev/null || echo "0")

	for iface in $(ls /sys/class/net/ | grep -E '^wlan|^wlp'); do
		if [[ -d "/sys/class/net/$iface/wireless" ]] && \
			[[ $(cat "/sys/class/net/$iface/operstate") == "up" ]]; then
			active_iface="$iface"
			break
		fi
	done
	if [[ -z "$active_iface" ]]; then
		for iface in $(ls /sys/class/net/ | grep -E '^eth|^enp'); do
			if [[ $(cat "/sys/class/net/$iface/operstate") == "up" ]]; then
				active_iface="$iface"
				break
			fi
		done
	fi
	if [[ -z "$active_iface" ]]; then
		echo "󰤭 Disconnect"
		return
	fi

	if [[ -d "/sys/class/net/$active_iface/wireless" ]]; then
		iface_type="󰤨"
	else
		iface_type="󰈀"
	fi

	rx_bytes=$(cat "/sys/class/net/$active_iface/statistics/rx_bytes" 2>/dev/null || echo "0")
	tx_bytes=$(cat "/sys/class/net/$active_iface/statistics/tx_bytes" 2>/dev/null || echo "0")
	last_rx=$(cat "$CACHE_DIR/net_rx" 2>/dev/null || echo "$rx_bytes")
	last_tx=$(cat "$CACHE_DIR/net_tx" 2>/dev/null || echo "$tx_bytes")
	last_time=$(cat "$CACHE_DIR/last_net_time" 2>/dev/null || echo "$current_time")
	time_diff=$((current_time - last_time))
	rx_speed=0
	tx_speed=0
	if [[ $time_diff -gt 0 ]]; then
		rx_speed=$(((rx_bytes - last_rx) / time_diff))
		tx_speed=$(((tx_bytes - last_tx) / time_diff))
	fi
	if ((rx_speed < 0)); then rx_speed=0; fi
	if ((tx_speed < 0)); then tx_speed=0; fi

	if [[ $rx_speed -lt 1024 ]]; then
		rx_human="${rx_speed}B/s"
	elif [[ $rx_speed -lt 1048576 ]]; then
		rx_human="$((rx_speed / 1024))K/s"
	else
		rx_human="$((rx_speed / 1048576))M/s"
	fi
	if [[ $tx_speed -lt 1024 ]]; then
		tx_human="${tx_speed}B/s"
	elif [[ $tx_speed -lt 1048576 ]]; then
		tx_human="$((tx_speed / 1024))K/s"
	else
		tx_human="$((tx_speed / 1048576))M/s"
	fi

	echo "$rx_bytes" >"$CACHE_DIR/net_rx"
	echo "$tx_bytes" >"$CACHE_DIR/net_tx"
	echo "$current_time" >"$CACHE_DIR/last_net_time"
	echo "$current_time" >"$CACHE_DIR/last_net_check"
	echo "$iface_type $active_iface: ↑$tx_human ↓$rx_human"
}

get_volume() {
	local ui

	if [ -x "$HOME/.local/bin/vol" ]; then
		ui=$("$HOME/.local/bin/vol" get 2>/dev/null || true)
	else
		ui=0
	fi
	if [ -z "$ui" ] || [ "$ui" -eq 0 ] 2>/dev/null; then
		echo "󰖁 0%"
	else
		echo "󰕾 ${ui}%"
	fi
}

get_datetime() {
	echo "󰥔 $(date '+%Y-%m-%d %H:%M:%S')"
}

build_status_string() {
	local cpu_usage mem_usage disk_usage network_info volume_info datetime_info

	cpu_usage=$(get_cpu_usage)
	mem_usage=$(get_mem_usage)
	disk_usage=$(get_disk_usage)
	network_info=$(get_network_info)
	volume_info=$(get_volume)
	datetime_info=$(get_datetime)
	printf ' ^c%s^^p^ cpu %s%% ^d^ ^c%s^^p^ mem %s%% ^d^ ^c%s^^p^ disk %s%% ^d^ ^c%s^^p^ %s ^d^ ^c%s^^p^ %s ^d^ ^c%s^^p^ %s ^d^' \
		"$COLOR_TEXT" "$cpu_usage" \
		"$COLOR_TEXT" "$mem_usage" \
		"$COLOR_TEXT" "$disk_usage" \
		"$COLOR_TEXT" "$network_info" \
		"$COLOR_TEXT" "$volume_info" \
		"$COLOR_TEXT" "$datetime_info"
}

cleanup() {
	rm -rf "$CACHE_DIR"
	exit 0
}

main() {
	CACHE_DIR="/tmp/dwm_status_cache_$(whoami)_$$"
	mkdir -p "$CACHE_DIR"
	chmod 700 "$CACHE_DIR" 2>/dev/null
	trap cleanup EXIT INT TERM
	init_cache
	while true; do
		if [[ ! -d "$CACHE_DIR" ]]; then
			mkdir -p "$CACHE_DIR" && chmod 700 "$CACHE_DIR" 2>/dev/null
			init_cache
		fi
		load_palette
		xsetroot -name "$(build_status_string)"
		sleep "$SAMPLE_INTERVAL"
	done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	main "$@"
fi
