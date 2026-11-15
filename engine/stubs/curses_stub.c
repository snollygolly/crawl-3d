/* No-op curses for the browser build. The game always runs headless there,
   but a few console calls still happen during startup. */
#define NCURSES_WIDECHAR 1
#define _XOPEN_SOURCE_EXTENDED 1
#define NCURSES_NOMACROS 1
#include <curses.h>
#include <stdlib.h>

WINDOW *stdscr = NULL;
int COLORS = 8;
int COLOR_PAIRS = 64;
int LINES = 24;
int COLS = 80;

int assume_default_colors(int a, int b) { return OK; }
int clear(void) { return OK; }
int curs_set(int v) { return 1; }
int define_key(const char *d, int k) { return OK; }
int endwin(void) { return OK; }
int getcchar(const cchar_t *c, wchar_t *w, attr_t *a, NCURSES_PAIRS_T *p, void *o) { return ERR; }
int getcurx(const WINDOW *w) { return 0; }
int getcury(const WINDOW *w) { return 0; }
int getmouse(MEVENT *e) { return ERR; }
int init_pair(NCURSES_PAIRS_T p, NCURSES_COLOR_T f, NCURSES_COLOR_T b) { return OK; }
static char fake_window[4096];
WINDOW *initscr(void) { return (WINDOW *) fake_window; }
int intrflush(WINDOW *w, bool b) { return OK; }
int key_defined(const char *d) { return 0; }
int keypad(WINDOW *w, bool b) { return OK; }
int meta(WINDOW *w, bool b) { return OK; }
mmask_t mousemask(mmask_t m, mmask_t *o) { if (o) *o = 0; return 0; }
int move(int y, int x) { return OK; }
int nodelay(WINDOW *w, bool b) { return OK; }
int noecho(void) { return OK; }
int nonl(void) { return OK; }
int pair_content(NCURSES_PAIRS_T p, NCURSES_COLOR_T *f, NCURSES_COLOR_T *b) { if (f) *f = 7; if (b) *b = 0; return OK; }
int raw(void) { return OK; }
int refresh(void) { return OK; }
int scrollok(WINDOW *w, bool b) { return OK; }
int set_escdelay(int d) { return OK; }
int setcchar(cchar_t *c, const wchar_t *w, const attr_t a, NCURSES_PAIRS_T p, const void *o) { return OK; }
int start_color(void) { return OK; }
char *termname(void) { return "xterm"; }
int use_default_colors(void) { return OK; }
int wadd_wchnstr(WINDOW *w, const cchar_t *c, int n) { return OK; }
int waddnwstr(WINDOW *w, const wchar_t *s, int n) { return OK; }
int wattr_set(WINDOW *w, attr_t a, NCURSES_PAIRS_T p, void *o) { return OK; }
int wclrtoeol(WINDOW *w) { return OK; }
int wget_wch(WINDOW *w, wint_t *c) { return ERR; }
int win_wch(WINDOW *w, cchar_t *c) { return ERR; }
int wmove(WINDOW *w, int y, int x) { return OK; }
void wtimeout(WINDOW *w, int t) { }
