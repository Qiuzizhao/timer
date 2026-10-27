import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
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
  const { width, height } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 960;
  const dialSize = Math.min(480, Math.max(280, Math.min(height - 220, (Math.min(width, 1320) - 480) * 0.8)));
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
    subtractMinute,
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

  const topActions = (
    <View style={styles.topActions}>
      <Pressable onPress={reset} accessibilityRole="button" accessibilityLabel="重置计时器" style={styles.soundToggle}>
        <Ionicons name="refresh-outline" size={24} color={colors.textSoft} />
      </Pressable>
      <Pressable
        accessibilityLabel={soundEnabled ? '关闭计时器声音' : '开启计时器声音'}
        accessibilityRole="button"
        onPress={toggleSound}
        style={[styles.soundToggle, soundEnabled && styles.soundToggleActive, soundEnabled && { backgroundColor: themeColors.primary }]}
      >
        <Ionicons name={soundEnabled ? 'volume-high' : 'volume-mute'} size={21} color={soundEnabled ? '#fff' : colors.textSoft} />
      </Pressable>
    </View>
  );

  const timer = (
    <View style={styles.timerCircleContainer}>
      <Animated.View style={[styles.glow, { backgroundColor: themeColors.primarySoft }, desktop && { width: dialSize + 40, height: dialSize + 40, borderRadius: (dialSize + 40) / 2 }, animatedGlow]} />
      <View style={[styles.timerCircle, desktop && { width: dialSize, height: dialSize, borderRadius: dialSize / 2 }]}>
        <Animated.Text style={[styles.timeText, desktop && { fontSize: Math.round(dialSize * 0.23) }, animatedText]}>
          {formatDuration(remainingMs)}
        </Animated.Text>
      </View>
    </View>
  );

  const panel = (
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
  );

  const actions = (
    <View style={styles.actions}>
      <Pressable onPress={subtractMinute} accessibilityRole="button" accessibilityLabel="减时1分钟" style={styles.secondaryAction}>
        <Ionicons name="remove" size={24} color={colors.textSoft} />
      </Pressable>

      <Pressable onPress={running ? pause : start} style={[styles.primaryAction, { backgroundColor: themeColors.primary }]}>
        <Ionicons name={running ? 'pause' : 'play'} size={24} color="#fff" />
        <Text style={styles.primaryActionText}>{running ? '暂停' : '开始计时'}</Text>
      </Pressable>

      <Pressable onPress={addMinute} accessibilityRole="button" accessibilityLabel="加时1分钟" style={styles.secondaryAction}>
        <Ionicons name="add" size={24} color={colors.textSoft} />
      </Pressable>
    </View>
  );

  return (
    <ScreenShell title="德育计时器" onBack={onBack}>
      {desktop ? (
        <View style={[styles.content, styles.desktopContent]}>
          <View style={styles.desktopLayout}>
            <View style={styles.desktopTimer}>{timer}</View>
            <View style={styles.desktopControls}>
              {topActions}
              {panel}
              {actions}
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          {topActions}
          <View style={styles.hero}>
            {timer}
            {panel}
          </View>
          {actions}
        </View>
      )}
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
