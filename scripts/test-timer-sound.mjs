import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const outDir = '.tmp/timer-sound-test';

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
await mkdir(outDir, { recursive: true });

execFileSync(
  'npx',
  [
    'tsc',
    'src/features/daily/timer/sound.ts',
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
const { DEFAULT_TIMER_SOUND_ENABLED, getTimerActionSoundCue, shouldPlayTimerTick } = require(resolve(`${outDir}/sound.js`));

assert.equal(DEFAULT_TIMER_SOUND_ENABLED, true, 'timer sound should be enabled by default');
assert.equal(getTimerActionSoundCue(true, 'start'), 'prompt', 'starting should use the prompt sound when audio is enabled');
assert.equal(getTimerActionSoundCue(true, 'addMinute'), 'addMinuteVoice', 'adding one minute should use the Chinese voice prompt');
assert.equal(getTimerActionSoundCue(true, 'finish'), 'ring', 'finishing should use the ring sound');
assert.equal(getTimerActionSoundCue(false, 'start'), null, 'muted timers should not play action sounds');

assert.equal(shouldPlayTimerTick(true, true, 60, 59), true, 'running timer should tick when displayed seconds decrease');
assert.equal(shouldPlayTimerTick(true, true, 59, 59), false, 'same displayed second should not repeat a tick');
assert.equal(shouldPlayTimerTick(true, true, 1, 0), false, 'final transition should be handled by the finish ring');
assert.equal(shouldPlayTimerTick(false, true, 60, 59), false, 'muted timer should not tick');
assert.equal(shouldPlayTimerTick(true, false, 60, 59), false, 'paused timer should not tick');

console.log('timer sound checks passed');
