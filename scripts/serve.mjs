#!/usr/bin/env node
// Tiny static file server + CORS-bypassing proxy for the TV 2 Fantasy API.
// No dependencies. Usage: npm start
//
// The /proxy/* route forwards to fantasy.tv2.no so the browser can load live
// data despite CORS. Only the allow-listed paths below are forwarded.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const PORT = Number(process.env.PORT ?? 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

// Allow-list of proxy paths. Regex must match the portion AFTER /proxy.
// The host is rotated automatically (tv2 -> eliteserien.no) on failure.
const PROXY_ALLOW = [
  /^\/api\/bootstrap-static\/?$/,
  /^\/api\/fixtures\/?$/,
  /^\/api\/entry\/\d+\/?$/,
  /^\/api\/entry\/\d+\/event\/\d+\/picks\/?$/,
  /^\/api\/entry\/\d+\/history\/?$/,
  /^\/api\/element-summary\/\d+\/?$/,
];

const UPSTREAMS = ["https://fantasy.tv2.no", "https://fantasy.eliteserien.no"];

const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
  Referer: "https://fantasy.tv2.no/",
  Origin: "https://fantasy.tv2.no",
};

async function fetchFirstUpstream(path) {
  const errors = [];
  for (const base of UPSTREAMS) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(base + path, {
        headers: UPSTREAM_HEADERS,
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        errors.push(`${base + path} -> HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      return { base, body };
    } catch (err) {
      clearTimeout(timeout);
      errors.push(`${base + path} -> ${err.message}`);
    }
  }
  const e = new Error("All upstreams failed: " + errors.join("; "));
  e.upstreamErrors = errors;
  throw e;
}

async function handleProxy(req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/^\/proxy/, "") + (url.search || "");
  const pathname = url.pathname.replace(/^\/proxy/, "");
  if (!PROXY_ALLOW.some((re) => re.test(pathname))) {
    res
      .writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ error: "path not allow-listed", path: pathname }));
    return;
  }
  try {
    const { base, body } = await fetchFirstUpstream(path);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Upstream": base,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
  } catch (err) {
    res
      .writeHead(502, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ error: err.message, errors: err.upstreamErrors }));
  }
}

async function handleStatic(req, res) {
  let reqPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (reqPath === "/") reqPath = "/index.html";
  const target = resolve(join(ROOT, normalize(reqPath)));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  const s = await stat(target).catch(() => null);
  if (!s || !s.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const body = await readFile(target);
  res.writeHead(200, {
    "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/proxy/")) {
      return await handleProxy(req, res);
    }
    return await handleStatic(req, res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Server error: " + err.message);
  }
}).listen(PORT, () => {
  console.log(`eliteplan serving http://localhost:${PORT}`);
  console.log(`proxy:   http://localhost:${PORT}/proxy/api/bootstrap-static`);
});
