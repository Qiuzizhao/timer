import { setAudioModeAsync, setIsAudioActiveAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { DEFAULT_TIMER_SOUND_ENABLED, getTimerActionSoundCue, shouldPlayTimerTick, type TimerActionSound, type TimerSoundCue } from './sound';
import { createTimerStartSnapshot } from './time';
import { cancelEndNotification, configureNotificationHandling, END_NOTIFICATION_DELAY_MS, ensureNotificationPermissions, scheduleEndNotification } from './notifications';
import { addMinuteTimerForeground, startTimerForeground, stopTimerForeground, updateTimerForeground } from './foreground';

export const minutePresets = [5, 10, 25, 40];
export const minuteMs = 60 * 1000;

/**
 * How long the audio session stays alive after the finish ring starts, so the
 * release never cuts the ring off mid-playback.
 */
const RING_RELEASE_DELAY_MS = 2000;

type TimerContextValue = {
  durationInput: string;
  remainingMs: number;
  running: boolean;
  startedAt: Date | null;
  endsAt: Date | null;
  soundEnabled: boolean;
  totalMs: number;
  applyPreset: (minutes: number) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  addMinute: () => void;
  toggleSound: () => void;
};

const TimerContext = createContext<TimerContextValue | null>(null);

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [durationInput, setDurationInput] = useState('5');
  const [remainingMs, setRemainingMs] = useState(5 * minuteMs);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [endsAt, setEndsAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [soundEnabled, setSoundEnabled] = useState(DEFAULT_TIMER_SOUND_ENABLED);
  const promptPlayer = useAudioPlayer(require('../../../../assets/sounds/timer-prompt.wav'), { downloadFirst: true, keepAudioSessionActive: true });
  const tickPlayer = useAudioPlayer(require('../../../../assets/sounds/timer-tick.wav'), { downloadFirst: true, keepAudioSessionActive: true });
  const ringPlayer = useAudioPlayer(require('../../../../assets/sounds/timer-ring.wav'), { downloadFirst: true, keepAudioSessionActive: true });
  const addMinuteVoicePlayer = useAudioPlayer(require('../../../../assets/sounds/timer-add-minute-voice.wav'), { downloadFirst: true, keepAudioSessionActive: true });
  const previousDisplayedSecondsRef = useRef<number | null>(Math.ceil(remainingMs / 1000));
  const finishSoundPlayedRef = useRef(false);
  const runningRef = useRef(false);
  const backgroundAudioRef = useRef(false);
  const releaseBackgroundAudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const configureAudioMode = useCallback(async (background: boolean) => {
    // Flip the ref synchronously so overlapping callers share one intent.
    backgroundAudioRef.current = background;
    try {
      await setAudioModeAsync({
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldPlayInBackground: background,
      });
    } catch {
      await setAudioModeAsync({
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
      }).catch(() => undefined);
    }
  }, []);

  /**
   * Claim the audio background capability. Only ever called while an audible
   * countdown is running, so the declared `UIBackgroundModes: audio` always
   * matches real, audible output (App Review guideline 2.5.4).
   */
  const activateBackgroundAudio = useCallback(async () => {
    await configureAudioMode(true);
    await setIsAudioActiveAsync(true).catch(() => undefined);
  }, [configureAudioMode]);

  /**
   * Hand the background capability back once nothing is audible, so the app
   * never sits on the audio background mode in silence.
   */
  const releaseBackgroundAudio = useCallback(async () => {
    await configureAudioMode(false);
    await setIsAudioActiveAsync(false).catch(() => undefined);
  }, [configureAudioMode]);

  /** Make sure a one-shot sound can actually be heard right now. */
  const ensureAudioSessionActive = useCallback(async () => {
    await configureAudioMode(backgroundAudioRef.current);
    await setIsAudioActiveAsync(true).catch(() => undefined);
  }, [configureAudioMode]);

  /** Release after the finish ring, unless a new countdown already started. */
  const scheduleBackgroundAudioRelease = useCallback((delayMs: number) => {
    if (releaseBackgroundAudioTimerRef.current) clearTimeout(releaseBackgroundAudioTimerRef.current);
    releaseBackgroundAudioTimerRef.current = setTimeout(() => {
      releaseBackgroundAudioTimerRef.current = null;
      if (runningRef.current) return;
      void releaseBackgroundAudio();
    }, delayMs);
  }, [releaseBackgroundAudio]);

  const scheduleEndNotifier = useCallback((endsAt: Date) => {
    void (async () => {
      await ensureNotificationPermissions();
      // Fire a touch after the exact end so a live app cancels it first
      // (single in-app ring) while a dead app still gets the OS alert.
      await scheduleEndNotification(new Date(endsAt.getTime() + END_NOTIFICATION_DELAY_MS));
    })();
  }, []);

  useEffect(() => {
    // Configure, but do not activate, the audio session at launch: the app must
    // not hold the background audio capability while nothing is audible.
    void configureAudioMode(false);
    configureNotificationHandling();
  }, [configureAudioMode]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    promptPlayer.muted = false;
    promptPlayer.volume = 1;
    tickPlayer.muted = false;
    tickPlayer.volume = 1;
    ringPlayer.muted = false;
    ringPlayer.volume = 1;
    addMinuteVoicePlayer.muted = false;
    addMinuteVoicePlayer.volume = 1;
  }, [addMinuteVoicePlayer, promptPlayer, ringPlayer, tickPlayer]);

  const triggerHaptic = useCallback((style: 'light' | 'medium' | 'heavy' | 'notificationSuccess' = 'light') => {
    if (Platform.OS === 'web') return;
    if (style === 'notificationSuccess') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (style === 'heavy') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else if (style === 'medium') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const playTimerSound = useCallback((cue: TimerSoundCue) => {
    if (!soundEnabled) return;
    // On Android the foreground service owns the audio so it keeps playing in
    // the background; only iOS/web play through expo-audio here.
    if (Platform.OS === 'android') return;
    const player = cue === 'tick'
      ? tickPlayer
      : cue === 'ring'
        ? ringPlayer
        : cue === 'addMinuteVoice'
          ? addMinuteVoicePlayer
          : promptPlayer;
    player.muted = false;
    player.volume = 1;
    const play = async () => {
      await ensureAudioSessionActive();
      try {
        await player.seekTo(0);
        player.play();
      } catch {
        player.play();
      }
    };
    void play().catch(() => {
      setTimeout(() => {
        try {
          player.play();
        } catch {
          // Ignore playback failures from stale native player state.
        }
      }, 120);
    });
  }, [addMinuteVoicePlayer, ensureAudioSessionActive, promptPlayer, ringPlayer, soundEnabled, tickPlayer]);

  const playActionSound = useCallback((action: TimerActionSound) => {
    const cue = getTimerActionSoundCue(soundEnabled, action);
    if (cue) playTimerSound(cue);
  }, [playTimerSound, soundEnabled]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running || !endsAt) return;
    const nextRemaining = Math.max(endsAt.getTime() - now, 0);
    setRemainingMs(nextRemaining);
    if (nextRemaining === 0) {
      if (!finishSoundPlayedRef.current) {
        finishSoundPlayedRef.current = true;
        playActionSound('finish');
      }
      setRunning(false);
      stopTimerForeground();
      triggerHaptic('notificationSuccess');
      // A live app rings itself; drop the delayed safety-net notification so
      // it never double-fires.
      void cancelEndNotification();
      // The ring is audible content, so the capability is released after it.
      scheduleBackgroundAudioRelease(RING_RELEASE_DELAY_MS);
    }
  }, [endsAt, now, playActionSound, running, scheduleBackgroundAudioRelease, triggerHaptic]);

  const totalMs = useMemo(() => {
    const minutes = Number(durationInput);
    return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * minuteMs) : 0;
  }, [durationInput]);

  const displayedSeconds = Math.ceil(remainingMs / 1000);

  useEffect(() => {
    const previousDisplayedSeconds = previousDisplayedSecondsRef.current;
    if (shouldPlayTimerTick(soundEnabled, running, previousDisplayedSeconds, displayedSeconds)) {
      playTimerSound('tick');
    }
    previousDisplayedSecondsRef.current = displayedSeconds;
  }, [displayedSeconds, playTimerSound, running, soundEnabled]);

  const applyPreset = useCallback((minutes: number) => {
    if (running) return;
    triggerHaptic('light');
    setDurationInput(String(minutes));
    setRemainingMs(minutes * minuteMs);
    setStartedAt(null);
    setEndsAt(null);
  }, [running, triggerHaptic]);

  const start = useCallback(() => {
    const base = remainingMs > 0 ? remainingMs : totalMs;
    if (base <= 0) return;
    triggerHaptic('medium');
    finishSoundPlayedRef.current = false;
    previousDisplayedSecondsRef.current = Math.ceil(base / 1000);
    if (releaseBackgroundAudioTimerRef.current) {
      clearTimeout(releaseBackgroundAudioTimerRef.current);
      releaseBackgroundAudioTimerRef.current = null;
    }
    // Audible countdowns hold the audio background capability; a muted timer
    // stays foreground-only and leans on the scheduled notification instead.
    if (soundEnabled) void activateBackgroundAudio();
    playActionSound('start');
    const snapshot = createTimerStartSnapshot(base);
    const startDate = new Date(snapshot.startedAtMs);
    setStartedAt(startDate);
    setEndsAt(new Date(snapshot.endsAtMs));
    setNow(snapshot.nowMs);
    setRemainingMs(snapshot.remainingMs);
    setRunning(true);
    startTimerForeground(snapshot.endsAtMs, soundEnabled);
    scheduleEndNotifier(new Date(snapshot.endsAtMs));
  }, [activateBackgroundAudio, playActionSound, remainingMs, scheduleEndNotifier, soundEnabled, totalMs, triggerHaptic]);

  const pause = useCallback(() => {
    triggerHaptic('light');
    if (endsAt) setRemainingMs(Math.max(endsAt.getTime() - Date.now(), 0));
    setRunning(false);
    stopTimerForeground();
    void releaseBackgroundAudio();
    void cancelEndNotification();
  }, [endsAt, releaseBackgroundAudio, triggerHaptic]);

  const reset = useCallback(() => {
    triggerHaptic('heavy');
    finishSoundPlayedRef.current = false;
    setRunning(false);
    setRemainingMs(totalMs);
    setStartedAt(null);
    setEndsAt(null);
    stopTimerForeground();
    void releaseBackgroundAudio();
    void cancelEndNotification();
  }, [releaseBackgroundAudio, totalMs, triggerHaptic]);

  const addMinute = useCallback(() => {
    triggerHaptic('light');
    if (running && endsAt) {
      playActionSound('addMinute');
      const nextEnd = new Date(endsAt.getTime() + minuteMs);
      setEndsAt(nextEnd);
      setRemainingMs(Math.max(nextEnd.getTime() - Date.now(), 0));
      addMinuteTimerForeground(nextEnd.getTime(), soundEnabled);
      scheduleEndNotifier(nextEnd);
      return;
    }
    setRemainingMs((value) => value + minuteMs);
  }, [endsAt, playActionSound, running, scheduleEndNotifier, soundEnabled, triggerHaptic]);

  const toggleSound = useCallback(() => {
    triggerHaptic('light');
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (Platform.OS === 'android' && running && endsAt) {
      updateTimerForeground(endsAt.getTime(), next);
    }
    if (Platform.OS !== 'android' && running) {
      // iOS/web: the capability must mirror whether the countdown is audible.
      if (next) void activateBackgroundAudio();
      else void releaseBackgroundAudio();
    }
  }, [activateBackgroundAudio, endsAt, releaseBackgroundAudio, running, soundEnabled, triggerHaptic]);

  const value = useMemo<TimerContextValue>(() => ({
    durationInput,
    remainingMs,
    running,
    startedAt,
    endsAt,
    soundEnabled,
    totalMs,
    applyPreset,
    start,
    pause,
    reset,
    addMinute,
    toggleSound,
  }), [addMinute, applyPreset, durationInput, endsAt, pause, remainingMs, reset, running, soundEnabled, start, startedAt, toggleSound, totalMs]);

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
  const value = useContext(TimerContext);
  if (!value) throw new Error('useTimer must be used within TimerProvider');
  return value;
}
