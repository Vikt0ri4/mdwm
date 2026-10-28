#!/bin/sh
# 让 bar 真的是 palette 里写的那个透明度,并让胶囊/托盘/选中 tag 形成层次。
#
# 四处改动(幂等,每处只在还没改过时才动手):
#   1. dwm.c  删掉 drawstatusbar() 里那次多余的背景填充 —— drawbar() 已经用同一个
#             基色方案填过整条 bar,再填一次会让状态区的 alpha 叠成 1-(1-a)^2
#             (palette 写 0.64 时实测 0.80,右边 2/3 看着永远是实色)。
#   2. config.h  chip_alpha 0xd9 -> 0x80:状态胶囊与托盘从 85%(近乎实色)降到 50%,
#             比 bar 的 31% 浓一档,形成你要的层次。
#   3. dwm.c  托盘胶囊原本是与 norm_bg 按 chip_alpha 混色后再 OPAQUE 画出(等于实色),
#             改成与状态胶囊同色、同 alpha。
#
# 注意:让托盘胶囊真正透明还需要把 systray 窗口换成 ARGB 窗口,那是独立的可选项,
# 见 patch-dwm-tray.sh(它带错误捕获,失败只回退成不透明,不会影响 dwm 运行)。
#
# 用法:sh patch-dwm-alpha.sh [dwm 源码目录,默认 ~/dwm]
#       然后 cd <源码目录> && make && sudo make install,再重启 dwm
set -eu
dir=${1:-$HOME/dwm}
src=$dir/dwm.c
cfg=$dir/config.h
[ -f "$src" ] || { echo "找不到 $src" >&2; exit 1; }
[ -f "$cfg" ] || { echo "找不到 $cfg" >&2; exit 1; }

changed=0

# --- 1. 删掉重复的状态区填充 -------------------------------------------------
tab=$(printf '\t')
dup="${tab}drw_rect(drw, x, 0, m->bw - getsystraywidth() - x, bh, 1, 1);"
count=$(grep -Fxc -- "$dup" "$src" || true)
if [ "$count" -eq 1 ]; then
	cp "$src" "$src.bak"
	PAT="$dup" perl -0pi -e 's{^\Q$ENV{PAT}\E$}{/* monet: drawbar() already filled the whole bar with this same scheme.
	 * Filling again here stacks the alpha (1-(1-a)^2), which is why the status
	 * area looked solid. */}m' "$src"
	echo "1/3 dwm.c:已删除状态区多余的背景填充(备份: $src.bak)"
	changed=1
elif [ "$count" -gt 1 ]; then
	echo "dwm.c 里匹配到 $count 行重复填充,拒绝修改" >&2; exit 1
else
	echo "1/5 dwm.c:重复填充已不在,跳过"
fi

# --- 2. chip_alpha 0xd9 -> 0x80 --------------------------------------------
old='static const unsigned int chip_alpha = 0xd9;'
new='static const unsigned int chip_alpha = 0x80;'
# 注意:这一行后面还跟着注释,所以只按子串匹配,不能要求整行相同。
if [ "$(grep -cF -- "$old" "$cfg" || true)" -eq 1 ]; then
	cp "$cfg" "$cfg.bak"
	OLD="$old" NEW="$new" perl -0pi -e 's{\Q$ENV{OLD}\E}{$ENV{NEW}}g' "$cfg"
	echo "2/3 config.h:chip_alpha 0xd9 -> 0x80(备份: $cfg.bak)"
	changed=1
else
	echo "2/5 config.h:chip_alpha 不是 0xd9(可能已改),跳过"
fi

# --- 3. 托盘胶囊:与状态胶囊同色同 alpha --------------------------------------
if [ "$(grep -cF 'trayhex, OPAQUE);' "$src" || true)" -eq 1 ] &&
   [ "$(grep -cF 'cols[SchemeNorm][ColBg], chip_alpha);' "$src" || true)" -eq 1 ]; then
	[ -f "$src.bak" ] || cp "$src" "$src.bak"
	# 混色比例改成 255 => trayhex 就是 tag_sel_bg;再以 chip_alpha 画出。
	perl -pi -e 's{\Q cols[SchemeNorm][ColBg], chip_alpha);\E}{ cols[SchemeNorm][ColBg], 255);}' "$src"
	perl -pi -e 's{\Qtrayhex, OPAQUE);\E}{trayhex, chip_alpha);}' "$src"
	echo "3/3 dwm.c:托盘胶囊改为与状态胶囊同色 + chip_alpha"
	changed=1
else
	echo "3/5 dwm.c:托盘改动已应用(或目标行不唯一),跳过"
fi


# --- 4. 选中 tag / 警告 tag 也按 chip_alpha 画(原本是混色后 OPAQUE)-----
if [ "$(grep -cF 'drw_clr_create(drw, &tagclr, blend, OPAQUE);' "$src" || true)" -eq 1 ]; then
	perl -0pi -e 's{blendhex\(blend, taghlbg\[0\] == .#. \? taghlbg : \(tagbg\[0\] == .#. \? tagbg : cols\[SchemeSel\]\[ColBg\]\), cols\[SchemeNorm\]\[ColBg\], 128\);\n\t\tdrw_clr_create\(drw, &tagclr, blend, OPAQUE\);}{drw_clr_create(drw, &tagclr, taghlbg[0] == \x27#\x27 ? taghlbg : (tagbg[0] == \x27#\x27 ? tagbg : cols[SchemeSel][ColBg]), chip_alpha);}s' "$src"
	echo "4/5 dwm.c:选中 tag 改用 chip_alpha(与状态胶囊一致)"
	changed=1
else
	echo "4/5 dwm.c:选中 tag 已是 chip_alpha,跳过"
fi

if [ "$(grep -cF 'drw_clr_create(drw, &tagurgclr, blend, OPAQUE);' "$src" || true)" -eq 1 ]; then
	perl -0pi -e 's{blendhex\(blend, tagurgbg\[0\] == .#. \? tagurgbg : \(tagbg\[0\] == .#. \? tagbg : cols\[SchemeSel\]\[ColBg\]\), cols\[SchemeNorm\]\[ColBg\], 217\);\n\t\tdrw_clr_create\(drw, &tagurgclr, blend, OPAQUE\);}{drw_clr_create(drw, &tagurgclr, tagurgbg[0] == \x27#\x27 ? tagurgbg : (tagbg[0] == \x27#\x27 ? tagbg : cols[SchemeSel][ColBg]), chip_alpha);}s' "$src"
	echo "4/5 dwm.c:警告 tag 改用 chip_alpha"
	changed=1
else
	echo "4/5 dwm.c:警告 tag 已是 chip_alpha,跳过"
fi

echo
if [ "$changed" -eq 1 ]; then
	echo "接下来:cd $dir && make && sudo make install,然后重启 dwm"
else
	echo "没有任何改动 —— 已经是最新状态。"
fi
