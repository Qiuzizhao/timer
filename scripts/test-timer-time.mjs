import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const outDir = '.tmp/timer-time-test';

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
await mkdir(outDir, { recursive: true });

execFileSync(
  'npx',
  [
    'tsc',
    'src/features/daily/timer/time.ts',
    '--outDir',
    outDir,
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--moduleResolution',
    'node',
    '--skipLibCheck',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

const require = createRequire(import.meta.url);
const { createTimerStartSnapshot } = require(resolve(`${outDir}/time.js`));

const baseMs = 10 * 60 * 1000;
const startedAtMs = 1_800_000;
const snapshot = createTimerStartSnapshot(baseMs, startedAtMs);

assert.equal(snapshot.nowMs, startedAtMs, 'start snapshot should synchronize now with the exact start time');
assert.equal(snapshot.remainingMs, baseMs, 'start snapshot should preserve the visible duration');
assert.equal(snapshot.endsAtMs, startedAtMs + baseMs, 'end time should be based on the same start timestamp');
assert.equal(snapshot.endsAtMs - snapshot.nowMs, baseMs, 'remaining calculation should not include stale time before pressing start');

console.log('timer time checks passed');
