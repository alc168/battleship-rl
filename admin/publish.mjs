import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webPublicDir = join(__dirname, '..', 'web', 'public');
const reportSrc = join(__dirname, 'reports', 'latest.json');
const indexSrc = join(__dirname, 'index.html');
const workerDir = join(__dirname, '..', 'worker');

function uploadPolicyToKV() {
  const policySrc = join(__dirname, '..', 'ai_policy.json');
  if (!existsSync(policySrc)) {
    console.error('ai_policy.json not found; skipping KV policy upload.');
    return;
  }
  console.log('Uploading ai_policy.json to KV weight_map...');
  const result = spawnSync(
    'npx',
    ['wrangler', 'kv', 'key', 'put', 'weight_map', '--path=../ai_policy.json', '--binding', 'KV', '--remote'],
    { cwd: workerDir, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error('KV policy upload failed.');
    process.exit(result.status || 1);
  }
  console.log('KV weight_map updated with latest ai_policy.json.');
}

uploadPolicyToKV();

mkdirSync(webPublicDir, { recursive: true });
copyFileSync(indexSrc, join(webPublicDir, 'admin.html'));

if (existsSync(reportSrc)) {
  copyFileSync(reportSrc, join(webPublicDir, 'admin-report.json'));
  console.log('Admin assets published to web/public/');
  console.log('  - web/public/admin.html');
  console.log('  - web/public/admin-report.json');
} else {
  console.warn('No report found at admin/reports/latest.json; skipping admin-report.json');
}
