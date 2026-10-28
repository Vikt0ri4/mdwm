# wall-monet

从壁纸取一个种子色,用 **Material 3 Expressive(2025 规范)** 生成一套调色板,写进
`${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette`,再通过 X root 属性
`_MONET_PALETTE` 通知打了 monet 补丁的 dwm 立刻换色。

它不是给通用桌面用的主题生成器:输出格式、键名、透明度语义全部是为了配合
`/home/kjrin/dwm` 里那份打了补丁的 `dwm.c`,而且只配合它。

```
Super+Shift+W   wall-monet                   随机抽一张壁纸 → 设为壁纸 → 换色
Super+Shift+D   wall-monet --toggle-theme     明暗互换,不动壁纸
```

## 安装

```sh
./install.sh
```

只做两件事:把运行时复制到 `~/.local/share/wall-monet`,在 `~/.local/bin/wall-monet`
建一个 launcher。它**不会**碰 `~/.config/dwm`、`~/.xinitrc`、壁纸,也不会重编 dwm。
要让整条链路真正跑起来,还需要恢复桌面上的其他部分,见 [RESTORE.md](./RESTORE.md)。

依赖:`node`(≥18)与 `ffmpeg`;`pnpm`/`npm` 二选一用于装依赖;`xprop` 用于通知 dwm;
`feh` 用于设壁纸。

## 用法

```
wall-monet [选项] [图片]

图片来源
  (无参数)          从 $MONET_WALL_DIR(默认 ~/图片)随机抽一张,并设为壁纸
  [图片]            分析这张图(除非 --no-set,否则也会设为壁纸)
  --current         分析 ~/.fehbg 记录的那张当前壁纸

拿到颜色之后
  --no-set          不改壁纸
  --toggle-theme    重新分析当前壁纸,明暗互换(绝不动壁纸)
  --light, --dark   强制明暗并记住
  --print           只把调色板打到 stdout,不写任何文件、不发通知
  --verbose         诊断信息走 stderr,并追加到 $CACHE/wall-monet.log
  -h, --help
```

| 环境变量 | 作用 |
| --- | --- |
| `MONET_CACHE_DIR` | `palette` / `theme` / 日志的位置,默认 `~/.cache/monet` |
| `MONET_WALL_DIR` | 无参数模式的壁纸目录,默认 `~/图片` |
| `DISPLAY` | 通知 dwm 必需;没有它也会照常写 palette,dwm 下次启动时自读 |

`--current` 与 `--no-set` 是原版就有的两个 flag(来自备份 `.xinitrc` 的
`wall-monet --current --no-set`),这里保持原样。

## 输出契约(不可随意改)

```
# wall-monet palette -- generated file, safe to delete
# image=/home/kjrin/图片/x.jpg
# theme=dark
# seed=#2c6889
# generated=2026-10-24T09:27:52.990Z
norm_fg=#dfe6ed
...
```

* 格式是 `key=value`,一行一个键,**等号两侧不能有空格**,没有引号、没有分节。
* dwm 的解析器规则很硬:六个必需键
  `norm_fg norm_bg norm_border sel_fg sel_bg sel_border`
  必须全部存在且是严格的 7 字符 `#rrggbb`,**否则整份文件被丢弃**(bar 保持原样,
  没有任何报错)。`bin/check-palette` 就是把这个规则单独实现出来做校验的:

  ```sh
  check-palette ~/.cache/monet/palette      # 退出码 0 = dwm 会接受
  wall-monet --print | check-palette -      # 生成前先自查
  ```

* 写文件永远是「写临时文件 + rename」的原子替换。dwm 是在 `PropertyNotify` 里同步
  重读的,半份文件会被整体丢弃,所以这一步不是洁癖。

### 每个键到底画在哪

键名和实际用途并不总是一一对应,下表来自 `dwm.c` 的 `applypalette()` /
`drawbar()` / `drawstatusbar()`,不是猜的:

| 键 | 实际用途 |
| --- | --- |
| `norm_fg` / `norm_bg` / `norm_border` | 普通标签文字 / bar 底色 / 普通标签外框 |
| `sel_bg` / `sel_border` | 解析器要求 sel_* 齐全;selected 窗口边框用它 |
| `sel_fg` | 选中窗口标题文字(落在 bar 上,取强调色 primary) |
| `tag_sel_bg` | 状态胶囊底色:`primaryContainer`,以 `BAR_CHIP_ALPHA=0xb3` 直接盖壁纸 |
| `tag_sel_fg` | 状态胶囊文字:`onPrimaryContainer`;`statusbar.sh` 的 `COLOR_TEXT` |
| `tag_hl_bg` | 选中 tag 胶囊:`primaryContainer`(和状态胶囊同色) |
| `tag_hl_fg` | 选中 tag 文字:`onPrimaryContainer` |
| `tag_urg_bg` | urgent tag 胶囊:`errorContainer` |
| `tag_urg_fg` | urgent tag 文字:`onErrorContainer` |
| `tray_bg` | 胶囊压过 bar 后的实际颜色;dwm 托盘已不用,dmenu 的 `-nb` 用它 |
| `bar_*_alpha` / `chip_bg` / `bar_bg_fg` / `stat_*` | 已删除:dwm 不读,statusbar 只用 `tag_sel_fg` |

### 颜色是怎么选出来的

1. `ffmpeg` 把图缩到 ≤128×128 并输出 `rawvideo rgb24`,Node 读像素。转成不透明
   RGBA 是刻意的:`sourceColorFromImageBytes()` 会丢掉所有 alpha<255 的像素。
2. 种子色用官方的 `sourceColorFromImageBytes()`(Celebi 量化 + Score 打分),并把
   它内部的 `Math.random()` 换成固定种子的随机流,否则同一张壁纸每次结果都不同
   (见下面的坑列表)。
3. 方案是 `SchemeTonalSpot` + `specVersion:'2025'` + `platform:'phone'`。
4. 可读性:扫描 `contrastLevel` 的 `0 → 0.5 → 1`,取第一个让 5 对前景/背景全部达到
   WCAG 4.5:1 的档。这些对用的是**叠色之后**的实际背景:
   `norm_fg/bar`、`sel_fg/bar`、`tag_hl_fg/选中胶囊`、`tag_urg_fg/urgent胶囊`、
   `tag_sel_fg/状态胶囊`。bar 按 `0x66` 建模;胶囊按 `PictOpSrc @0xb3` **直接盖在壁纸上**
   (dwm 的新画法),不再假设叠在 bar 上。
5. **壁纸感知**:bar 是 32 位 ARGB 窗口,dwm 以 `BAR_ALPHA=0x66` 画它、合成器再把它叠到
   壁纸上,所以文字实际落在 `norm_bg @ 0x66 over 壁纸某处` 上。而「壁纸某处」
   是哪一块,取决于壁纸与屏幕两者的尺寸(`feh --bg-fill` 会居中裁剪)。我们不去猜屏幕
   几何,而是把壁纸像素采样进来(`backdropSamples`,默认最多 192 个,必然包含最暗与最亮
   的那两个),对这**所有**候选取最差情况来判定与强制对比度。代价是结果与壁纸内容相关,
   好处是降 bar 透明度之后可读性仍然是**可保证**的 —— 实测同一张壁纸下,不透明假设给
   `4.55:1`、壁纸感知给 `6.36:1`,并且会把文字从 `#a2adaf` 拉到 `#dde7ea`。

## 已知的坑(都是实测结论)

* **容器色不能当前景。** `primaryContainer`、`tertiaryContainer` 这类角色是背景色:
  亮色模式下极淡、暗色模式下中调。把它们当状态文字色,实测最低到 **1.02:1**。
  所以 `stat_*` 只用前景安全的角色(`primary`/`secondary`/`tertiary`/`error`/
  `onSurface`/`onSurfaceVariant`)。
* **胶囊用主色 + 0xb3,不用 container。** 之前用 surface/container 在 0xd9/50%/85% 下
  看着淡;现在 dwm 用 `PictOpSrc @BAR_CHIP_ALPHA=0xb3` 直接盖壁纸,所以用
  `primary`/`secondary` 主色配 `onPrimary`/`onSecondary`,对比度按真实合成算。
* **灰壁纸不会得到灰 bar。** `TONAL_SPOT` 的 primary 调色板用的是**固定 chroma 36**
  (`TonalPalette.fromHueAndChroma(hue, 36.0)`),种子自身的 chroma 被忽略;而 HCT 把
  中性灰读成 **hue 209.5(蓝)**。所以灰度壁纸会得到一条蓝色 bar。这里没有做任何
  chroma 补偿,这就是官方管线本身的行为。
* **上游包 0.4.0 的 ESM 是坏的。** 有 10 个文件里的相对导入缺 `.js` 后缀,Node 直接
  `ERR_MODULE_NOT_FOUND`;而 `specVersion:'2025'` 恰好就在这些文件后面。`patches/`
  与 `scripts/fix-mcu-esm.mjs` 都是修这个的。
* **上游的取色是不确定的,已被我们钉死。** `QuantizerWsmeans`(Celebi 内部)用
  `Math.random()` 同时做 k-means 的质心初始化和「像素→簇」的初始分配,于是**同一张
  壁纸每次跑出来的种子都不一样**——实测同一张图 5 次得到
  `#73b8c7 / #8cd9e8 / #72b8c6 / #9eecf9 / #8cd9e8`。后果是每按一次
  `Super+Shift+W` bar 都可能变色、看起来像随机而不是「我的壁纸的主题」。
  `src/seed.js` 不改算法,只在调用期间把随机流换成一个固定种子的 LCG,所以结果可复现。
* **`--toggle-theme` 会重新解码一次壁纸**,因为 `theme` 状态文件只有一行,没存种子。

## 测试

```sh
node --test        # 123 个用例,不需要 X 服务器
```

不需要 X:测试用 ffmpeg 的 lavfi 现场合成图片,并把 `feh`/`xprop` 换成记录 argv 的
桩脚本。覆盖范围包括:dwm 解析器的每一条怪癖、13 对对比度在 9 个种子 × 明暗两种主题
下的矩阵、原子写、`.fehbg` 解析、取色的可复现性(同一像素缓冲连跑 5 次必须同种子、
两个独立进程的 palette 必须逐字节相同),以及 CLI 的各个分支(裸跑 / `--print` /
`--toggle-theme` / `--current` / 失败路径 / 无 `DISPLAY` / 自定义缓存目录)。

## 配套的 picom 配置(contrib/picom.conf)

`contrib/picom.conf` 是给 dwm 这套桌面用的合成器配置,针对 `x11-misc/picom-13` 写。
它只做存档,**不**由 `install.sh` 安装(install.sh 的边界仍然只是 wall-monet 自己):

```sh
mkdir -p ~/.config/picom
cp contrib/picom.conf ~/.config/picom/picom.conf
```

两个关键事实,决定了这份配置的形状:

* **胶囊 bar 的圆角完全来自 picom。** dwm 的 bar 是 depth=32 的**矩形**窗口
  (`dwm.c:1018` 用 `drw_rect` 铺满整块),只有托盘被 `trayshape()`(dwm.c:2755)用
  XShape 裁过圆角。所以 `corner-radius` 一旦失效,bar 就变回方角矩形 ——
  `class_g = 'dwm'` 那条规则必须留在 `rules` 的最后(后者覆盖前者)。
* **模糊只在 bar 上看得出来,但会被 bar 的不透明度压住。** bar 是 ARGB,托盘是
  depth=24(不透明,模糊不了,所以豁免)。实测同一屏、开/关模糊各截一张,bar 内部
  空白区的高频能量从 `0.841` 降到 `0.492`(相邻像素灰度差均值),而 bar 上下的壁纸
  完全不变(`2.094` / `2.094`)—— 模糊确实生效。`BAR_ALPHA = 0x66`(40%)时壁纸占
  最终像素的 60%,毛玻璃与壁纸的色块都看得见;可读性由下面的「壁纸感知 + 模糊建模」兜住。

另外两处按实测修掉的坑:`notify` 不是合法的 `window_type`(EWMH 里叫
`notification`,写 `notify` 永远不命中),`modal` 不是标准 EWMH 类型,都是死规则。

### bar 的透明度:数字一直是对的,picom 在挡路

把 `bar_bg_alpha` 从 0xd0 一路调到 0x30 都不管用:bar 只是越来越暗。用像素测量才看清
原因 —— 屏幕上 bar 的颜色**比调色板色和它背后的壁纸都暗**,这不可能是两者的混合。
也就是说 alpha 没有参与合成,屏幕上只剩**预乘过的 RGB**(即 `a × 颜色`)。

根因在 picom 规则里那一句 `opacity = 1`:写了 `opacity` 的窗口,picom 会用自己的
opacity 蒙版去合成,不再用窗口自带的 ARGB alpha。删掉它之后就正常了,实测:

| 配置 | 屏幕实测 alpha(逐列解出) |
| --- | --- |
| `0xd0` | 0.82(等于 0xd0/255,但那之前只是巧合的预乘效果) |
| `0x66` | **0.40**,18/18 列都落在 [0.39, 0.41] |

dwm 这一侧从未丢 alpha(`XGetImage` 读 bar 窗口的像素,alpha 就等于 palette 里的值)。

### 现在的观感:主色胶囊

| 元素 | 取值 | 说明 |
| --- | --- | --- |
| bar 底色 | `BAR_ALPHA=0x66`(40%) | 壁纸占 60% |
| 状态胶囊 / 选中 tag | `BAR_CHIP_ALPHA=0xb3`(70%) | `primaryContainer` + `onPrimaryContainer` |
| urgent tag | 同上 0xb3 | `errorContainer` + `onErrorContainer` |
| st | `ST_ALPHA=0x66` | `st_bg=norm_bg`、`st_fg=norm_fg`、`st_cursor=sel_bg` |
| 字体 | `norm_fg = sel_fg = #…`(chroma 6) | 随壁纸明暗自动选深/浅 |

浅色主题在当前壁纸下最低 4.91:1(通过);暗色主题 4.38:1,工具会警告并建议
`Super+Shift+D` 换主题或提高 alpha —— 25% 透明度下深色底配亮壁纸本来就吃紧。

## 会话级主题:st / dmenu / xsetroot 状态栏

dwm 之外还有三个消费者,它们都读**同一份** palette(`st_*` 键就是为它们加的;
dwm 会忽略不认识的键,statusbar 只挑它认得的,所以一份文件能同时服务四方)。

| 消费者 | 怎么拿到颜色 | 需要推送吗 |
| --- | --- | --- |
| dwm 的 bar | root 属性 `_MONET_PALETTE` | 需要(`xprop`) |
| xsetroot 状态栏 | `statusbar.sh` 每秒重读 palette | 不需要 |
| `dmenu` | `dmenu_palette` 每次调用时现读 | 不需要 |
| `st` | 新 st 自己监听 `_MONET_PALETTE`;`monet-apply` 仍可写 OSC 给旧 st | 新 st 不需要 |

### st:为什么是 OSC 而不是 Xresources

这台的 st 是编译期配色(`config.h` 里写死),x.c 里**没有任何 Xrm 调用**,所以
Xresources 那套对它无效。但它的 OSC 实现是完整的(`st.c` 的 `case 4/10/11/12`),
改完还会 `tfulldirt()` 把整屏标脏重绘 —— 所以可以运行时改色,连回滚内容一起重绘,
不需要重编、不需要重启。

`monet-apply` 靠 `ps -eo tty=,comm=` 找 `comm` 为 `st` 的进程、取它们的 tty 去重
后写 `/dev/pts/N`。**不是 st 的终端永远不会被碰到**。新开的窗口由
`contrib/shell-rc-monet.sh` 负责:它只在 `TERM=st-256color` 时读 palette 并把同样的
序列打出去。

### 一个必须知道的坑:fg/bg/cursor 是调色板下标的别名

你这台 st 的 `config.h` 是 `defaultfg = 7`、`defaultbg = 0`、`defaultcs = 4`
—— 也就是说**前景/背景/光标本身就是调色板下标**。于是 `OSC 11`(设背景)与
`OSC 4;0`(设 0 号槽)写的是同一个槽,谁后发谁赢。现场测试第一次就是被这个绊倒的:
我先发 `OSC 11;#ff0000` 再发 `OSC 4;0;#0000ff`,结果整个窗口变成了蓝色。

解决办法是让冲突消失,而不是靠顺序:`st_color0 = st_bg`、`st_color7 = st_fg`、
`st_color4 = st_cursor`,两条序列写同一个值,顺序就无关紧要了。
**代价**:4 号槽(程序眼里的"蓝",也是 `ls` 的目录色)会等于光标色,也就是跟随
primary 的色相;真正的锁定蓝留在 12 号(亮蓝)槽。

如果你想让 16 个 ANSI 槽完全纯净,标准做法是把 st 的 `config.h` 改成
`[255] = 0` 之后再接三个颜色,并让 `defaultfg/defaultbg/defaultcs` 指向
256/257/258 —— 那是一次性的改动 + 重编一次,之后运行时的 OSC 机制不变。

### 16 个 ANSI 色怎么来的

M3 里没有"绿"这个角色,primary/secondary/tertiary 的色相完全由壁纸决定。所以:

* **红**取 `error` 调色板自己的色相与彩度(error 天生就是红);
* **绿/黄/蓝/品红/青**锁死色相(140° / 85° / 250° / 320° / 190°),避免 `git diff` 的红绿撞色;
* **彩度**取方案 primary 调色板的彩度(tonal spot 固定 36,钳到 32–48);
* **明度**normal/bright = 暗色 72/88、亮色 45/30;
* **中性四色**(0/7/8/15)用中性调色板色相 + 彩度 5 按 tone 取,所以亮色主题下 0 号
  仍然是深色(程序都假设"黑就是暗")。

测试门:终端 `fg/bg` 在壁纸两端都 ≥4.5:1(含 st 自己 `ST_ALPHA=0x66` 的透出;
暗色主题取 2.5:1 的 best-effort),
且五个锁定色相两两距离 ≥25°。

## 底色为什么要"染色"(一处对 2025 规范的故意偏离)

你提的需求是「bar / st / dmenu 的**底色本身**要有莫奈取色」。这件事不是透明度能解决的:

* 2025 规范把 dark 主题的 surface 定在 **tone 4**,中性调色板的 chroma 只有 **5**;
* 而 HCT 在 tone 4 能承载的 chroma 极小 —— **这是色彩空间的性质,不是实现问题**;
* 于是无论 alpha 调到多少,底色都只能是近黑(`#0a0f10`)。

所以 [src/surface.js](src/surface.js) 保留壁纸给出的 **hue**,用足够的 chroma 重建整个
surface 家族,并把 tone 抬到刚好放得下这点 chroma:

| 主题 | surface (chroma/tone) | outlineVariant |
| --- | --- | --- |
| dark | `20 / 10` → `#00282e` | tone+22 |
| light | `20 / 84` → 淡青 | tone−16 |

**强调胶囊**(状态/选中/urgent)直接取主色,不做自定义容器:

| 键 | 来源 | 说明 |
| --- | --- | --- |
| `tag_sel_bg` / `tag_hl_bg` | `primaryContainer` | 状态胶囊和选中 tag 同色 |
| `tag_sel_fg` / `tag_hl_fg` | `onPrimaryContainer` | light 深青,dark 浅青 |
| `tag_urg_bg` | `errorContainer` | urgent 用暖色 container |
| `tag_urg_fg` | `onErrorContainer` | light 深红,dark 浅红 |

覆盖的键:`norm_bg`、`norm_border`;`tag_*` 由 `accentContainers` 单独给。
因为 `st_bg == norm_bg`、dmenu 的 `-nb == norm_bg`,**bar / st / dmenu 的底色一起变**。

两个要记住的取舍:

1. **浅色端必须是 92 而不是规范的 98。** tone 96 时,红相只能承载 chroma 4.6、紫相
   6.1 —— 换成红色壁纸时浅色底色会变回"没染色"的白。92 对任何色相都能到 10~12。
2. 这等于把 **M3 2021 的 surfaceTint 做法**拿回来(当年 surface 本来就会掺主色,
   2025 规范转向中性化)。想要更浓/更淡就改 `SURFACE_TINT`,
   或者按 `tintedSurfaces(scheme, dark, { chroma, tone })` 传自定义值(有测试覆盖)。

强调色(primary/tertiary/error…)仍然完全来自 `SchemeTonalSpot`,而且所有文字配对
依旧要过壁纸感知的 4.5:1 校验 —— 染色只动底色,不动可读性保证。
