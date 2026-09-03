import React from 'react';

import { Header, IconButton, Screen } from '@/src/shared/components';

export function ScreenShell({
  title,
  subtitle,
  onBack,
  rightAction,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Screen>
      <Header
        title={title}
        subtitle={subtitle}
        action={onBack ? <IconButton name="chevron-back" label="返回模块列表" transparent onPress={onBack} /> : undefined}
        rightAction={rightAction}
      />
      {children}
    </Screen>
  );
}
