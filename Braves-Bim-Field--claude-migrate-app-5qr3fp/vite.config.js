import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Turns public/sw.js's placeholders into a real app-shell precache list so
// the PWA can open with zero connectivity (field use, airplane mode) once
// installed — without this the service worker only ever refreshes
// index.html when online, with nothing to fall back to when offline.
function pwaShellPlugin() {
  let outDir = "dist";
  let base = "/";
  return {
    name: "braves-pwa-shell",
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    closeBundle() {
      const root = path.resolve(outDir);
      const files = [];
      (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(full);
        }
      })(root);

      const urls = files
        .map((f) => base + path.relative(root, f).split(path.sep).join("/"))
        .filter((u) => !u.endsWith("/sw.js"));

      // Deterministic from the file list (which already changes whenever any
      // asset's content-hashed name changes), so every deploy gets a fresh
      // cache and the old one is dropped in the SW's activate handler.
      const cacheId = crypto.createHash("sha1").update(urls.slice().sort().join(",")).digest("hex").slice(0, 10);

      const template = fs.readFileSync(path.resolve("public/sw.js"), "utf8");
      const swOut = template
        .replace("__CACHE_NAME__", `braves-shell-${cacheId}`)
        .replace('"__PRECACHE_URLS__"', JSON.stringify(urls));
      fs.writeFileSync(path.join(root, "sw.js"), swOut);
    },
  };
}

export default defineConfig({
  // On GitHub Actions we build for GitHub Pages, served from a repo subpath.
  // Locally (dev/build) it stays "/" so npm run dev keeps working normally.
  base: process.env.GITHUB_ACTIONS ? "/Braves-Bim-Field-/" : "/",
  plugins: [react(), pwaShellPlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
