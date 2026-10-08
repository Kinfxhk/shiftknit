#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Prints release notes for one version, taken from CHANGELOG.md, plus the site checksum,
// the legal notes and the support link.
// Usage: node scripts/release-notes.mjs [version]   (default: root package.json version)
import { existsSync, readFileSync } from 'node:fs';

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.slice(1).search(/^## \[|^\[[^\]]+\]: /m);
const body = (next < 0 ? rest : rest.slice(0, next + 1)).split('\n').slice(1).join('\n').trim();

const lines = [body, ''];
const sumFile = `release/shiftknit-site-v${version}.zip.sha256`;
if (existsSync(sumFile)) {
  lines.push(
    '### Static site download',
    '',
    'SHA-256:',
    '',
    '```',
    readFileSync(sumFile, 'utf8').trim(),
    '```',
    '',
  );
}
lines.push(
  '### Please note · 請注意',
  '',
  '- **Not legal advice.** "Passes the check" only means the rota follows the rules you entered; it does not mean it complies with any law or contract. The Hong Kong rest-day preset is not legal advice: employers must check their own obligations.',
  '- **非法律意見。**「通過檢查」只代表更表符合你自己輸入的規則，並不代表符合任何法例或合約。香港休息日預設並非法律意見，僱主須自行確認本身的責任。',
  '- ShiftKnit is an independent open-source project and is not affiliated with any other scheduling product or company. 排更易是獨立開源項目，與任何其他排班產品或公司並無關連。',
  '',
  'If ShiftKnit helps you, you can support it at https://buymeacoffee.com/kinfxhk · 如果排更易對你有幫助，歡迎到 Buy Me a Coffee 支持。',
);
process.stdout.write(lines.join('\n') + '\n');
