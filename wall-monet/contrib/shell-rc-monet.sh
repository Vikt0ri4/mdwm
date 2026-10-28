# shell-rc-monet.sh — 让新开的 st 窗口一启动就是莫奈配色
#
# 用法:在你的 ~/.zshrc 或 ~/.bashrc 里加一行
#     [ -r ~/.config/monet/shell-rc-monet.sh ] && . ~/.config/monet/shell-rc-monet.sh
# (或者直接 source 仓库里的 contrib/shell-rc-monet.sh)
#
# 原理:st 不支持 Xresources,但支持 OSC 4/10/11/12 运行时改色。shell 的 stdout
# 就是 st 的 pty,所以直接在启动时把序列打出去,st 就会照做并整屏重绘。
#
# 只在 TERM=st-256color 时生效 —— 否则从别的终端(ssh、Firefox 里的终端面板)
# 打开 shell 也会被改色。

_monet_apply_osc() {
  case "${TERM:-}" in
    st-256color) ;;
    *) return 0 ;;
  esac

  local palette="${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette"
  [ -r "$palette" ] || return 0

  local seq
  seq=$(awk -F= '
    /^#/ || NF != 2 { next }
    $2 !~ /^#[0-9a-fA-F]{6}$/ { next }
    $1 ~ /^st_color[0-9]+$/ { pal[substr($1, 9)] = $2; next }
    $1 == "st_fg"     { fg = $2; next }
    $1 == "st_bg"     { bg = $2; next }
    $1 == "st_cursor" { cs = $2; next }
    END {
      for (i = 0; i < 16; i++) if (i in pal) printf "\033]4;%d;%s\007", i, pal[i]
      if (fg != "") printf "\033]10;%s\007", fg
      if (bg != "") printf "\033]11;%s\007", bg
      if (cs != "") printf "\033]12;%s\007", cs
    }
  ' "$palette")

  [ -n "$seq" ] && printf '%s' "$seq"
  unset palette seq
}

_monet_apply_osc
unset -f _monet_apply_osc 2>/dev/null || true
