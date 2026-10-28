# RESTORE.md — 把这套东西在真机上跑起来

这份清单是给你在**真机上手动执行**的。我(在会话沙箱里)一行都写不进 `~/.local` 或
`/home/kjrin/dwm`,原因写在最后一节。

顺序很重要:先让文件系统可写,再恢复配置,再重编 dwm,最后装 wall-monet 并验证。

---

## 0. 现在坏在哪(实测清单)

| 东西 | 现状 |
| --- | --- |
| `/`、`/home` | btrfs 挂载为 **ro**,只有会话工作区可写 |
| `/usr/local/bin/dwm` | 80 KB 的**未打 monet 补丁**旧构建(`strings ... \| grep -c monet` = 0) |
| `~/dwm/dwm.c`、`~/dwm/config.h` | 打了补丁的源码还在,只是没装进系统 |
| `~/.local/bin/` | **整个目录不存在**:wall-monet、dmenu_palette、vol、dwm-radius 全丢 |
| `~/.config/dwm/` | **整个目录不存在**:statusbar.sh、radius 都没了 |
| `~/.fehbg` | 不存在 |
| `~/图片/` | 空的,一张壁纸都没有 |
| `~/.cache/monet/` | 不存在 |
| `~/.xinitrc` | 当前版本**没有**调用 wall-monet 的那段(备份里有) |
| `~/.Xresources`、`~/.config/picom/` | 都不存在(备份里分别有) |

备份都在 `~/proj_bak/config-back/` 下面。

---

## 1. 让文件系统可写

只读挂载是当前一切写入失败的总原因:

```sh
sudo mount -o remount,rw /
sudo mount -o remount,rw /home
```

`mount | grep -E ' / | /home '` 确认 `ro` 变成 `rw` 之后再往下走。

## 2. 恢复桌面配置文件

```sh
mkdir -p ~/.config/dwm

# 状态栏脚本与统一圆角(radius 的值是 16)
cp ~/proj_bak/config-back/dwm-scripts/statusbar.sh ~/.config/dwm/statusbar.sh
cp ~/proj_bak/config-back/dwm-scripts/radius       ~/.config/dwm/radius
chmod +x ~/.config/dwm/statusbar.sh

# Xresources(高 DPI 字体渲染用到)
[ -f ~/.Xresources ] || cp ~/proj_bak/config-back/home-dotfiles/.Xresources ~/.Xresources

# picom 配置:合成器,胶囊圆角与毛玻璃都靠它
# 用本仓库重写过的版本,不要再用 proj_bak 里那份(含无效选项)
mkdir -p ~/.config/picom
cp ~/dsh/dsh_workspace/wall-monet/contrib/picom.conf ~/.config/picom/picom.conf
```

`~/.xinitrc` 需要补回三样东西(参照备份
`~/proj_bak/config-back/home-dotfiles/.xinitrc`):

```sh
export PATH="$HOME/脚本:$HOME/.local/bin:$PATH"          # 放在文件前部

# 合成器:必须在 dwm 之前起来,否则 bar 是方角矩形(dwm 只给托盘做了 XShape 圆角)
picom --config "$HOME/.config/picom/picom.conf" >/dev/null 2>&1 &

# 壁纸 + 生成调色板,放在「启动 dwm」之前,注意必须后台化 + 超时:
# 取色会 fork ffmpeg/node,前台串行会把整个会话挡在 exec dwm 之前。
if [ -f "$HOME/.fehbg" ]; then
  sh "$HOME/.fehbg"
  timeout 30 "$HOME/.local/bin/wall-monet" --current --no-set >/dev/null 2>&1 &
else
  timeout 30 "$HOME/.local/bin/wall-monet" >/dev/null 2>&1 &
fi
```

装完 picom 后先验一次 GL(否则 `backend = "glx"` 会退化或起不来):

```sh
picom --diagnostics 2>&1 | head -25
# 期望看不到:failed to load driver / GLX_EXT_texture_from_pixmap is not supported
```

## 3. 放一张壁纸

`Super+Shift+W` 是从 `~/图片` 随机抽的,所以先丢几张进去:

```sh
mkdir -p ~/图片
cp /path/to/你的壁纸.jpg ~/图片/
feh --bg-fill ~/图片/你的壁纸.jpg      # 顺手写出 ~/.fehbg
```

`feh --bg-fill` 会自动写 `~/.fehbg`,而 `--current` 就是靠读它来确定「当前壁纸」的。

## 4. 重编并安装打了补丁的 dwm

```sh
sudo cp /usr/local/bin/dwm /usr/local/bin/dwm.pre-monet   # 留个后悔药
# 三处一次改完(脚本幂等,已打过会逐条说"跳过"):
#   1. 删掉 drawstatusbar() 里多余的背景填充(否则状态区 alpha 叠成 1-(1-a)^2)
#   2. config.h 的 chip_alpha 0xd9 -> 0x80(胶囊/托盘 85% -> 50%)
#   3. 托盘胶囊改为与状态胶囊同色同 alpha(原来是与 norm_bg 混色后 OPAQUE)
sh ~/dsh/dsh_workspace/wall-monet/contrib/patch-dwm-alpha.sh ~/dwm
cd ~/dwm && make clean install
strings /usr/local/bin/dwm | grep -c _MONET_PALETTE       # 应该 > 0,否则补丁没进去
```

重启 dwm(或重新 `startx`)后,`Super+Shift+W` 才有东西可调用。

## 5. 安装 wall-monet

```sh
cd ~/dsh/dsh_workspace/wall-monet        # 或者你已经拷到别处的仓库
./install.sh
```

它做四件事:复制运行时到 `~/.local/share/wall-monet`,建 `~/.local/bin/wall-monet`
launcher,并同样链出 `check-palette` / `dmenu_palette` / `monet-apply`
(`dmenu_palette` 必须在这个位置,因为 dwm 的 `config.h` 把它写死了)。
**不会**碰 `~/.config/dwm`、`~/.xinitrc`、壁纸,也不会重编 dwm。

还需要手工放三份 contrib(st 本身不用重编,它靠运行时 OSC 改色):

```sh
D=~/.local/share/wall-monet/contrib

# 状态栏脚本(单色文字 + 修好的兜底色)
cp "$D/statusbar.sh" ~/.config/dwm/statusbar.sh && chmod +x ~/.config/dwm/statusbar.sh

# 高 DPI:没有这份资源时 Xft 按 96dpi 渲染,dwm/dmenu 的字会明显偏小
cp "$D/xresources" ~/.Xresources && xrdb -merge ~/.Xresources

# 新开的 st 窗口自动跟随主题(只在 TERM=st-256color 时生效)
# 在 ~/.zshrc(和 ~/.bashrc)里加一行:
#   . ~/.local/share/wall-monet/contrib/shell-rc-monet.sh
```

## 6. 验证(由浅入深)

```sh
# a) 工具本身能跑(这一步会加载色彩库,能过就说明依赖没坏)
~/.local/bin/wall-monet --help

# b) 不碰壁纸、不写文件,只看看它算出什么
~/.local/bin/wall-monet --current --no-set --print --verbose

# c) 真写一次,并让 dwm 重载 + 刷 st
~/.local/bin/wall-monet --current --no-set --verbose
#   期望 stderr 里出现 monet-apply 的结果;单独跑也行:
~/.local/bin/monet-apply --verbose          # 应逐个列出它改色的 pty
~/.local/bin/monet-apply --dry-run          # 只列出会写哪些 /dev/pts/N

# d) 文件级校验:严格按 dwm 的解析规则复核
check-palette ~/.cache/monet/palette      # 退出码必须是 0
cat ~/.cache/monet/palette                # 应含 st_color0..15 / st_fg / st_bg / st_cursor

# e) 通知是否发出
xprop -root _MONET_PALETTE                # 应显示主题名,如 "dark"
tail -5 ~/.cache/monet/dwm.log            # dwm 自己的诊断
```

第 (e) 步的 `dwm.log` 是端到端最有力的证据,dwm 每次收到通知都会写两行:

```
dwm: monet: 收到 _MONET_PALETTE 通知 (state=0)
dwm: monet: 调色板解析成功  -> baralpha=208 barbgalpha=208 barselalpha=208 bgfg='#a5acb3'
dwm: monet: 方案实际 alpha -> norm_bg=208 sel_bg=208 base_bg=208 (期望 208/208/208)
```

最后再按两个快捷键肉眼确认:

* `Super+Shift+W` — 换一张随机壁纸,bar 与**所有已开的 st 窗口**都应一起换色
* `Super+Shift+D` — 明暗互换,壁纸**不应该**变

另外三项消费者各自的验收:

```sh
# st:monet-apply 会改所有 st 的 pty;跑完看终端底色/文字是否变了
~/.local/bin/monet-apply --verbose

# dmenu:MOD+P 应该弹出**跟着主题上色**的菜单(stdin 是管道时它变成过滤器)
printf 'a\nb\n' | ~/.local/bin/dmenu_palette

# 状态栏:只有一个颜色,取自 palette 的 tag_sel_fg
grep '^tag_sel_fg=' ~/.cache/monet/palette
```

## 7. 故障排查

| 症状 | 先看什么 | 处理 |
| --- | --- | --- |
| st 窗口不变色 | `monet-apply --verbose` 的输出 | 没有列出 pty → 你的 st 进程名不是 `st`;列出但没变 → 看第 8 节的下标别名说明 |
| `monet-apply` 报 `has no st_color0` | `grep -c '^st_' ~/.cache/monet/palette` | 是 0 → palette 是旧代码生成的,重跑一次 `wall-monet` |
| 新开的 st 不变色 | `echo $TERM` | 不是 `st-256color`?或 `.zshrc` 里那行没加/没生效 |
| dmenu 还是旧配色 | `ls -l ~/.local/bin/dmenu_palette` | 软链不存在 → 重跑 `install.sh`;`config.h` 里 dmenucmd 指向它 |
| dwm/dmenu 的字偏小 | `xrdb -query \| head` | 为空 → 没恢复 `~/.Xresources`(第 5 节),Xft 按 96dpi 在渲染 |
| bar 完全不变色 | `~/.cache/monet/dwm.log` 有没有「收到 _MONET_PALETTE 通知」 | 没有 → 通知没到:确认 `DISPLAY` 设了、`xprop` 装了、dwm 是补丁版 |
| 有通知、没有「调色板解析成功」 | `check-palette ~/.cache/monet/palette` | 退出码 1 → 文件不合规(缺必需键 / 值不是 7 字符 `#rrggbb`);dwm 会**整份丢弃**且不报错 |
| 装了补丁版 dwm 还是不变 | `strings /usr/local/bin/dwm \| grep -c _MONET_PALETTE` | 是 0 → `make clean install` 没生效,回去重做第 4 步 |
| `xprop: unable to open display` | `echo $DISPLAY` | 从 X 会话里跑,或先把 `DISPLAY` 设对 |
| `wall-monet --current` 报 `~/.fehbg does not exist` | `ls -l ~/.fehbg` | 先用 `feh --bg-fill 图片` 设一次壁纸 |
| `ffmpeg failed on ...` | 路径是否存在 | 壁纸文件被删了;重新设一张 |
| `no wallpapers found in ~/图片` | `ls ~/图片` | 目录空的;丢几张图进去,或设 `MONET_WALL_DIR` |
| `ffmpeg was not found` | `command -v ffmpeg` | 装 `media-video/ffmpeg` |
| 文字发灰、看不清 | `--print --verbose` 输出的 `lowest pair` | 颜色已经强制 ≥4.5:1;若仍嫌淡,是 `chip_alpha`(0xd9)与三个 `*_alpha` 的锅,可在 dwm 的 `config.h` 调 |
| `Super+P`(dmenu)报错 | — | `dmenu_palette` 也在丢失名单里,本次**没有**重建;要么自己补,要么把 `config.h` 的 `dmenucmd` 改回 `dmenu_run` |
| 托盘/状态栏不出现 | `pgrep -f statusbar.sh` | `~/.config/dwm/statusbar.sh` 没恢复或没执行位 |

## 8. 为什么这些步骤不能由我代劳

会话沙箱里:

* `/` 与 `/home` 是 btrfs **ro** 挂载,而且 `sudo` 因为 `no_new_privs` 完全不可用
  (`/etc/sudo.conf` 的属主还是 uid 65534)——既写不了 `~/dwm`,也重挂不了。
* 没有 X 会话(`DISPLAY` 未设、`/tmp/.X11-unix` 不存在),所以「bar 到底变没变」这种
  肉眼验证根本无从谈起。

因此我这一侧能给出的是:仓库 + `install.sh` + 109 个离线测试(不需要 X),以及这份
清单。第 4、6 步里只有你能做的部分,恰好就是这套东西唯一真正的验收标准。
