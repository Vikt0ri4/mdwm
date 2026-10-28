# monet-desktop

一个自包含的莫奈取色桌面套件：dwm + st + dmenu + xsetroot 状态栏 + wall-monet 调色板生成器 + picom 配置。

## 结构

```
dwm/           patched dwm 源码（ARGB bar、胶囊、Monet 调色板）
st/            patched st 源码（ST_ALPHA、_MONET_PALETTE 热切换）
dmenu/         dmenu 5.4 源码（height/padding patch）
wall-monet/    Node 调色板生成器 + M3 container/tint 逻辑（含 node_modules）
scripts/       statusbar.sh（xsetroot）、shell-rc-monet.sh
config/        picom.conf、picom_toggle.sh
install.sh
```

## 依赖

运行时/构建时：`cc make pkg-config node tic xsetroot xprop picom`，以及 libX11 / libXft / fontconfig / freetype2 的开发头文件。

`install.sh` 只检查、不自动装；缺什么会列出来退出。

## 安装

```sh
sudo ./install.sh            # 安装（覆盖已有配置前会询问 [y/N]）
sudo ./install.sh --dry-run  # 只看会做什么
sudo ./install.sh --yes      # 不询问，直接覆盖配置
```

只要目标配置已存在（无论内容是否相同），`install.sh` 都会逐个询问 `Overwrite? [y/N]`（默认 N，跳过）。
回答 y 后，先把它备份为 `<原文件名>.bak`，再写入新文件；`--yes` 会跳过询问但仍然备份。

安装位置：

| 内容 | 目标 |
| --- | --- |
| dwm / st / dmenu | `/usr/local/bin` |
| st terminfo | `tic -sx st.info` |
| wall-monet（含 node_modules） | `$SUDO_USER:~/.local/share/wall-monet` |
| wall-monet / check-palette / monet-apply / dmenu_palette | `$SUDO_USER:~/.local/bin` 符号链接 |
| statusbar.sh | `$SUDO_USER:~/.config/dwm/statusbar.sh` |
| shell-rc-monet.sh | `$SUDO_USER:~/.config/shell-rc-monet.sh` |
| picom.conf / picom_toggle.sh | `$SUDO_USER:~/.config/picom/` |

`install.sh` 只装文件，不重启任何进程。

## 安装后

```sh
# 重启 dwm
pkill -x picom; picom --config ~/.config/picom/picom.conf >/dev/null 2>&1 &
wall-monet --current        # 生成 palette
```

确认 `~/.local/bin` 在 `PATH` 里，否则 `dmenu_palette` 找不到 `wall-monet`。

## 调色板

`wall-monet` 从壁纸生成 M3 Expressive 2025 调色板：

- bar 底 `norm_bg`，0x40
- 状态/选中 tag 用自定义 primary 色相 tint（light tone 88、dark tone 26），胶囊 alpha 0xa0
- urgent 用 `errorContainer`
- st 跟随 `norm_bg`，`ST_ALPHA=0x80`
- 调色板写到 `${MONET_CACHE_DIR:-~/.cache/monet}/palette`，dwm/st 通过 `_MONET_PALETTE` 热加载
