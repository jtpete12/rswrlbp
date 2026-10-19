#!/usr/bin/env node
/**
 * Serve docs/ over HTTP so the Swagger UI page can fetch its spec.
 *
 * A browser will not fetch openapi.yaml over file://, so opening docs/index.html
 * directly shows an empty page. This is the smallest thing that fixes that, and
 * it has no dependencies so it works in a fresh clone.
 *
 *   node scripts/serve-docs.mjs [--port 8080]
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'docs');
const argv = process.argv.slice(2);
const PORT = Number(argv[argv.indexOf('--port') + 1]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  // normalize then strip any leading separators, so nothing escapes docs/.
  const rel = normalize(path === '/' ? 'index.html' : path).replace(/^([/\\]|\.\.)+/, '');
  try {
    const body = await readFile(join(DOCS, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`docs on http://localhost:${PORT}`);
});
