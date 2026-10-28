#!/usr/bin/env bash
# ============================================================================
#  picom_toggle.sh —— 全屏时让合成器让路, 窗口模式恢复全特效
#
#  判定(TRIGGER):
#    any      (默认) 桌面上只要存在任何全屏窗口 → 走全屏策略。
#             你在别的窗口聊天/查攻略时, picom 不会被拉回来
#    focused  只有当前焦点窗口全屏才算全屏(旧的"焦点"语义)
#
#  动作(MODE):
#    kill     (默认) 直接杀掉 picom, 延迟最低
#    minimal  保留 picom 但关掉全部特效(阴影/模糊/淡入淡出/透明度/圆角)
#    unredir  不动 picom, 交给它的 unredir-if-possible
#
#  用法:  picom_toggle.sh [--status | --once | --help]
#  信号:  kill -USR1 <pid>  暂停接管(恢复 picom 且不再自动杀; 调游戏/录屏时用)
#         kill -USR2 <pid>  恢复接管
#         kill -HUP  <pid>  立即重新判定
#
#  环境变量:
#    PICOM_TOGGLE_MODE=kill|minimal|unredir       默认 kill
#    PICOM_TOGGLE_TRIGGER=any|focused             默认 any
#    PICOM_TOGGLE_CLASSES="osu! ..."              白名单(空格分隔)。命中且窗口
#        尺寸正好是一块显示器的分辨率 → 当全屏处理。用于 wine/无边框全屏
#        这类不设 EWMH 全屏属性的游戏。留空 = 只认 EWMH 全屏
#    PICOM_BIN / PICOM_PROC / PICOM_CONF
#    PICOM_TOGGLE_LOG=/tmp/picom_toggle.log
#    POLL_INTERVAL=0.4   兜底轮询间隔秒
#    SCAN_MS=1000        全量扫描间隔毫秒(any 模式)
#    STABLE_MS=300       状态需稳定多久才动作, 防属性抖动
#    COOLDOWN_MS=1500    每次杀/启 picom 后的冷静期, 防自激振荡
#    REVIVE_SECS=8       picom 被外部杀掉后隔多久自愈
# ============================================================================

set -uo pipefail

# ------------------------------- 配置 ---------------------------------------
MODE="${PICOM_TOGGLE_MODE:-kill}"
TRIGGER="${PICOM_TOGGLE_TRIGGER:-any}"
WATCH_CLASSES="${PICOM_TOGGLE_CLASSES:-osu!}"

PICOM_BIN="${PICOM_BIN:-picom}"
PICOM_PROC="${PICOM_PROC:-$(basename -- "$PICOM_BIN")}"
POLL_INTERVAL="${POLL_INTERVAL:-0.4}"
SCAN_MS="${SCAN_MS:-1000}"
STABLE_MS="${STABLE_MS:-300}"
COOLDOWN_MS="${COOLDOWN_MS:-1500}"
REVIVE_SECS="${REVIVE_SECS:-8}"
DEATH_WINDOW="${DEATH_WINDOW:-3}"
BACKOFF_BASE="${BACKOFF_BASE:-5}"
MAX_BACKOFF="${MAX_BACKOFF:-120}"
LOG_FILE="${PICOM_TOGGLE_LOG:-/tmp/picom_toggle.log}"
LOG_MAX_BYTES=$((256 * 1024))

RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/picom_toggle-$(id -u)"
mkdir -p "$RUNTIME_DIR" 2>/dev/null && chmod 700 "$RUNTIME_DIR" 2>/dev/null

PICOM_OUT="$RUNTIME_DIR/picom.out"
MINIMAL_CONF="$RUNTIME_DIR/picom-minimal.conf"
EVENTS_FIFO="$RUNTIME_DIR/events.fifo"
LOCK_FILE="$RUNTIME_DIR/picom_toggle.lock"
SUSPEND_FLAG="$RUNTIME_DIR/suspended"

# ------------------------------ 状态变量 ------------------------------------
ACTIVE_WIN=""
FOCUS_PID=""
STATE_PID=""
STATE_WIN=""
EVENTS_FD=3
FAILS=0
NEXT_TRY=0
STARTED_OK=1        # 最近一次启动后是否被看到活着
SEEN_ALIVE=0        # 是否曾经见过 picom 在跑(区分"没起来"和"起来后又死了")
WE_KILLED_PICOM=0
DEATH_TS=""         # 非本脚本造成的消失时间
SUSPENDED=0
FS_WIN=""           # 当前认作全屏的窗口
SCAN_NEXT=0
LAST_SCAN_RESULT="windowed"
PENDING_STATE=""
PENDING_SINCE=0
APPLIED_STATE=""
LAST_ACTION_MS=0
MONITOR_MODES=" "

# ------------------------------- 工具 ---------------------------------------
log() {
  [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$LOG_MAX_BYTES" ] &&
    tail -n 500 "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null &&
    mv -f "$LOG_FILE.tmp" "$LOG_FILE" 2>/dev/null
  printf '%s - %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_FILE"
}

die() { log "$*"; echo "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# 毫秒时间戳, 不 fork(EPOCHREALTIME 由 bash 自己维护)
now_ms() { local t=${EPOCHREALTIME/./}; printf '%s\n' "${t:0:13}"; }

find_conf() {
  local c
  for c in "${PICOM_CONF:-}" "${XDG_CONFIG_HOME:-$HOME/.config}/picom/picom.conf" \
           "$HOME/.config/picom.conf" "/etc/picom.conf"; do
    [ -n "$c" ] && [ -r "$c" ] && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

# ---------------------------- picom 进程探测 --------------------------------
picom_pid() { pgrep -x -- "$PICOM_PROC" 2>/dev/null | head -n1; }
picom_running() { [ -n "$(picom_pid)" ]; }

running_profile() {
  local pid
  pid=$(picom_pid) || { echo none; return; }
  if tr '\0' '\n' <"/proc/$pid/cmdline" 2>/dev/null | grep -Fxq -- "$MINIMAL_CONF"; then
    echo minimal
  else
    echo full
  fi
}

read_active_win() {
  local line
  line=$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null) || return 1
  printf '%s\n' "${line##* }"
}

# ------------------------- 显示器分辨率(xrandr 缺失时的兜底) ----------------
monitor_modes_init() {
  local s m
  MONITOR_MODES=" "
  for s in /sys/class/drm/card*-*/; do
    [ -r "$s/status" ] || continue
    [ "$(cat "$s/status" 2>/dev/null)" = connected ] || continue
    m=$(head -n1 "$s/modes" 2>/dev/null)
    [[ "$m" =~ ^[0-9]+x[0-9]+$ ]] && MONITOR_MODES="$MONITOR_MODES$m "
  done
}

cover_monitor() {   # $1=窗口; 尺寸正好等于某块显示器的分辨率 → 当作铺满
  local geo w h
  [ -n "${MONITOR_MODES// /}" ] || return 1
  geo=$(xwininfo -id "$1" 2>/dev/null) || return 1
  w=$(printf '%s\n' "$geo" | awk '/Width:/{print $NF; exit}')
  h=$(printf '%s\n' "$geo" | awk '/Height:/{print $NF; exit}')
  [ -n "$w" ] && [ -n "$h" ] || return 1
  case "$MONITOR_MODES" in *" ${w}x${h} "*) return 0 ;; esac
  return 1
}

# ---------------------------- 全屏判定 --------------------------------------
window_is_fullscreen() {   # $1 = 窗口 id
  local w="${1:-}" props cls
  case "$w" in 0x0|"") return 1 ;; esac
  [[ "$w" =~ ^0x[0-9a-fA-F]+$ ]] || return 1
  props=$(xprop -id "$w" WM_CLASS _NET_WM_STATE 2>/dev/null) || return 1
  case "$props" in *_NET_WM_STATE_FULLSCREEN*) return 0 ;; esac
  # 白名单兜底: wine/无边框全屏的游戏常常不设 EWMH 全屏属性
  [ -n "$WATCH_CLASSES" ] || return 1
  cls=$(printf '%s\n' "$props" | awk '/WM_CLASS/{print; exit}')
  [ -n "$cls" ] || return 1
  local c
  for c in $WATCH_CLASSES; do
    case "$cls" in
      *"\"$c\""*) cover_monitor "$w" && return 0 ;;
    esac
  done
  return 1
}

list_fullscreen() {        # 打印所有全屏窗口 "0x.. class"
  local w
  for w in $(xprop -root _NET_CLIENT_LIST 2>/dev/null | sed 's/.*# //; s/,/ /g'); do
    window_is_fullscreen "$w" || continue
    printf '%s %s\n' "$w" "$(xprop -id "$w" WM_CLASS 2>/dev/null | sed 's/.*= //')"
  done
  window_is_fullscreen "$ACTIVE_WIN" &&
    printf '%s %s\n' "$ACTIVE_WIN" "$(xprop -id "$ACTIVE_WIN" WM_CLASS 2>/dev/null | sed 's/.*= //')"
}

# 输出 fullscreen / windowed
compute_fullscreen() {
  local now w
  if [ "$TRIGGER" = focused ]; then
    window_is_fullscreen "$ACTIVE_WIN" && echo fullscreen || echo windowed
    return 0
  fi
  # 先问上次命中的那个窗口(1 次 fork), 它还是全屏就直接返回
  if [ -n "$FS_WIN" ] && window_is_fullscreen "$FS_WIN"; then
    echo fullscreen; return 0
  fi
  if [ -n "$FS_WIN" ]; then FS_WIN=""; SCAN_NEXT=0; fi   # 它已经不是全屏了

  now=$(now_ms)
  if [ "$now" -lt "$SCAN_NEXT" ]; then echo "$LAST_SCAN_RESULT"; return 0; fi
  SCAN_NEXT=$(( now + SCAN_MS ))

  for w in $(xprop -root _NET_CLIENT_LIST 2>/dev/null | sed 's/.*# //; s/,/ /g'); do
    if window_is_fullscreen "$w"; then
      FS_WIN="$w"; LAST_SCAN_RESULT="fullscreen"; echo fullscreen; return 0
    fi
  done
  LAST_SCAN_RESULT="windowed"
  echo windowed
}

# ------------------------------- 启动/停止 ----------------------------------
gen_minimal_conf() {
  local src="$1"
  {
    printf '# [auto-generated by picom_toggle.sh] 零特效合成, 不要手改\n'
    printf '@include "%s"\n' "$src"
    cat <<'EOF'
shadow = false;
fading = false;
blur-background = false;
corner-radius = 0;
detect-rounded-corners = false;
detect-client-opacity = false;
detect-transient = false;
detect-client-leader = false;
mark-wmwin-focused = false;
mark-ovredir-focused = false;
use-damage = true;
unredir-if-possible = true;
# 主配置用了 rules,旧式选项会被忽略;这里用最后一条 rules 覆盖全部窗口的"特效开关"
# 不要写 opacity=1:picom 会用 opacity 蒙版接管 bar 的 ARGB alpha,bar 会变暗。
# 非 bar 窗口的 0.90 不透明度照旧(来自主配置),对性能没有影响。
rules = ( { shadow = false; blur-background = false; corner-radius = 0; fade = false; } );
EOF
  } >"$MINIMAL_CONF"
}

start_picom() {
  local prof="$1" conf="" out_size
  [ "$prof" = minimal ] && conf="$MINIMAL_CONF" || conf="$FULL_CONF"
  out_size=$(stat -c%s "$PICOM_OUT" 2>/dev/null || echo 0)
  [ "$out_size" -gt 65536 ] && : >"$PICOM_OUT"

  if [ -n "$conf" ]; then
    setsid "$PICOM_BIN" --config "$conf" </dev/null >>"$PICOM_OUT" 2>&1 3>&- 9>&- &
  else
    setsid "$PICOM_BIN" </dev/null >>"$PICOM_OUT" 2>&1 3>&- 9>&- &
  fi
  STARTED_OK=0
  WE_KILLED_PICOM=0
  DEATH_TS=""
  LAST_ACTION_MS=$(now_ms)
  log "启动 picom [$prof] ${conf:+(config: $conf)}"
}

kill_picom() {
  picom_running || return 0
  pkill -x -- "$PICOM_PROC" 2>/dev/null
  local i
  for i in $(seq 1 40); do picom_running || { WE_KILLED_PICOM=1; LAST_ACTION_MS=$(now_ms); return 0; }; sleep 0.05; done
  log "picom 不响应 TERM, 发送 SIGKILL"
  pkill -KILL -x -- "$PICOM_PROC" 2>/dev/null
  for i in $(seq 1 20); do picom_running || { WE_KILLED_PICOM=1; LAST_ACTION_MS=$(now_ms); return 0; }; sleep 0.05; done
  log "警告: picom 依然无法结束"
  return 1
}

# 每轮观察一次 picom 死没死, 维护"活着/被谁杀掉"的记账
note_picom_health() {
  if picom_running; then
    STARTED_OK=1; SEEN_ALIVE=1; FAILS=0; NEXT_TRY=0; DEATH_TS=""
  fi
}

ensure_picom() {
  local want="$1" now_s prof
  if picom_running; then
    prof=$(running_profile)
    WE_KILLED_PICOM=0
    [ "$prof" = "$want" ] && return 0
    log "切换 picom 配置: $prof → $want"
    kill_picom
    start_picom "$want"
    return 0
  fi

  now_s=$(date +%s)
  # 不是我们杀的却没了(手动 killall / 崩溃) → 先等 REVIVE_SECS 再自愈
  if [ "$WE_KILLED_PICOM" -eq 0 ] && [ "$SEEN_ALIVE" -eq 1 ] && [ -z "$DEATH_TS" ]; then
    DEATH_TS=$now_s
    log "picom 不在了(不是本脚本杀的), ${REVIVE_SECS}s 后自愈; 想让它一直关着: kill -USR1 $(cat "$RUNTIME_DIR/pid" 2>/dev/null)"
  fi
  if [ -n "$DEATH_TS" ] && [ $(( now_s - DEATH_TS )) -lt "$REVIVE_SECS" ]; then
    return 1
  fi
  # 启动失败退避: 免得配置错一次就变成重启风暴
  if [ "$STARTED_OK" -eq 0 ]; then
    FAILS=$((FAILS + 1))
    STARTED_OK=1
    local wait=$((FAILS * BACKOFF_BASE)); [ "$wait" -gt "$MAX_BACKOFF" ] && wait=$MAX_BACKOFF
    NEXT_TRY=$((now_s + wait))
    log "picom 启动后立刻退出(连续第 ${FAILS} 次), ${wait}s 后重试; picom 最后输出: $(tail -n1 "$PICOM_OUT" 2>/dev/null | cut -c1-200)"
    return 1
  fi
  [ "$now_s" -lt "$NEXT_TRY" ] && return 1

  start_picom "$want"
}

# ------------------------------- 事件通道 -----------------------------------
open_events() {
  rm -f "$EVENTS_FIFO"
  mkfifo -m 600 "$EVENTS_FIFO" || die "无法创建事件通道 $EVENTS_FIFO"
  exec 3<>"$EVENTS_FIFO" || die "无法打开事件通道"
}

# 两路 xprop -spy 写同一个 FIFO: "F " 焦点变了, "S " 焦点窗口状态变了
spawn_focus_watcher() {
  [ -n "$FOCUS_PID" ] && kill "$FOCUS_PID" 2>/dev/null
  xprop -spy -root _NET_ACTIVE_WINDOW 2>/dev/null > >(sed -u 's/^/F /' >"$EVENTS_FIFO") &
  FOCUS_PID=$!
}

spawn_state_watcher() {
  local win="${1:-}"
  [ -n "$STATE_PID" ] && kill "$STATE_PID" 2>/dev/null
  STATE_PID=""; STATE_WIN=""
  case "$win" in 0x0|"") return 0 ;; esac
  [[ "$win" =~ ^0x[0-9a-fA-F]+$ ]] || return 0
  xprop -spy -id "$win" _NET_WM_STATE 2>/dev/null > >(sed -u 's/^/S /' >"$EVENTS_FIFO") &
  STATE_PID=$!
  STATE_WIN="$win"
}

spawn_all_watchers() {
  spawn_focus_watcher
  spawn_state_watcher "$ACTIVE_WIN"
}

x_alive() { xprop -root _NET_SUPPORTED >/dev/null 2>&1; }

# ------------------------------- 决策 ---------------------------------------
apply_state() {
  if [ "$1" = fullscreen ]; then
    case "$MODE" in
      kill)    if picom_running; then log "全屏 → 停止 picom"; kill_picom; fi ;;
      minimal) ensure_picom minimal ;;
      *)       ensure_picom full ;;
    esac
  else
    ensure_picom full
  fi
}

decide_and_apply() {
  local fs now

  if [ -e "$SUSPEND_FLAG" ]; then
    if [ "$SUSPENDED" -eq 0 ]; then
      SUSPENDED=1
      log "已暂停接管, 恢复 picom 并不再干预"
      ensure_picom full
      APPLIED_STATE="suspended"; PENDING_STATE="suspended"
    fi
    return 0
  fi
  if [ "$SUSPENDED" -eq 1 ]; then
    SUSPENDED=0
    PENDING_SINCE=0
    log "恢复接管"
  fi

  fs=$(compute_fullscreen)
  now=$(now_ms)
  if [ "$fs" != "$PENDING_STATE" ]; then
    PENDING_STATE="$fs"
    PENDING_SINCE=$now
  fi

  if [ "$fs" = "$APPLIED_STATE" ]; then
    # 状态没变也要看一眼 picom 还在不在(崩溃/被手动杀掉的兜底)
    [ "$fs" = windowed ] && ensure_picom full
    return 0
  fi

  # 迟滞: 状态得稳定 STABLE_MS 才动手, 避免属性抖动导致反复杀/启
  [ $(( now - PENDING_SINCE )) -lt "$STABLE_MS" ] && return 0
  # 冷静期: 刚杀/启过 picom 时先别急, 免得和"杀 picom 引起的状态抖动"互相激
  [ $(( now - LAST_ACTION_MS )) -lt "$COOLDOWN_MS" ] && return 0

  log "状态切换: ${APPLIED_STATE:-初始} → $fs"
  apply_state "$fs"
  APPLIED_STATE="$fs"
  LAST_ACTION_MS=$(now_ms)
}

# ------------------------------- 清理 ---------------------------------------
cleanup() {
  trap - EXIT INT TERM
  [ -n "$FOCUS_PID" ] && kill "$FOCUS_PID" 2>/dev/null
  [ -n "$STATE_PID" ] && kill "$STATE_PID" 2>/dev/null
  exec 3>&- 2>/dev/null
  rm -f "$EVENTS_FIFO" 2>/dev/null
  if [ "$WE_KILLED_PICOM" -eq 1 ] && ! picom_running; then
    log "脚本退出, 把 picom 还回去"
    WE_KILLED_PICOM=0
    start_picom full
  fi
  log "Picom 切换脚本退出。"
  exit 0
}

# ------------------------------- 状态输出 -----------------------------------
print_status() {
  local pid fslist
  pid=$(picom_pid)
  ACTIVE_WIN=$(read_active_win)
  fslist=$(list_fullscreen | tr '\n' ';')
  printf '模式/触发   : %s / %s\n' "$MODE" "$TRIGGER"
  if [ -n "$pid" ]; then
    printf 'picom       : 运行中 pid=%s 配置=%s\n' "$pid" "$(running_profile)"
  else
    printf 'picom       : 未运行\n'
  fi
  printf '全屏窗口    : %s\n' "${fslist:-无}"
  printf '焦点窗口    : %s %s\n' "${ACTIVE_WIN:-?}" "$(xprop -id "$ACTIVE_WIN" WM_CLASS 2>/dev/null | sed 's/.*= //')"
  printf '判定结果    : %s\n' "$(compute_fullscreen)"
  printf '白名单类    : %s\n' "${WATCH_CLASSES:-（空）}"
  printf '配置文件    : %s\n' "${FULL_CONF:-未找到}"
  printf '日志        : %s\n' "$LOG_FILE"
  printf '接管状态    : %s\n' "$([ -e "$SUSPEND_FLAG" ] && echo '已暂停(USR1/USR2 切换)' || echo '运行中')"
}

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

# ------------------------------- 主流程 -------------------------------------
main() {
  local arg="${1:-}"
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --status)  FULL_CONF=$(find_conf)
               monitor_modes_init
               print_status; exit 0 ;;
    --once)    FULL_CONF=$(find_conf) || die "找不到 picom 配置文件"
               monitor_modes_init
               ACTIVE_WIN=$(read_active_win)
               apply_state "$(compute_fullscreen)"; exit 0 ;;
    "")        ;;
    *) echo "未知参数: $arg (--help)" >&2; exit 2 ;;
  esac

  FULL_CONF=$(find_conf) || die "找不到 picom 配置文件! 检查 ~/.config/picom/picom.conf 或设置 PICOM_CONF"

  # 单实例: 防止 autostart 重复拉起, 两个守护互相打架
  exec 9>"$LOCK_FILE" || die "无法打开锁文件"
  if ! flock -n 9; then
    echo "picom_toggle.sh 已在运行, 本次退出。" >&2
    exit 0
  fi
  printf '%s\n' "$$" >"$RUNTIME_DIR/pid"

  gen_minimal_conf "$FULL_CONF"
  monitor_modes_init

  trap cleanup EXIT INT TERM
  trap 'log "收到 HUP, 重新判定"' HUP
  trap 'touch "$SUSPEND_FLAG"; log "收到 USR1, 暂停接管"' USR1
  trap 'rm -f "$SUSPEND_FLAG"; log "收到 USR2, 恢复接管"' USR2

  log "Picom 切换脚本启动。模式=$MODE 触发=$TRIGGER 白名单=${WATCH_CLASSES:-无} 配置=$FULL_CONF pid=$$"

  open_events
  ACTIVE_WIN=$(read_active_win)
  spawn_all_watchers
  decide_and_apply

  local line rc
  while :; do
    line=""
    read -t "$POLL_INTERVAL" -r -u "$EVENTS_FD" line; rc=$?
    if [ "$rc" -eq 0 ]; then
      case "$line" in
        "F "*)  ACTIVE_WIN="${line##* }"
                spawn_state_watcher "$ACTIVE_WIN"
                SCAN_NEXT=0 ;;                      # 焦点变了, 立刻重扫
        "S "*)  SCAN_NEXT=0 ;;
        *)      ACTIVE_WIN=$(read_active_win) ;;
      esac
    elif [ "$rc" -gt 128 ]; then
      ACTIVE_WIN=$(read_active_win)                 # 超时: 兜底轮询
    else
      if ! x_alive; then log "X 连接已断开, 退出"; break; fi
      log "事件通道异常, 重建监听"
      spawn_all_watchers
      continue
    fi

    if [ -n "$FOCUS_PID" ] && ! kill -0 "$FOCUS_PID" 2>/dev/null; then
      if ! x_alive; then log "X 连接已断开, 退出"; break; fi
      log "焦点监听已退出, 重启"
      spawn_focus_watcher
    fi
    if [ -n "$STATE_PID" ] && ! kill -0 "$STATE_PID" 2>/dev/null &&
       [ -n "$ACTIVE_WIN" ] && [ "$STATE_WIN" != "$ACTIVE_WIN" ]; then
      spawn_state_watcher "$ACTIVE_WIN"
    fi

    note_picom_health
    decide_and_apply
  done
  exit 0
}

main "$@"
