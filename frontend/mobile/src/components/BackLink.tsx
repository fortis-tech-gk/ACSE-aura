import React from 'react';
import { Pressable, Text } from 'react-native';
import { router, type Href } from 'expo-router';
import { colors } from './ui';

export function BackLink({ label = 'More' }: { label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/more' as Href))}
      hitSlop={12}
      style={{ alignSelf: 'flex-start', paddingVertical: 4 }}
    >
      <Text style={{ color: colors.blue, fontWeight: '700', fontSize: 15 }}>‹ {label}</Text>
    </Pressable>
  );
}
