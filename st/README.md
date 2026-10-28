[中文版](./docs/README_zh.md)

# st - simple terminal

## About st

st is a simple terminal emulator for X which sucks less.  
This is a personal fork of the [st](https://st.suckless.org/) project from [suckless.org](https://suckless.org/).  

### Requirements
In order to build st you need the Xlib header files.  

### Installation
Edit config.mk to match your local setup (st is installed into the /usr/local namespace by default).  

Afterwards enter the following command to build and install st (if necessary as root):  

`make clean install`  

### Running st
If you did not install st with make clean install, you must compile the st terminfo entry with the following command:  

`tic -sx st.info`  

See the man page for additional details.  

## Custom Configuration
The following personalized adjustments have been made on the basis of the original st:  

### Patch 
- alpha (`ST_ALPHA` in config.h; premultiplied ARGB; text stays opaque)
- anysize
- scrollback-reflow-standalone-extended

### Features
- **Monet hot palette**: st listens to the root `_MONET_PALETTE` property and
  re-reads `st_*` from `${MONET_CACHE_DIR:-$HOME/.cache/monet}/palette`, so a
  wallpaper/theme change retints both running and newly opened terminals.
- **Edge auto-scroll**: dragging a text selection to the top or bottom 3 rows of the
  window automatically scrolls the scrollback buffer, with speed accelerating closer
  to the edge (5–80 lines/sec).
- **Shift+PgUp/PgDn during selection**: Shift+PageUp/PageDown shortcuts now work while
  mouse-selecting text, allowing you to scroll and extend the selection simultaneously
  without interruption.

### Appearance
- **Font**: Use `hack`, size 24
- **Theme**: Dark blue color scheme
- **Transparency**: `ST_ALPHA` in config.h (0x40 by default, 25% opaque); only the
  default background is translucent, text/ANSI colors/cursor are opaque. The
  palette's `st_bg` is applied at startup and on `_MONET_PALETTE`, using the same
  premultiplied ARGB path as dwm's bar.
