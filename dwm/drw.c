/* See LICENSE file for copyright and license details. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <X11/Xlib.h>
#include <X11/Xcursor/Xcursor.h>
#include <X11/extensions/Xrender.h>
#include <X11/Xft/Xft.h>

#include "drw.h"
#include "util.h"

#define UTF_INVALID 0xFFFD

static int
utf8decode(const char *s_in, long *u, int *err)
{
	static const unsigned char lens[] = {
		/* 0XXXX */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
		/* 10XXX */ 0, 0, 0, 0, 0, 0, 0, 0,  /* invalid */
		/* 110XX */ 2, 2, 2, 2,
		/* 1110X */ 3, 3,
		/* 11110 */ 4,
		/* 11111 */ 0,  /* invalid */
	};
	static const unsigned char leading_mask[] = { 0x7F, 0x1F, 0x0F, 0x07 };
	static const unsigned int overlong[] = { 0x0, 0x80, 0x0800, 0x10000 };

	const unsigned char *s = (const unsigned char *)s_in;
	int len = lens[*s >> 3];
	*u = UTF_INVALID;
	*err = 1;
	if (len == 0)
		return 1;

	long cp = s[0] & leading_mask[len - 1];
	for (int i = 1; i < len; ++i) {
		if (s[i] == '\0' || (s[i] & 0xC0) != 0x80)
			return i;
		cp = (cp << 6) | (s[i] & 0x3F);
	}
	/* out of range, surrogate, overlong encoding */
	if (cp > 0x10FFFF || (cp >> 11) == 0x1B || cp < overlong[len - 1])
		return len;

	*err = 0;
	*u = cp;
	return len;
}

Drw *
drw_create(Display *dpy, int screen, Window root, unsigned int w, unsigned int h, Visual *visual, unsigned int depth, Colormap cmap)
{
	Drw *drw = ecalloc(1, sizeof(Drw));
	XRenderPictFormat *fmt;

	/* The only supported path: 32-bit ARGB + XRender. Without it there is no
	 * truly translucent bar, so fail loudly instead of falling back to an
	 * unverified core-protocol path. */
	if (!visual || depth != 32 || !(fmt = XRenderFindVisualFormat(dpy, visual)))
		die("dwm: a 32-bit ARGB visual + XRender is required for the translucent bar");

	drw->dpy = dpy;
	drw->screen = screen;
	drw->root = root;
	drw->w = w;
	drw->h = h;
	drw->visual = visual;
	drw->depth = depth;
	drw->cmap = cmap;
	drw->drawable = XCreatePixmap(dpy, root, w, h, depth);
	drw->pict = XRenderCreatePicture(dpy, drw->drawable, fmt, 0, NULL);

	return drw;
}

void
drw_resize(Drw *drw, unsigned int w, unsigned int h)
{
	XRenderPictFormat *fmt;

	if (!drw)
		return;

	drw->w = w;
	drw->h = h;
	XRenderFreePicture(drw->dpy, drw->pict);
	XFreePixmap(drw->dpy, drw->drawable);
	drw->drawable = XCreatePixmap(drw->dpy, drw->root, w, h, drw->depth);
	fmt = XRenderFindVisualFormat(drw->dpy, drw->visual);
	if (!fmt)
		die("dwm: the 32-bit ARGB visual has no XRender format");
	drw->pict = XRenderCreatePicture(drw->dpy, drw->drawable, fmt, 0, NULL);
}

void
drw_free(Drw *drw)
{
	if (!drw)
		return;

	XRenderFreePicture(drw->dpy, drw->pict);
	XFreePixmap(drw->dpy, drw->drawable);
	drw_fontset_free(drw->fonts);
	free(drw);
}

/* This function is an implementation detail. Library users should use
 * drw_fontset_create instead.
 */
static Fnt *
xfont_create(Drw *drw, const char *fontname, FcPattern *fontpattern)
{
	Fnt *font;
	XftFont *xfont = NULL;
	FcPattern *pattern = NULL;

	if (fontname) {
		/* Using the pattern found at font->xfont->pattern does not yield the
		 * same substitution results as using the pattern returned by
		 * FcNameParse; using the latter results in the desired fallback
		 * behaviour whereas the former just results in missing-character
		 * rectangles being drawn, at least with some fonts. */
		if (!(xfont = XftFontOpenName(drw->dpy, drw->screen, fontname))) {
			fprintf(stderr, "error, cannot load font from name: '%s'\n", fontname);
			return NULL;
		}
		if (!(pattern = FcNameParse((FcChar8 *) fontname))) {
			fprintf(stderr, "error, cannot parse font name to pattern: '%s'\n", fontname);
			XftFontClose(drw->dpy, xfont);
			return NULL;
		}
	} else if (fontpattern) {
		if (!(xfont = XftFontOpenPattern(drw->dpy, fontpattern))) {
			fprintf(stderr, "error, cannot load font from pattern.\n");
			return NULL;
		}
	} else {
		die("no font specified.");
	}

	font = ecalloc(1, sizeof(Fnt));
	font->xfont = xfont;
	font->pattern = pattern;
	font->h = xfont->ascent + xfont->descent;
	font->dpy = drw->dpy;

	return font;
}

static void
xfont_free(Fnt *font)
{
	if (!font)
		return;
	if (font->pattern)
		FcPatternDestroy(font->pattern);
	XftFontClose(font->dpy, font->xfont);
	free(font);
}

Fnt*
drw_fontset_create(Drw* drw, const char *fonts[], size_t fontcount)
{
	Fnt *cur, *ret = NULL;
	size_t i;

	if (!drw || !fonts)
		return NULL;

	for (i = 1; i <= fontcount; i++) {
		if ((cur = xfont_create(drw, fonts[fontcount - i], NULL))) {
			cur->next = ret;
			ret = cur;
		}
	}
	return (drw->fonts = ret);
}

void
drw_fontset_free(Fnt *font)
{
	if (font) {
		drw_fontset_free(font->next);
		xfont_free(font);
	}
}

void
drw_clr_create(Drw *drw, Clr *dest, const char *clrname, unsigned int alpha)
{
	if (!drw || !dest || !clrname)
		return;

	if (!XftColorAllocName(drw->dpy, drw->visual, drw->cmap,
	                       clrname, dest))
		die("error, cannot allocate color '%s'", clrname);
	dest->pixel = (dest->pixel & 0x00ffffffU) | (alpha << 24);
	/* XRender uses .color, the core protocol .pixel; both carry alpha */
	dest->color.alpha = (unsigned short)(alpha * 257U);
	/* Render colours are premultiplied: RGB must be multiplied by alpha.
	 * Otherwise a 30% background composites as fully opaque. */
	dest->color.red   = (unsigned short)((unsigned long)dest->color.red   * alpha / 255U);
	dest->color.green = (unsigned short)((unsigned long)dest->color.green * alpha / 255U);
	dest->color.blue  = (unsigned short)((unsigned long)dest->color.blue  * alpha / 255U);
}

/* Create color schemes. */
Clr *
drw_scm_create(Drw *drw, const char *clrnames[], const unsigned int clralphas[], size_t clrcount)
{
	size_t i;
	Clr *ret;

	/* need at least two colors for a scheme */
	if (!drw || !clrnames || clrcount < 2 || !(ret = ecalloc(clrcount, sizeof(Clr))))
		return NULL;

	for (i = 0; i < clrcount; i++)
		drw_clr_create(drw, &ret[i], clrnames[i], clralphas[i]);
	return ret;
}

void
drw_clr_free(Drw *drw, Clr *c)
{
	if (!drw || !c)
		return;

	/* c is typedef XftColor Clr */
	XftColorFree(drw->dpy,
	             drw->visual ? drw->visual : DefaultVisual(drw->dpy, drw->screen),
	             drw->cmap ? drw->cmap : DefaultColormap(drw->dpy, drw->screen), c);
}

void
drw_scm_free(Drw *drw, Clr *scm, size_t clrcount)
{
	size_t i;

	if (!drw || !scm)
		return;

	for (i = 0; i < clrcount; i++)
		drw_clr_free(drw, &scm[i]);
	free(scm);
}

void
drw_setfontset(Drw *drw, Fnt *set)
{
	if (drw)
		drw->fonts = set;
}

/* Rounded pill: a middle rectangle plus scanline-inset caps. radius = h/2
 * gives a capsule. PictOpSrc means "replace with this colour+alpha", so
 * the pill and bar share the same final opacity instead of compositing
 * to 1-(1-a)^2 like PictOpOver. */
void
drw_pill(Drw *drw, int x, int y, unsigned int w, unsigned int h, unsigned int r, Clr *c)
{
	XRectangle rects[2 * 64 + 1];
	unsigned int i, d, n = 0;

	if (!drw || !c || !w || !h)
		return;
	if (r * 2 > h)
		r = h / 2;
	if (r * 2 > w)
		r = w / 2;
	if (r == 0) {
		XRenderFillRectangle(drw->dpy, PictOpSrc, drw->pict, &c->color, x, y, w, h);
		return;
	}
	rects[n++] = (XRectangle){ .x = x + (int)r, .y = y, .width = w - 2 * r, .height = h };
	for (i = 0; i < r && n + 2 <= sizeof rects / sizeof rects[0]; i++) {
		d = 0;
		while (d < r && (r - i) * (r - i) + (r - d) * (r - d) > r * r)
			d++;
		rects[n++] = (XRectangle){ .x = x + (int)i, .y = y + (int)d, .width = 1, .height = h - 2 * d };
		rects[n++] = (XRectangle){ .x = x + (int)(w - 1 - i), .y = y + (int)d, .width = 1, .height = h - 2 * d };
	}
	XRenderFillRectangles(drw->dpy, PictOpSrc, drw->pict, &c->color, rects, n);
}

void
drw_rect(Drw *drw, int x, int y, unsigned int w, unsigned int h, Clr *c, int filled)
{
	if (!drw || !c || !w || !h)
		return;

	if (filled) {
		XRenderFillRectangle(drw->dpy, PictOpSrc, drw->pict, &c->color, x, y, w, h);
		return;
	}
	XRenderFillRectangle(drw->dpy, PictOpSrc, drw->pict, &c->color, x, y, w, 1);
	XRenderFillRectangle(drw->dpy, PictOpSrc, drw->pict, &c->color, x, y + h - 1, w, 1);
	XRenderFillRectangle(drw->dpy, PictOpSrc, drw->pict, &c->color, x, y, 1, h);
	XRenderFillRectangle(drw->dpy, PictOpSrc, drw->pict, &c->color, x + w - 1, y, 1, h);
}

int
drw_text(Drw *drw, int x, int y, unsigned int w, unsigned int h, unsigned int lpad, const char *text, Clr *fg, unsigned int maxwidth)
{
	int ty, ellipsis_x = 0;
	unsigned int tmpw, ew, ellipsis_w = 0, ellipsis_len, hash, h0, h1;
	XftDraw *d = NULL;
	Fnt *usedfont, *curfont, *nextfont;
	int utf8strlen, utf8charlen, utf8err, render = x || y || w || h;
	long utf8codepoint = 0;
	const char *utf8str;
	FcCharSet *fccharset;
	FcPattern *fcpattern;
	FcPattern *match;
	XftResult result;
	int charexists = 0, overflow = 0;
	/* keep track of a couple codepoints for which we have no match. */
	static unsigned int nomatches[128], ellipsis_width, invalid_width;
	static const char invalid[] = "�";

	if (!drw || !text || !drw->fonts || (render && (!fg || !w)))
		return 0;

	if (!render) {
		w = maxwidth ? maxwidth : ~0U;
	} else {
		if (w < lpad)
			return x + w;
		d = XftDrawCreate(drw->dpy, drw->drawable, drw->visual, drw->cmap);
		x += lpad;
		w -= lpad;
	}

	usedfont = drw->fonts;
	if (!ellipsis_width && render)
		ellipsis_width = drw_fontset_getwidth(drw, "...");
	if (!invalid_width && render)
		invalid_width = drw_fontset_getwidth(drw, invalid);
	while (1) {
		ew = ellipsis_len = utf8err = utf8charlen = utf8strlen = 0;
		utf8str = text;
		nextfont = NULL;
		while (*text) {
			utf8charlen = utf8decode(text, &utf8codepoint, &utf8err);
			for (curfont = drw->fonts; curfont; curfont = curfont->next) {
				charexists = charexists || XftCharExists(drw->dpy, curfont->xfont, utf8codepoint);
				if (charexists) {
					drw_font_getexts(curfont, text, utf8charlen, &tmpw, NULL);
					if (ew + ellipsis_width <= w) {
						/* keep track where the ellipsis still fits */
						ellipsis_x = x + ew;
						ellipsis_w = w - ew;
						ellipsis_len = utf8strlen;
					}

					if (ew + tmpw > w) {
						overflow = 1;
						/* called from drw_fontset_getwidth_clamp():
						 * it wants the width AFTER the overflow
						 */
						if (!render)
							x += tmpw;
						else
							utf8strlen = ellipsis_len;
					} else if (curfont == usedfont) {
						text += utf8charlen;
						utf8strlen += utf8err ? 0 : utf8charlen;
						ew += utf8err ? 0 : tmpw;
					} else {
						nextfont = curfont;
					}
					break;
				}
			}

			if (overflow || !charexists || nextfont || utf8err)
				break;
			else
				charexists = 0;
		}

		if (utf8strlen) {
			if (render) {
				ty = y + (h - usedfont->h) / 2 + usedfont->xfont->ascent;
				XftDrawStringUtf8(d, fg,
				                  usedfont->xfont, x, ty, (XftChar8 *)utf8str, utf8strlen);
			}
			x += ew;
			w -= ew;
		}
		if (utf8err && (!render || invalid_width < w)) {
			if (render)
				drw_text(drw, x, y, w, h, 0, invalid, fg, 0);
			x += invalid_width;
			w -= invalid_width;
		}
		if (render && overflow)
			drw_text(drw, ellipsis_x, y, ellipsis_w, h, 0, "...", fg, 0);

		if (!*text || overflow) {
			break;
		} else if (nextfont) {
			charexists = 0;
			usedfont = nextfont;
		} else {
			/* Regardless of whether or not a fallback font is found, the
			 * character must be drawn. */
			charexists = 1;

			hash = (unsigned int)utf8codepoint;
			hash = ((hash >> 16) ^ hash) * 0x21F0AAAD;
			hash = ((hash >> 15) ^ hash) * 0xD35A2D97;
			h0 = ((hash >> 15) ^ hash) % LENGTH(nomatches);
			h1 = (hash >> 17) % LENGTH(nomatches);
			/* avoid expensive XftFontMatch call when we know we won't find a match */
			if (nomatches[h0] == utf8codepoint || nomatches[h1] == utf8codepoint)
				goto no_match;

			fccharset = FcCharSetCreate();
			FcCharSetAddChar(fccharset, utf8codepoint);

			if (!drw->fonts->pattern) {
				/* Refer to the comment in xfont_create for more information. */
				die("the first font in the cache must be loaded from a font string.");
			}

			fcpattern = FcPatternDuplicate(drw->fonts->pattern);
			FcPatternAddCharSet(fcpattern, FC_CHARSET, fccharset);
			FcPatternAddBool(fcpattern, FC_SCALABLE, FcTrue);

			FcConfigSubstitute(NULL, fcpattern, FcMatchPattern);
			FcDefaultSubstitute(fcpattern);
			match = XftFontMatch(drw->dpy, drw->screen, fcpattern, &result);

			FcCharSetDestroy(fccharset);
			FcPatternDestroy(fcpattern);

			if (match) {
				usedfont = xfont_create(drw, NULL, match);
				if (usedfont && XftCharExists(drw->dpy, usedfont->xfont, utf8codepoint)) {
					for (curfont = drw->fonts; curfont->next; curfont = curfont->next)
						; /* NOP */
					curfont->next = usedfont;
				} else {
					xfont_free(usedfont);
					nomatches[nomatches[h0] ? h1 : h0] = utf8codepoint;
no_match:
					usedfont = drw->fonts;
				}
			}
		}
	}
	if (d)
		XftDrawDestroy(d);

	return x + (render ? w : 0);
}

void
drw_map(Drw *drw, Window win, int x, int y, unsigned int w, unsigned int h)
{
	XRenderPictFormat *fmt;
	Picture dst;

	if (!drw || !win || !w || !h)
		return;

	/* Core XCopyArea between 32-bit drawables drops alpha (measured).
	 * PictOpSrc copies the premultiplied ARGB pixmap as-is so the compositor
	 * can blend it correctly. */
	fmt = XRenderFindVisualFormat(drw->dpy, drw->visual);
	if (!fmt)
		die("dwm: the 32-bit ARGB visual has no XRender format");
	dst = XRenderCreatePicture(drw->dpy, win, fmt, 0, NULL);
	XRenderComposite(drw->dpy, PictOpSrc, drw->pict, None, dst,
	                 x, y, 0, 0, x, y, w, h);
	XRenderFreePicture(drw->dpy, dst);
	XSync(drw->dpy, False);
}

unsigned int
drw_fontset_getwidth(Drw *drw, const char *text)
{
	if (!drw || !drw->fonts || !text)
		return 0;
	return drw_text(drw, 0, 0, 0, 0, 0, text, NULL, 0);
}

unsigned int
drw_fontset_getwidth_clamp(Drw *drw, const char *text, unsigned int n)
{
	unsigned int tmp = 0;
	if (drw && drw->fonts && text && n)
		tmp = drw_text(drw, 0, 0, 0, 0, 0, text, NULL, n);
	return MIN(n, tmp);
}

void
drw_font_getexts(Fnt *font, const char *text, unsigned int len, unsigned int *w, unsigned int *h)
{
	XGlyphInfo ext;

	if (!font || !text)
		return;

	XftTextExtentsUtf8(font->dpy, font->xfont, (XftChar8 *)text, len, &ext);
	if (w)
		*w = ext.xOff;
	if (h)
		*h = font->h;
}

Cur *
drw_cur_create(Drw *drw, int shape)
{
	Cur *cur;

	if (!drw || !(cur = ecalloc(1, sizeof(Cur))))
		return NULL;

	cur->cursor = XCreateFontCursor(drw->dpy, shape);

	return cur;
}

/* Load a *named* Xcursor from the theme at exactly `size` pixels, falling back
 * to the core font cursor `shape` when the theme lacks that cursor. dwm used
 * XCreateFontCursor() only, which renders a fixed 10x16 arrow no matter what
 * the desktop's cursor size is. */
Cur *
drw_cur_create_themed(Drw *drw, int shape, const char *const *names, unsigned int size)
{
	Cur *cur;
	Cursor c = None;
	XcursorImages *images;

	if (!drw || !(cur = ecalloc(1, sizeof(Cur))))
		return NULL;

	/* Try every alias in turn: themes disagree on names ("sizing" exists in
	 * the core font cursor set but not in most Xcursor themes). size == 0
	 * falls back to the theme/Xcursor default size. */
	for (; c == None && names && *names; names++) {
		if (!**names || !(images = XcursorLibraryLoadImages(*names, NULL, (int)size)))
			continue;
		c = XcursorImagesLoadCursor(drw->dpy, images);
		XcursorImagesDestroy(images);
	}
	if (c == None)
		c = XCreateFontCursor(drw->dpy, shape);

	cur->cursor = c;

	return cur;
}

void
drw_cur_free(Drw *drw, Cur *cursor)
{
	if (!cursor)
		return;

	XFreeCursor(drw->dpy, cursor->cursor);
	free(cursor);
}
