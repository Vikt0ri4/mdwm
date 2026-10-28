#!/bin/bash

# color — 由 wall-monet 生成,每轮循环重读(换壁纸后立刻跟随)
PALETTE_FILE="${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette"
COLOR_CPU="#FF6B6B"
COLOR_MEM="#4ECDC4"
COLOR_DISK="#FFD166"
COLOR_NET="#06D6A0"
COLOR_VOL="#118AB2"
COLOR_TIME="#9D4EDD"
COLOR_TEXT="#d8dee9"   # 兜底色:调色板缺失时用编译期 nord 的前景色(原来的 #00263e 在深色 bar 上几乎看不见)

load_palette() {
  [[ -r "$PALETTE_FILE" ]] || return 0
  local k v
  while IFS='=' read -r k v; do
    [[ "$v" =~ ^#[0-9a-fA-F]{6}$ ]] || continue
    case "$k" in
      stat_cpu) COLOR_CPU="$v" ;;
      stat_mem) COLOR_MEM="$v" ;;
      stat_disk) COLOR_DISK="$v" ;;
      stat_net) COLOR_NET="$v" ;;
      stat_vol) COLOR_VOL="$v" ;;
      stat_time) COLOR_TIME="$v" ;;
      tag_sel_fg) COLOR_TEXT="$v" ;;
    esac
  done <"$PALETTE_FILE"
}

# cache (per-instance dir so an old instance's cleanup can't wipe ours)
CACHE_DIR="/tmp/dwm_status_cache_$(whoami)_$$"
mkdir -p "$CACHE_DIR"
chmod 700 "$CACHE_DIR" 2>/dev/null

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

# cpu
get_cpu_usage() {
  local current_time=$(date +%s)
  local last_check=$(cat "$CACHE_DIR/last_cpu_check" 2>/dev/null || echo "0")
  local cache_file="$CACHE_DIR/cpu_usage"

  # If the cache expires, recalculate it.
  if ((current_time - last_check >= 1)); then
    # Read the statistical information of all CPU cores
    local cpu_lines=$(grep '^cpu[0-9]' /proc/stat)

    local total_user=0
    local total_nice=0
    local total_system=0
    local total_idle=0
    local total_iowait=0
    local total_irq=0
    local total_softirq=0
    local total_steal=0

    # Calculate the total sum of all CPU cores
    while IFS= read -r line; do
      local user=$(echo $line | awk '{print $2}')
      local nice=$(echo $line | awk '{print $3}')
      local system=$(echo $line | awk '{print $4}')
      local idle=$(echo $line | awk '{print $5}')
      local iowait=$(echo $line | awk '{print $6}')
      local irq=$(echo $line | awk '{print $7}')
      local softirq=$(echo $line | awk '{print $8}')
      local steal=$(echo $line | awk '{print $9}')

      total_user=$((total_user + user))
      total_nice=$((total_nice + nice))
      total_system=$((total_system + system))
      total_idle=$((total_idle + idle))
      total_iowait=$((total_iowait + iowait))
      total_irq=$((total_irq + irq))
      total_softirq=$((total_softirq + softirq))
      total_steal=$((total_steal + steal))
    done <<<"$cpu_lines"

    # Calculate the total time and idle time
    local total=$((total_user + total_nice + total_system + total_idle + \
      total_iowait + total_irq + total_softirq + total_steal))
    local idle_total=$((total_idle + total_iowait))

    # Read the previous value
    local last_total=$(cat "$CACHE_DIR/cpu_total" 2>/dev/null || echo "$total")
    local last_idle=$(cat "$CACHE_DIR/cpu_idle" 2>/dev/null || echo "$idle_total")

    # Calculate usage rate
    local diff_total=$((total - last_total))
    local diff_idle=$((idle_total - last_idle))

    local usage=0
    if [[ $diff_total -gt 0 ]]; then
      usage=$((100 * (diff_total - diff_idle) / diff_total))
    fi

    # Limit the usage rate to be between 0 and 100.
    if [[ $usage -gt 100 ]]; then
      usage=100
    elif [[ $usage -lt 0 ]]; then
      usage=0
    fi

    # Save the current value and time
    echo "$usage" >"$cache_file"
    echo "$total" >"$CACHE_DIR/cpu_total"
    echo "$idle_total" >"$CACHE_DIR/cpu_idle"
    echo "$current_time" >"$CACHE_DIR/last_cpu_check"
  fi

  cat "$cache_file"
}

# mem
get_mem_usage() {
  local current_time=$(date +%s)
  local last_check=$(cat "$CACHE_DIR/last_mem_check" 2>/dev/null || echo "0")
  local cache_file="$CACHE_DIR/mem_usage"

  if ((current_time - last_check >= SLOW_INTERVAL)); then
    local meminfo=$(</proc/meminfo)
    local mem_total=$(echo "$meminfo" | grep MemTotal | awk '{print $2}')
    local mem_free=$(echo "$meminfo" | grep MemFree | awk '{print $2}')
    local buffers=$(echo "$meminfo" | grep Buffers | awk '{print $2}')
    local cached=$(echo "$meminfo" | grep ^Cached: | awk '{print $2}')

    local mem_used=$((mem_total - mem_free - buffers - cached))
    if (( mem_used < 0 )); then
      mem_used=0
    fi
    local usage=$((100 * mem_used / mem_total))
    if (( usage > 100 )); then
      usage=100
    fi

    echo "$usage" >"$cache_file"
    echo "$current_time" >"$CACHE_DIR/last_mem_check"
  fi

  cat "$cache_file"
}

# disk
get_disk_usage() {
  local current_time=$(date +%s)
  local last_check=$(cat "$CACHE_DIR/last_disk_check" 2>/dev/null || echo "0")
  local cache_file="$CACHE_DIR/disk_usage"

  if ((current_time - last_check >= SLOW_INTERVAL)); then
    local usage=$(df -h / --output=pcent | tail -1 | tr -d '% ')
    echo "$usage" >"$cache_file"
    echo "$current_time" >"$CACHE_DIR/last_disk_check"
  fi

  cat "$cache_file"
}

# network
get_network_info() {
  local current_time=$(date +%s)
  local last_check=$(cat "$CACHE_DIR/last_net_check" 2>/dev/null || echo "0")

  local active_iface=""

  for iface in $(ls /sys/class/net/ | grep -E '^wlan|^wlp'); do
    if [[ -d "/sys/class/net/$iface/wireless" ]] && [[ $(cat "/sys/class/net/$iface/operstate") == "up" ]]; then
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

  local iface_type=""
  if [[ -d "/sys/class/net/$active_iface/wireless" ]]; then
    iface_type="󰤨"
  else
    iface_type="󰈀"
  fi

  local rx_bytes=$(cat "/sys/class/net/$active_iface/statistics/rx_bytes" 2>/dev/null || echo "0")
  local tx_bytes=$(cat "/sys/class/net/$active_iface/statistics/tx_bytes" 2>/dev/null || echo "0")

  local last_rx=$(cat "$CACHE_DIR/net_rx" 2>/dev/null || echo "$rx_bytes")
  local last_tx=$(cat "$CACHE_DIR/net_tx" 2>/dev/null || echo "$tx_bytes")
  local last_time=$(cat "$CACHE_DIR/last_net_time" 2>/dev/null || echo "$current_time")

  local time_diff=$((current_time - last_time))
  local rx_speed=0
  local tx_speed=0

  if [[ $time_diff -gt 0 ]]; then
    rx_speed=$(((rx_bytes - last_rx) / time_diff))
    tx_speed=$(((tx_bytes - last_tx) / time_diff))
  fi

  if (( rx_speed < 0 )); then rx_speed=0; fi
  if (( tx_speed < 0 )); then tx_speed=0; fi

  local rx_human=""
  local tx_human=""

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

# alsa_vol
get_volume() {
  # bar 的 0-100 是可闻刻度：0 静音，1 = Master raw 50%，100 = raw 100%
  if [[ -x "$HOME/.local/bin/vol" ]]; then
    local ui
    ui=$("$HOME/.local/bin/vol" get 2>/dev/null)
    if [[ "${ui:-0}" -eq 0 ]]; then
      echo "󰖁 0%"
    else
      echo "󰕾 ${ui}%"
    fi
    return
  fi

  # 兜底：PipeWire
  if command -v wpctl >/dev/null 2>&1; then
    out=$(wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null)
    if [[ -n "$out" ]]; then
      if [[ "$out" == *MUTED* ]]; then
        echo "󰖁 Mute"
        return
      fi
      pct=$(awk '{printf "%d", $2 * 100}' <<<"$out")
      echo "󰕾 ${pct}%"
      return
    fi
  fi
  echo "󰖁 Mute"
}

# date
get_datetime() {
  echo "󰥔 $(date '+%Y-%m-%d %H:%M:%S')"
}

build_status_string() {
  local cpu_usage=$(get_cpu_usage)
  local mem_usage=$(get_mem_usage)
  local disk_usage=$(get_disk_usage)
  local network_info=$(get_network_info)
  local volume_info=$(get_volume)
  local datetime_info=$(get_datetime)

  printf ' ^c%s^^p^ cpu %s%% ^d^ ^c%s^^p^ mem %s%% ^d^ ^c%s^^p^ disk %s%% ^d^ ^c%s^^p^ %s ^d^ ^c%s^^p^ %s ^d^ ^c%s^^p^ %s ^d^' \
    "$COLOR_TEXT" "$cpu_usage" \
    "$COLOR_TEXT" "$mem_usage" \
    "$COLOR_TEXT" "$disk_usage" \
    "$COLOR_TEXT" "$network_info" \
    "$COLOR_TEXT" "$volume_info" \
    "$COLOR_TEXT" "$datetime_info"
}

# clean
cleanup() {
  rm -rf "$CACHE_DIR"
  exit 0
}

trap cleanup EXIT INT TERM

init_cache

while true; do
  # self-heal if the cache dir vanished (e.g. killed -9 then an old trap raced)
  if [[ ! -d "$CACHE_DIR" ]]; then
    mkdir -p "$CACHE_DIR" && chmod 700 "$CACHE_DIR" 2>/dev/null
    init_cache
  fi

  load_palette
  xsetroot -name "$(build_status_string)"

  sleep $SAMPLE_INTERVAL
done
