import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, useThemeColors } from '@/src/shared/theme';
import { styles } from './styles';

export function Screen({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" backgroundColor={colors.brandSoft} translucent />
      <View style={{ height: insets.top, backgroundColor: colors.brandSoft }} />
      {children}
    </View>
  );
}

export function Header({
  title,
  subtitle: _subtitle,
  action,
  rightAction,
  centered: _centered,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  rightAction?: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{action}</View>
      <View style={styles.headerText}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={styles.headerSide}>{rightAction}</View>
    </View>
  );
}

export function IconButton({
  name,
  onPress,
  color,
  label,
  soft,
  transparent,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  color?: string;
  label?: string;
  soft?: boolean;
  transparent?: boolean;
}) {
  const themeColors = useThemeColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        soft && [styles.iconButtonSoft, { backgroundColor: themeColors.primarySoft }],
        transparent && styles.iconButtonTransparent,
        pressed && styles.pressed,
      ]}>
      <Ionicons name={name} size={21} color={color || colors.text} />
    </Pressable>
  );
}
