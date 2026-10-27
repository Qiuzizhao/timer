import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = await readFile('src/features/daily/timer/TimerProvider.tsx', 'utf8');
const voiceAsset = await readFile('assets/sounds/timer-add-minute-voice.wav');

function readWaveInfo(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', 'voice asset should be a RIFF file');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE', 'voice asset should be a WAVE file');

  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ') {
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    }
    if (chunkId === 'data') {
      data = buffer.subarray(chunkStart, chunkStart + chunkSize);
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  assert.ok(format, 'voice asset should include a fmt chunk');
  assert.ok(data, 'voice asset should include a data chunk');
  return { ...format, data };
}

const waveInfo = readWaveInfo(voiceAsset);
assert.equal(waveInfo.audioFormat, 1, 'voice asset should use PCM audio');
assert.equal(waveInfo.channels, 1, 'voice asset should stay mono for small app assets');
assert.equal(waveInfo.sampleRate, 44100, 'voice asset should use 44.1 kHz');
assert.equal(waveInfo.bitsPerSample, 16, 'voice asset should use 16-bit samples');
assert.ok(voiceAsset.length > 120000, 'voice asset should contain the full "加时，1分钟！" prompt');

let peak = 0;
for (let offset = 0; offset + 1 < waveInfo.data.length; offset += 2) {
  peak = Math.max(peak, Math.abs(waveInfo.data.readInt16LE(offset)));
}
assert.ok(peak >= 30000, `add-minute voice should be normalized loudly; got peak ${peak}`);

assert.match(source, /timer-add-minute-voice\.wav/, 'timer should load the add-minute Chinese voice asset as a WAV file');
assert.match(source, /const addMinuteVoicePlayer = useAudioPlayer/, 'timer should create a dedicated add-minute voice player');
assert.match(source, /cue === 'addMinuteVoice'[\s\S]*\? addMinuteVoicePlayer/, 'timer should route the add-minute cue to the voice player');
assert.match(
  source,
  /const addMinute = useCallback\(\(\) => \{[\s\S]*if \(running && endsAt\) \{[\s\S]*playActionSound\('addMinute'\)/,
  'timer should play the add-minute voice only after the timer has started',
);

// Exercise Android resource generation, including migration from the old MP3.
fs.mkdirSync('.tmp', { recursive: true });
const nativeRoot = fs.mkdtempSync(path.resolve('.tmp/timer-voice-'));
try {
  const raw = path.join(nativeRoot, 'app/src/main/res/raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'timer_add_minute_voice.mp3'), 'legacy recording');
  let generateSources;
  const module = { exports: {} };
  const pluginSource = await readFile('plugins/with-timer-foreground-service.js', 'utf8');
  vm.runInNewContext(pluginSource, {
    module,
    require(name) {
      if (name === 'fs') return fs;
      if (name === 'path') return path;
      if (name === '@expo/config-plugins') return {
        withAndroidManifest: (config) => config,
        withMainApplication: (config) => config,
        withDangerousMod(config, [, callback]) {
          generateSources = callback;
          return config;
        },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  module.exports({});
  const config = { modRequest: { platformProjectRoot: nativeRoot, projectRoot: process.cwd() } };
  await generateSources(config);
  await generateSources(config);
  assert.deepEqual(
    await readFile(path.join(raw, 'timer_add_minute_voice.wav')),
    voiceAsset,
    'Android must package the exact same add-minute recording as iOS',
  );
  assert.equal(fs.existsSync(path.join(raw, 'timer_add_minute_voice.mp3')), false,
    'prebuild must remove the old Android recording');
} finally {
  fs.rmSync(nativeRoot, { recursive: true, force: true });
}

console.log('timer add-minute voice checks passed');
