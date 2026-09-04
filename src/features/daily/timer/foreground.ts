import { NativeModules, Platform } from 'react-native';

// Native Android foreground service that keeps the app process alive and plays
// the tick / finish sounds while a timer is running, so the countdown stays
// audible when the app is backgrounded. iOS uses the audio background mode.
const { TimerForeground } = NativeModules;

export function startTimerForeground(endsAt: number, soundEnabled: boolean) {
  if (Platform.OS !== 'android' || !TimerForeground) return;
  try {
    TimerForeground.start(endsAt, soundEnabled);
  } catch {
    // Best-effort; a failed start just means no background sound.
  }
}

export function updateTimerForeground(endsAt: number, soundEnabled: boolean) {
  if (Platform.OS !== 'android' || !TimerForeground) return;
  try {
    TimerForeground.update(endsAt, soundEnabled);
  } catch {
    // Nothing to update.
  }
}

export function addMinuteTimerForeground(endsAt: number, soundEnabled: boolean) {
  if (Platform.OS !== 'android' || !TimerForeground) return;
  try {
    TimerForeground.addMinute(endsAt, soundEnabled);
  } catch {
    // Nothing to update.
  }
}

export function stopTimerForeground() {
  if (Platform.OS !== 'android' || !TimerForeground) return;
  try {
    TimerForeground.stop();
  } catch {
    // Nothing to stop.
  }
}
