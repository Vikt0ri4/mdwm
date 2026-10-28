/* See LICENSE file for copyright and license details. */
#include <X11/XF86keysym.h> /* XF86XK_AudioMute / AudioRaiseVolume ... */

/* appearance */
static const unsigned int borderpx = 1; /* border pixel of windows */
static const unsigned int snap = 32;    /* snap pixel */
static const unsigned int systraypinning =
    0; /* 0: sloppy systray follows selected monitor, >0: pin systray to monitor
          X */
static const unsigned int systrayonleft =
    0; /* 0: systray in the right corner, >0: systray on left of status text */
static const unsigned int systrayspacing = 2; /* systray spacing */
static const int systraypinningfailfirst =
    1; /* 1: if pinning fails, display systray on the first monitor, False:
          display systray on the last monitor*/
static const int showsystray = 1; /* 0 means no systray */
static const int showbar = 1;     /* 0 means no bar */
static const int topbar = 1;      /* 0 means bottom bar */
static const char *fonts[] = {"Hack Nerd Font Mono:pixelsize=34"};
static const char dmenufont[] = "Hack Nerd Font Mono:pixelsize=34";
/* monet: floating pill bar. Chip height/radius derive from bh. */
static const unsigned int bar_margin = 12; /* pill distance from the screen top/left/right */
static const unsigned int bar_gap = 0;     /* space to the client area (see outergap) */
static const unsigned int gappx = 8;       /* gaps between windows */
static const unsigned int outergap = 12;   /* gaps to the screen edge / bar */
static const unsigned int bar_extra = 20;  /* bh = font height + this */
/* ===== high-DPI: sizes that used to be hardcoded =======================
 * cursor_size   : side of the Xcursor images dwm draws on the root window and
 *                 the bar (XCreateFontCursor used to ignore every size knob).
 * tray_extra    : pixels added to the tray icon height on top of the bar font.
 *                 traymaxh() computes bh - tray_extra, clamped 12..64.
 * Both are plain numbers: change and rebuild. */
static const unsigned int cursor_size = 40;
static const unsigned int tray_extra = 2;
static const unsigned int bar_padx = 24;   /* bar inner left/right padding */
static unsigned int chip_radius = 16; /* overridden at runtime by ~/.config/dwm/radius */
/* monet: tray icons float on the bar (XShape clips the window to the icons) */
static const unsigned int tray_pad = 10; /* padding around the icon group (transparent spacer) */
static const unsigned int tray_gap = 8;  /* gap between the icon group and the status text */

/* ===== opacity: two knobs ===========================================
 * BAR_ALPHA      = bar base/title/plain tag opacity (0x40).
 * BAR_CHIP_ALPHA = status/selected/urgent pill opacity (0x80).
 * The pills are more solid than the base; pale containers would otherwise
 * vanish into the wallpaper.
 *   0x00 fully transparent (wallpaper only) ... 0xff opaque.
 * Text and window borders stay opaque.
 * Change only these two numbers and rebuild; the palette cannot override. */
static const unsigned int BAR_ALPHA = 0x40;
static const unsigned int BAR_CHIP_ALPHA = 0xa0;

enum BarPart { BarFill, BarChip, BarText, BarBorder };

static unsigned int
alpha_for(enum BarPart part)
{
    switch (part) {
    case BarFill: return BAR_ALPHA;
    case BarChip: return BAR_CHIP_ALPHA;
    default:      return OPAQUE;
    }
}

static const char col_cyan[] = "#86e1fc";
static const char col_bg_dark[] = "#2e3440";
static const char col_bg[] = "#3b4252";
static const char col_gray1[] = "#434c5e";
static const char col_gray2[] = "#4c566a";
static const char col_gray3[] = "#d8dee9";
static const char col_gray4[] = "#eceff4";
static const char col_accent[] = "#5e81ac";
static const char col_nord_blue[] = "#5e81ac";
static const char col_nord_green[] = "#a3be8c";
static const char *colors[][3] = {
    /*               fg         bg         border   */
    [SchemeNorm] = {col_gray3, col_bg_dark, col_gray1},
    [SchemeSel] = {col_gray4, col_accent, col_accent},
};

/* tagging */
static const char *tags[] = {"1", "2", "3", "4", "5", "6", "7", "8", "9"};

static const Rule rules[] = {
    /* xprop(1):
     *	WM_CLASS(STRING) = instance, class
     *	WM_NAME(STRING) = title
     */
    /* class      instance    title       tags mask     isfloating   monitor */
    {"Gimp", NULL, NULL, 0, 1, -1},
    {"Firefox", NULL, NULL, 1 << 8, 0, -1},
};

/* layout(s) */
static const float mfact = 0.55; /* factor of master area size [0.05..0.95] */
static const int nmaster = 1;    /* number of clients in master area */
static const int resizehints =
    1; /* 1 means respect size hints in tiled resizals */
static const int lockfullscreen =
    1; /* 1 will force focus on the fullscreen window */
static const int refreshrate =
    120; /* refresh rate (per second) for client move/resize */

static const Layout layouts[] = {
    /* symbol     arrange function */
    {"[]=", tile}, /* first entry is default */
    {"><>", NULL}, /* no layout function means floating behavior */
    {"[M]", monocle},
};

/* key definitions */
#define MODKEY Mod1Mask
#define TAGKEYS(KEY, TAG)                                                      \
  {MODKEY, KEY, view, {.ui = 1 << TAG}},                                       \
      {MODKEY | ControlMask, KEY, toggleview, {.ui = 1 << TAG}},               \
      {MODKEY | ShiftMask, KEY, tag, {.ui = 1 << TAG}},                        \
      {MODKEY | ControlMask | ShiftMask, KEY, toggletag, {.ui = 1 << TAG}},

/* helper for spawning shell commands in the pre dwm-5.0 fashion */
#define SHCMD(cmd)                                                             \
  {                                                                            \
    .v = (const char *[]) { "/bin/sh", "-c", cmd, NULL }                       \
  }

/* commands */
static char dmenumon[2] =
    "0"; /* component of dmenucmd, manipulated in spawn() */
/* dmenu colours come from dmenu_palette, which reads the wall-monet
 * palette, so dmenu follows the wallpaper without rebuilding dwm. */
static const char *dmenucmd[] = {"/home/kjrin/.local/bin/dmenu_palette",
                                 "-m",
                                 dmenumon,
                                 "-fn",
                                 dmenufont,
                                 NULL};
static const char *termcmd[] = {"st", NULL};

static const Key keys[] = {
    /* modifier                     key        function        argument */
    /* --- volume: ~/.local/bin/vol maps the bar's 0-100 to Master's
     * audible range. 0 = muted; 1 = 50% raw (audible floor); 100 = 100% raw.
     * Step 1% (owner's change), media keys 5%. */
    {MODKEY | ShiftMask, XK_Up, spawn, SHCMD("$HOME/.local/bin/vol up 5")},
    {MODKEY | ShiftMask, XK_Down, spawn, SHCMD("$HOME/.local/bin/vol down 5")},
    {MODKEY | ShiftMask, XK_m, spawn, SHCMD("$HOME/.local/bin/vol mute")},
    /* keyboard media keys (no modifier) */
    {0, XF86XK_AudioRaiseVolume, spawn, SHCMD("$HOME/.local/bin/vol up 5")},
    {0, XF86XK_AudioLowerVolume, spawn, SHCMD("$HOME/.local/bin/vol down 5")},
    {0, XF86XK_AudioMute, spawn, SHCMD("$HOME/.local/bin/vol mute")},
    {MODKEY, XK_s, spawn, SHCMD("flameshot full -p ~/Pictures/Screenshots")},
    {MODKEY | ShiftMask, XK_s, spawn, SHCMD("flameshot gui")},
    {MODKEY | ShiftMask, XK_w, spawn, SHCMD("$HOME/.local/bin/wall-monet")},
    {MODKEY | ShiftMask, XK_d, spawn, SHCMD("$HOME/.local/bin/wall-monet --toggle-theme")},
    {MODKEY, XK_p, spawn, {.v = dmenucmd}},
    {MODKEY, XK_a, spawn, SHCMD("appmenu")},
    {MODKEY, XK_Return, spawn, {.v = termcmd}},
    {MODKEY, XK_b, togglebar, {0}},
    {MODKEY, XK_j, focusstack, {.i = +1}},
    {MODKEY, XK_k, focusstack, {.i = -1}},
    {MODKEY, XK_i, incnmaster, {.i = +1}},
    {MODKEY, XK_d, incnmaster, {.i = -1}},
    {MODKEY, XK_h, setmfact, {.f = -0.05}},
    {MODKEY, XK_l, setmfact, {.f = +0.05}},
    {MODKEY | ShiftMask, XK_Return, zoom, {0}},
    {MODKEY, XK_Tab, view, {0}},
    {MODKEY, XK_q, killclient, {0}},
    {MODKEY, XK_t, setlayout, {.v = &layouts[0]}},
    {MODKEY, XK_f, setlayout, {.v = &layouts[1]}},
    {MODKEY, XK_m, setlayout, {.v = &layouts[2]}},
    {MODKEY | ShiftMask, XK_f, fullscreen, {0}},
    {MODKEY, XK_space, setlayout, {0}},
    {MODKEY | ShiftMask, XK_space, togglefloating, {0}},
    {MODKEY | ControlMask, XK_f, togglefullscr, {0}},
    {MODKEY, XK_0, view, {.ui = ~0}},
    {MODKEY | ShiftMask, XK_0, tag, {.ui = ~0}},
    {MODKEY, XK_comma, focusmon, {.i = -1}},
    {MODKEY, XK_period, focusmon, {.i = +1}},
    {MODKEY | ShiftMask, XK_comma, tagmon, {.i = -1}},
    {MODKEY | ShiftMask, XK_period, tagmon, {.i = +1}},
    TAGKEYS(XK_1, 0) TAGKEYS(XK_2, 1) TAGKEYS(XK_3, 2) TAGKEYS(XK_4, 3)
        TAGKEYS(XK_5, 4) TAGKEYS(XK_6, 5) TAGKEYS(XK_7, 6) TAGKEYS(XK_8, 7)
            TAGKEYS(XK_9, 8){MODKEY | ShiftMask, XK_c, quit, {0}},
};

/* button definitions */
/* click can be ClkTagBar, ClkLtSymbol, ClkStatusText, ClkWinTitle,
 * ClkClientWin, or ClkRootWin */
static const Button buttons[] = {
    /* click                event mask      button          function argument */
    {ClkLtSymbol, 0, Button1, setlayout, {0}},
    {ClkLtSymbol, 0, Button3, setlayout, {.v = &layouts[2]}},
    {ClkWinTitle, 0, Button2, zoom, {0}},
    {ClkStatusText, 0, Button2, spawn, {.v = termcmd}},
    {ClkClientWin, MODKEY, Button1, movemouse, {0}},
    {ClkClientWin, MODKEY, Button2, togglefloating, {0}},
    {ClkClientWin, MODKEY, Button3, resizemouse, {0}},
    {ClkTagBar, 0, Button1, view, {0}},
    {ClkTagBar, 0, Button3, toggleview, {0}},
    {ClkTagBar, MODKEY, Button1, tag, {0}},
    {ClkTagBar, MODKEY, Button3, toggletag, {0}},
};
