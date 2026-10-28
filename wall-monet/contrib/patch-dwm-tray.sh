#!/bin/sh
# 可选:让托盘胶囊真正透明(把 systray 窗口换成 ARGB 窗口)。
#
# 为什么单独一个脚本:换窗口 depth 是这套改动里唯一有运行时风险的一步 —— 实测在
# 某些环境会让 dwm 触发 X 错误。所以这里用临时错误处理器把这段包起来:任何 X 错误
# 都会被吞掉并回退成原来的不透明窗口,dwm 本体绝不受影响。
#
# 用法:sh patch-dwm-tray.sh [dwm 源码目录,默认 ~/dwm]
#       然后 cd <源码目录> && make && sudo make install,再重启 dwm
set -eu
dir=${1:-$HOME/dwm}
src=$dir/dwm.c
[ -f "$src" ] || { echo "找不到 $src" >&2; exit 1; }

if grep -qF 'monet: ARGB systray' "$src"; then
	echo "已经打过托盘补丁,跳过。"
	exit 0
fi
if [ "$(grep -cF 'systray->win = XCreateSimpleWindow(dpy, root, chipx, chipy, chipw, chiph, 0, 0, traypx);' "$src" || true)" -ne 1 ]; then
	echo "找不到预期的托盘窗口创建行,拒绝修改" >&2
	exit 1
fi

cp "$src" "$src.bak-tray"
perl -0pi -e 's{systray->win = XCreateSimpleWindow\(dpy, root, chipx, chipy, chipw, chiph, 0, 0, traypx\);}{/* monet: ARGB systray\n\t\t * Best effort: an ARGB window lets traypx\x27s alpha survive (on a depth-24\n\t\t * window the tray capsule stays opaque). Wrapped in an error trap because\n\t\t * changing the window depth is the one risky step here -- if the server\n\t\t * refuses for any reason we quietly fall back to the old opaque window\n\t\t * instead of taking dwm down. */\n\t\t{\n\t\t\tXErrorHandler oldh = XSetErrorHandler(monet_tray_xerror);\n\t\t\tmonet_tray_err = 0;\n\t\t\twa.background_pixel = traypx;\n\t\t\twa.border_pixel = 0;\n\t\t\twa.colormap = cmap;\n\t\t\tsystray->win = XCreateWindow(dpy, root, chipx, chipy, chipw, chiph, 0,\n\t\t\t                             depth, InputOutput, visual,\n\t\t\t                             CWBackPixel|CWBorderPixel|CWColormap, \&wa);\n\t\t\tXSync(dpy, False);\n\t\t\tXSetErrorHandler(oldh);\n\t\t\tif (monet_tray_err) {\n\t\t\t\tmonetlog("dwm: monet: ARGB 托盘窗口失败,回退为不透明\\\\n");\n\t\t\t\tsystray->win = XCreateSimpleWindow(dpy, root, chipx, chipy, chipw, chiph, 0, 0, traypx);\n\t\t\t}\n\t\t}}s' "$src"

# 错误处理器 + 标志
perl -0pi -e 's{^static Clr chipclr,}{static int monet_tray_err;\nstatic int monet_tray_xerror(Display *d, XErrorEvent *e) { (void)d; (void)e; monet_tray_err = 1; return 0; }\nstatic Clr chipclr,}m' "$src"

echo "已给托盘胶囊换成 ARGB 窗口(带错误捕获与回退,备份: $src.bak-tray)"
echo "接下来:cd $dir && make && sudo make install,然后重启 dwm"
