import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webPublicDir = join(__dirname, '..', 'web', 'public');
const reportSrc = join(__dirname, 'reports', 'latest.json');
const indexSrc = join(__dirname, 'index.html');

if (!existsSync(reportSrc)) {
  console.error('No report found. Run `node admin/run-tests.mjs` first.');
  process.exit(1);
}

mkdirSync(webPublicDir, { recursive: true });
copyFileSync(indexSrc, join(webPublicDir, 'admin.html'));
copyFileSync(reportSrc, join(webPublicDir, 'admin-report.json'));

console.log('Admin assets published to web/public/');
console.log('  - web/public/admin.html');
console.log('  - web/public/admin-report.json');
