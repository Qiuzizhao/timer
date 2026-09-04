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

  const activateAudioSession = useCallback(async () => {
    try {
      await setAudioModeAsync({
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });
    } catch {
      await setAudioModeAsync({
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
      }).catch(() => undefined);
    }
    await setIsAudioActiveAsync(true).catch(() => undefined);
  }, []);

  const scheduleEndNotifier = useCallback((endsAt: Date) => {
    void (async () => {
      await ensureNotificationPermissions();
      // Fire a touch after the exact end so a live app cancels it first
      // (single in-app ring) while a dead app still gets the OS alert.
      await scheduleEndNotification(new Date(endsAt.getTime() + END_NOTIFICATION_DELAY_MS));
    })();
  }, []);

  useEffect(() => {
    void activateAudioSession();
    configureNotificationHandling();
  }, [activateAudioSession]);

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
      await activateAudioSession();
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
  }, [activateAudioSession, addMinuteVoicePlayer, promptPlayer, ringPlayer, soundEnabled, tickPlayer]);

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
    }
  }, [endsAt, now, playActionSound, running, triggerHaptic]);

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
  }, [playActionSound, remainingMs, scheduleEndNotifier, soundEnabled, totalMs, triggerHaptic]);

  const pause = useCallback(() => {
    triggerHaptic('light');
    if (endsAt) setRemainingMs(Math.max(endsAt.getTime() - Date.now(), 0));
    setRunning(false);
    stopTimerForeground();
    void cancelEndNotification();
  }, [endsAt, triggerHaptic]);

  const reset = useCallback(() => {
    triggerHaptic('heavy');
    finishSoundPlayedRef.current = false;
    setRunning(false);
    setRemainingMs(totalMs);
    setStartedAt(null);
    setEndsAt(null);
    stopTimerForeground();
    void cancelEndNotification();
  }, [totalMs, triggerHaptic]);

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
    setSoundEnabled((enabled) => {
      const next = !enabled;
      if (Platform.OS === 'android' && running && endsAt) {
        updateTimerForeground(endsAt.getTime(), next);
      }
      return next;
    });
  }, [endsAt, running, triggerHaptic]);

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
