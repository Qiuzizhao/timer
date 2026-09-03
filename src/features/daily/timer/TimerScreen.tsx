import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  interpolate,
} from 'react-native-reanimated';

import { ScreenShell } from '../_shared/ReplicatedScreens';
import { colors, useThemeColors } from '@/src/shared/theme';
import { colorWithAlpha } from '@/src/shared/utils';
import { styles } from './styles';
import { minutePresets, useTimer } from './TimerProvider';

export function TimerScreen({ onBack }: { onBack?: () => void }) {
  const themeColors = useThemeColors();
  const {
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
  } = useTimer();

  // Animation shared values
  const glowScale = useSharedValue(1);
  const progressValue = useSharedValue(0);

  useEffect(() => {
    if (running) {
      glowScale.value = withRepeat(
        withSequence(withTiming(1.1, { duration: 1500 }), withTiming(1, { duration: 1500 })),
        -1,
        true
      );
    } else {
      glowScale.value = withTiming(1);
    }
  }, [glowScale, running]);

  useEffect(() => {
    const p = totalMs > 0 ? 1 - remainingMs / totalMs : 0;
    progressValue.value = withTiming(p, { duration: 100 });
  }, [progressValue, remainingMs, totalMs]);

  const animatedGlow = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
    opacity: interpolate(glowScale.value, [1, 1.1], [0.3, 0.6]),
  }));

  const animatedText = useAnimatedStyle(() => ({
    transform: [{ scale: running ? withSpring(1.05) : withSpring(1) }],
  }));

  return (
    <ScreenShell title="计时器" onBack={onBack}>
      <View style={styles.content}>
        <Pressable
          accessibilityLabel={soundEnabled ? '关闭计时器声音' : '开启计时器声音'}
          accessibilityRole="button"
          onPress={toggleSound}
          style={[styles.soundToggle, soundEnabled && styles.soundToggleActive, soundEnabled && { backgroundColor: themeColors.primary }]}
        >
          <Ionicons name={soundEnabled ? 'volume-high' : 'volume-mute'} size={21} color={soundEnabled ? '#fff' : colors.textSoft} />
        </Pressable>

        <View style={styles.timerCircleContainer}>
          <Animated.View style={[styles.glow, { backgroundColor: themeColors.primarySoft }, animatedGlow]} />
          <View style={styles.timerCircle}>
            <Animated.Text style={[styles.timeText, animatedText]}>
              {formatDuration(remainingMs)}
            </Animated.Text>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.presets}>
            {minutePresets.map((minutes) => {
              const selected = durationInput === String(minutes);
              return (
                <Pressable
                  key={minutes}
                  onPress={() => applyPreset(minutes)}
                  style={[styles.presetButton, selected && styles.presetButtonSelected, selected && { backgroundColor: colorWithAlpha(themeColors.primary), borderColor: themeColors.primary }, running && styles.disabled]}
                >
                  <Text style={[styles.presetText, selected && styles.presetTextSelected, selected && { color: themeColors.primary }]}>{minutes}m</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.timeInfoGrid}>
            <Info label="开始时间" value={startedAt ? formatClock(startedAt) : '--:--'} />
            <Info label="预计结束" value={endsAt ? formatClock(endsAt) : '--:--'} />
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable onPress={reset} style={styles.secondaryAction}>
            <Ionicons name="refresh-outline" size={24} color={colors.textSoft} />
          </Pressable>
          
          <Pressable onPress={running ? pause : start} style={[styles.primaryAction, { backgroundColor: themeColors.primary }]}>
            <Ionicons name={running ? 'pause' : 'play'} size={24} color="#fff" />
            <Text style={styles.primaryActionText}>{running ? '暂停' : '开始计时'}</Text>
          </Pressable>

          <Pressable onPress={addMinute} style={styles.secondaryAction}>
            <Ionicons name="add" size={24} color={colors.textSoft} />
          </Pressable>
        </View>
      </View>
    </ScreenShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatDuration(value: number) {
  const totalSeconds = Math.ceil(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatClock(value: Date) {
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  const seconds = String(value.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}
