// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(here, 'public');
const rootPkg = JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8')) as {
  version: string;
  repository: { url: string };
};
const repo = rootPkg.repository.url.replace(/\.git$/, '');

/** AGPL section 13: point the footer "Source code" link at the exact version tag. */
function sourceLink(): Plugin {
  const tag = `v${rootPkg.version}`;
  const url = `${repo}/tree/${tag}`;
  return {
    name: 'shiftknit-source-link',
    transformIndexHtml(html) {
      const out = html
        .replace(/(id="source-link"\s+href=")[^"]*(")/, `$1${url}$2`)
        .replace(/<span id="app-version">[^<]*<\/span>/, `<span id="app-version">${tag}</span>`);
      if (!out.includes(url) || !out.includes(`>${tag}<`))
        throw new Error('index.html: could not inject the source link / version');
      return out;
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** After the build, emit a small service worker that pre-caches the whole site. */
function offline(): Plugin {
  return {
    name: 'shiftknit-offline',
    apply: 'build',
    generateBundle(_opts, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/ShiftKnit-LICENSE.txt',
        source: readFileSync(join(here, '../../LICENSE'), 'utf8'),
      });
      const files = [
        ...Object.keys(bundle),
        'licenses/ShiftKnit-LICENSE.txt',
        ...listFiles(publicDir).map((p) => relative(publicDir, p).split('\\').join('/')),
      ]
        .filter((f) => !f.endsWith('.map'))
        .sort();
      const unique = [...new Set(files)];
      const hash = createHash('sha256');
      for (const f of unique) {
        hash.update(f);
        const item = bundle[f];
        if (item) hash.update(item.type === 'chunk' ? item.code : String(item.source));
      }
      const version = hash.digest('hex').slice(0, 16);
      const urls = ['./', ...unique.map((f) => `./${f}`)];
      const sw = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated at build time: pre-caches the whole site so it works offline.
const CACHE = 'shiftknit-${version}';
const URLS = ${JSON.stringify(urls)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(URLS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shiftknit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).catch(() =>
          req.mode === 'navigate' ? caches.match('./index.html') : Response.error(),
        ),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [sourceLink(), offline()],
  define: {
    __SHIFTKNIT_VERSION__: JSON.stringify(`v${rootPkg.version}`),
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: { host: '127.0.0.1', port: 4884, strictPort: true },
  preview: { host: '127.0.0.1', port: 4885 },
});
