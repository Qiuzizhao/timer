import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const rootLayout = await readFile('app/_layout.tsx', 'utf8');
const indexRoute = await readFile('app/index.tsx', 'utf8');
const screen = await readFile('src/features/daily/timer/TimerScreen.tsx', 'utf8');
const provider = await readFile('src/features/daily/timer/TimerProvider.tsx', 'utf8');
const sound = await readFile('src/features/daily/timer/sound.ts', 'utf8');
const styles = await readFile('src/features/daily/timer/styles.ts', 'utf8');
const appConfig = await readFile('app.json', 'utf8');
const appDelegate = await readFile('ios/Timer/AppDelegate.swift', 'utf8');
const infoPlist = await readFile('ios/Timer/Info.plist', 'utf8');
const podfile = await readFile('ios/Podfile', 'utf8');
const podsProject = await readFile('ios/Pods/Pods.xcodeproj/project.pbxproj', 'utf8');
const appProject = await readFile('ios/Timer.xcodeproj/project.pbxproj', 'utf8');
const expoConfig = JSON.parse(appConfig).expo;
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

assert.match(rootLayout, /<TimerProvider>[\s\S]*<Stack/, 'TimerProvider should wrap the navigation stack');
assert.match(indexRoute, /<TimerScreen\s*\/>/, 'root screen should render TimerScreen directly');
assert.doesNotMatch(indexRoute, /onBack/, 'standalone Timer app should not show a no-op title-bar back button');
assert.doesNotMatch(screen, /useAudioPlayer|setInterval|setAudioModeAsync/, 'TimerScreen should not own clock or audio runtime');
assert.match(provider, /const minutePresets = \[5, 10, 25, 40\]/, 'minute presets should match SMAPP');
assert.match(provider, /useState\('5'\)/, 'default duration input should be 5 minutes');
assert.match(provider, /useState\(5 \* minuteMs\)/, 'default remaining time should be 5 minutes');
assert.match(provider, /useAudioPlayer\(require\('\.\.\/\.\.\/\.\.\/\.\.\/assets\/sounds\/timer-prompt\.wav'\)/, 'prompt audio path should match copied SMAPP structure');
assert.match(provider, /downloadFirst: true, keepAudioSessionActive: true/, 'timer sounds should be preloaded and keep the audio session active');
assert.match(provider, /await activateAudioSession\(\);[\s\S]*player\.play\(\)/, 'timer should activate audio before playback');
assert.match(provider, /shouldPlayInBackground:\s*true/, 'audio mode should request background playback');
assert.match(appConfig, /"UIBackgroundModes":\s*\[\s*"audio"\s*\]/, 'iOS config should enable background audio');
assert.equal(packageJson.dependencies['@react-native-async-storage/async-storage'], '^2.2.0', 'native builds should include AsyncStorage because Expo/React Native startup expects the native module');
assert.equal(packageJson.dependencies['expo-asset'], '~12.0.13', 'native builds should include expo-asset for bundled images and splash assets');
assert.equal(packageJson.dependencies['expo-dev-client'], undefined, 'standalone iOS builds should not include expo-dev-client or dev launcher');
assert.match(appConfig, /"expo-asset"/, 'native config should include the expo-asset plugin');
assert.match(appConfig, /"\.\/plugins\/with-ios-pod-deployment-target"/, 'prebuild should preserve the iOS Pods deployment-target fix through a config plugin');
assert.match(appConfig, /"\.\/plugins\/with-ios-scene-lifecycle"/, 'prebuild should preserve the iOS UIScene lifecycle fix through a config plugin');
assert.match(infoPlist, /UIApplicationSceneManifest/, 'iOS 27 SDK builds should declare a scene manifest');
assert.match(infoPlist, /\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate/, 'scene manifest should point to the Swift SceneDelegate');
assert.ok(existsSync('ios/Timer/SceneDelegate.swift'), 'iOS app should include SceneDelegate.swift');
assert.match(appProject, /SceneDelegate\.swift in Sources/, 'Xcode project should compile SceneDelegate.swift');
assert.doesNotMatch(appDelegate, /factory\.startReactNative\(/, 'AppDelegate should not create the root window when UIScene lifecycle is active');
assert.match(podfile, /minimum_ios_deployment_target = podfile_properties\['ios\.deploymentTarget'\] \|\| '15\.1'/, 'Podfile should centralize the minimum iOS deployment target');
assert.match(podfile, /installer\.pods_project\.targets\.each do \|target\|[\s\S]*IPHONEOS_DEPLOYMENT_TARGET[\s\S]*minimum_ios_deployment_target/, 'Podfile should raise generated Pods targets below iOS 15.1');
assert.match(appProject, new RegExp(`MARKETING_VERSION = ${escapeRegExp(expoConfig.version)};`), 'Xcode project marketing version should match app.json');
assert.match(appProject, new RegExp(`CURRENT_PROJECT_VERSION = ${expoConfig.ios.buildNumber};`), 'Xcode project build number should match app.json');
assert.doesNotMatch(podsProject, /expo-dev-(?:client|launcher|menu)/, 'standalone iOS pods should not include Expo development client pods');
assert.doesNotMatch(podsProject, /IPHONEOS_DEPLOYMENT_TARGET = (?:[0-9]\.|1[0-4]\.)/, 'Pods deployment targets should stay within the Xcode-supported iOS 15+ range');
assert.match(sound, /return action === 'finish' \? 'ring' : 'prompt'/, 'start and finish sound routing should match SMAPP');
assert.match(sound, /if \(action === 'addMinute'\) return 'addMinuteVoice'/, 'add-minute sound should use the Chinese voice cue');
assert.match(styles, /timerCircle:\s*\{[\s\S]*width:\s*280,[\s\S]*height:\s*280,/, 'timer circle dimensions should match SMAPP');
assert.match(styles, /timeText:\s*\{[\s\S]*fontSize:\s*64,/, 'time display size should match SMAPP');

for (const asset of [
  'assets/sounds/timer-prompt.wav',
  'assets/sounds/timer-tick.wav',
  'assets/sounds/timer-ring.wav',
  'assets/sounds/timer-add-minute-voice.wav',
  'assets/sounds/timer-add-minute-voice.mp3',
]) {
  assert.ok(existsSync(asset), `${asset} should exist`);
}

console.log('timer port structure checks passed');
