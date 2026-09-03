export type TimerActionSound = 'start' | 'addMinute' | 'finish';
export type TimerSoundCue = 'prompt' | 'tick' | 'ring' | 'addMinuteVoice';

export const DEFAULT_TIMER_SOUND_ENABLED = true;

export function getTimerActionSoundCue(soundEnabled: boolean, action: TimerActionSound): TimerSoundCue | null {
  if (!soundEnabled) return null;
  if (action === 'addMinute') return 'addMinuteVoice';
  return action === 'finish' ? 'ring' : 'prompt';
}

export function shouldPlayTimerTick(
  soundEnabled: boolean,
  running: boolean,
  previousDisplayedSeconds: number | null,
  nextDisplayedSeconds: number,
) {
  return Boolean(
    soundEnabled &&
      running &&
      previousDisplayedSeconds !== null &&
      nextDisplayedSeconds > 0 &&
      nextDisplayedSeconds < previousDisplayedSeconds,
  );
}
