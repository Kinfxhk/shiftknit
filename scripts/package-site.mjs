#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Package the built static site into release/shiftknit-site-v<version>.zip (with licence
// files), plus a SHA-256 checksum. Run `npm run build` first. No extra dependencies:
// a minimal ZIP writer (deflate via node:zlib).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const dist = 'packages/web/dist';
if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build found. Run "npm run build" first.');
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir)
    .sort()
    .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

const prefix = `shiftknit-site-v${version}/`;
const entries = [
  ...walk(dist).map((f) => [prefix + relative(dist, f).split('\\').join('/'), readFileSync(f)]),
  ...['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'].map((f) => [prefix + f, readFileSync(f)]),
  [
    prefix + 'README.txt',
    Buffer.from(
      `ShiftKnit ${version} - static site\n\n` +
        'Serve this folder with any static web server (for offline use it must be served\n' +
        'over http://localhost or https so the service worker can register), e.g.\n' +
        '  python3 -m http.server 8080 --bind 127.0.0.1\n' +
        'then open http://127.0.0.1:8080/\n\n' +
        'Licence: AGPL-3.0-or-later (see LICENSE). Source: https://github.com/Kinfxhk/shiftknit\n' +
        'Not legal advice: a rota that passes the check only follows the rules you entered.\n',
    ),
  ],
];

// Fixed timestamp (1980-01-01) so the archive is reproducible.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const locals = [];
const centrals = [];
let offset = 0;
for (const [name, data] of entries) {
  const nameBuf = Buffer.from(name, 'utf8');
  const comp = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, comp);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, ...centrals, end]);

mkdirSync('release', { recursive: true });
const out = `release/shiftknit-site-v${version}.zip`;
writeFileSync(out, zip);
const sum = createHash('sha256').update(zip).digest('hex');
writeFileSync(`${out}.sha256`, `${sum}  shiftknit-site-v${version}.zip\n`);
console.info(`wrote ${out} (${entries.length} files, ${zip.length} bytes)\nsha256 ${sum}`);
