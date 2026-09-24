// Before first paint: pick up the theme a person chose last time, so a
// dark-mode reload does not flash Atlas light first. The key is
// THEME_STORAGE_KEY in src/workbench/theme.ts; rename both together.
// Guarded, because storage throws in some private windows.
//
// Out of line, not in index.html: the server sends `script-src 'self'`
// (server/static.ts), which blocks every inline script. index.html loads
// this with a plain synchronous <script src> in <head>, so it still runs
// before first paint. scripts/__tests__/csp-inline.test.ts pins both halves.
try {
  var t = localStorage.getItem("flightdeck-studio-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
