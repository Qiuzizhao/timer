import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/src/shared/theme';

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.brandSoft,
    zIndex: 10,
  },
  headerText: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSide: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceMuted,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonSoft: {
    backgroundColor: colors.primarySoft,
  },
  iconButtonTransparent: {
    backgroundColor: 'transparent',
    elevation: 0,
    shadowOpacity: 0,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
});
