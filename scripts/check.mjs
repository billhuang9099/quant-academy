import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const files = (await collect(join(root, 'src'))).sort();
if (!files.length) throw new Error('No JavaScript source files found in src.');
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    failures++;
    console.error(`Syntax check failed: ${relative(root, file)}`);
    console.error(result.error?.message || result.stderr || result.stdout || `Exit status: ${result.status}`);
  }
}
if (failures) process.exitCode = 1;
else console.log(`Syntax checks passed for ${files.length} JavaScript source files.`);
