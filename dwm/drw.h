/* See LICENSE file for copyright and license details. */

typedef struct {
	Cursor cursor;
} Cur;

typedef struct Fnt {
	Display *dpy;
	unsigned int h;
	XftFont *xfont;
	FcPattern *pattern;
	struct Fnt *next;
} Fnt;

enum { ColFg, ColBg, ColBorder }; /* Clr scheme index */
typedef XftColor Clr;

typedef struct {
	unsigned int w, h;
	Display *dpy;
	int screen;
	Window root;
	Visual *visual;
	unsigned int depth;
	Colormap cmap;
	Drawable drawable;
	Picture pict; /* always a 32-bit ARGB XRender Picture */
	Fnt *fonts;
} Drw;

/* Drawable abstraction */
Drw *drw_create(Display *dpy, int screen, Window win, unsigned int w, unsigned int h, Visual *visual, unsigned int depth, Colormap cmap);
void drw_resize(Drw *drw, unsigned int w, unsigned int h);
void drw_free(Drw *drw);

/* Fnt abstraction */
Fnt *drw_fontset_create(Drw* drw, const char *fonts[], size_t fontcount);
void drw_fontset_free(Fnt* set);
unsigned int drw_fontset_getwidth(Drw *drw, const char *text);
unsigned int drw_fontset_getwidth_clamp(Drw *drw, const char *text, unsigned int n);
void drw_font_getexts(Fnt *font, const char *text, unsigned int len, unsigned int *w, unsigned int *h);

/* Colorscheme abstraction */
void drw_clr_create(Drw *drw, Clr *dest, const char *clrname, unsigned int alpha);
void drw_clr_free(Drw *drw, Clr *c);
Clr *drw_scm_create(Drw *drw, const char *clrnames[], const unsigned int clralphas[], size_t clrcount);
void drw_scm_free(Drw *drw, Clr *scm, size_t clrcount);

/* Cursor abstraction */
Cur *drw_cur_create(Drw *drw, int shape);
Cur *drw_cur_create_themed(Drw *drw, int shape, const char *const *names, unsigned int size);
void drw_cur_free(Drw *drw, Cur *cursor);

/* Drawing context manipulation */
void drw_setfontset(Drw *drw, Fnt *set);

/* Drawing functions */
void drw_rect(Drw *drw, int x, int y, unsigned int w, unsigned int h, Clr *c, int filled);
void drw_pill(Drw *drw, int x, int y, unsigned int w, unsigned int h, unsigned int r, Clr *c);
int drw_text(Drw *drw, int x, int y, unsigned int w, unsigned int h, unsigned int lpad, const char *text, Clr *fg, unsigned int maxwidth);

/* Map functions */
void drw_map(Drw *drw, Window win, int x, int y, unsigned int w, unsigned int h);
