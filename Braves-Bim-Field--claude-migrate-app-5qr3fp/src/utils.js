// Small pure helpers shared between App.jsx and any code-split view (e.g.
// ThreeDView.jsx) — kept out of App.jsx itself so those views don't need to
// import from it, which would create a circular import once App.jsx
// lazy-loads them.
export const toNum = (v, fallback = 0) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? fallback : n;
};

export const uid = () => Math.random().toString(36).slice(2, 9);
export const genCode = () => Math.random().toString(36).slice(2, 6).toUpperCase();
