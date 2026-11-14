import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAthleteSession } from '@/lib/athlete-session';
import { Icon, colors, type IconName } from '@/components/ui';

const icon = (name: IconName) => {
  const TabIcon = ({ focused }: { focused: boolean }) => <Icon name={name} size={24} color={focused ? colors.goldBright : '#8d98b3'} />;
  return TabIcon;
};

export default function TabsLayout() {
  const { status } = useAthleteSession();
  const insets = useSafeAreaInsets();
  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.goldBright,
        tabBarInactiveTintColor: '#8d98b3',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '800' },
        tabBarStyle: {
          backgroundColor: colors.navy,
          borderTopColor: colors.gold,
          borderTopWidth: 2,
          height: 62 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 6 + insets.bottom,
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="pass" options={{ title: 'My Pass', tabBarIcon: icon('pass') }} />
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="performance" options={{ title: 'Results', tabBarIcon: icon('medal') }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Standings', tabBarIcon: icon('standings') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
