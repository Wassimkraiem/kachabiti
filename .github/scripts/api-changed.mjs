// Prints api=true when the commits between two SHAs change something the API is built or deployed
// from (docs/DEPLOY.md): api/, the migrations, the baseline, the server files, this workflow, and
// every lib/ file the API program imports. TypeScript finds those, so a new shared import counts
// without editing a list. An unknown range (first push, force push) counts as a change.
// Usage (repository root, after npm ci in api/): node .github/scripts/api-changed.mjs <before> <after>
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [before, after] = process.argv.slice(2);
const root = process.cwd();
// The shell on Windows only, where npx is npx.cmd (for trying it locally).
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });

let changed = null;
try {
  changed = run('git', ['diff', '--name-only', before, after]).split('\n').filter(Boolean);
} catch {
  // before is all zeros or no longer in the history
}

let api = true;
if (changed) {
  const shared = new Set(
    run('npx', ['tsc', '-p', 'tsconfig.json', '--listFilesOnly'], path.join(root, 'api'))
      .split('\n')
      .map((file) => path.relative(root, file.trim()).split(path.sep).join('/'))
      .filter((file) => file.startsWith('lib/')),
  );
  if (shared.size === 0) throw new Error('TypeScript listed no lib/ files: run npm ci in api/ first');
  api = changed.some(
    (file) =>
      /^(api|supabase\/migrations|deploy)\//.test(file) ||
      file === 'db/baseline.sql' ||
      file === '.github/workflows/deploy.yml' ||
      file === '.github/scripts/api-changed.mjs' ||
      shared.has(file),
  );
}
console.log(`api=${api}`);
