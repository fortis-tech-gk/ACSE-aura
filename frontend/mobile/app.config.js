// @ts-check

/**
 * One codebase, two apps:
 *
 *   APP_VARIANT=athletes  → "AURA Athletes"   (students: pass, events, reminders)   [default]
 *   APP_VARIANT=officials → "AURA Officials"  (food, warden, call room, referees…)
 *
 *   APP_VARIANT=athletes  npx expo start          # dev
 *   APP_VARIANT=officials npx expo run:android    # dev build of the officials app
 *   eas build --profile athletes-production        # see eas.json
 *
 * API base URL: EXPO_PUBLIC_API_URL (e.g. https://api.aura2026.example/api is NOT assumed —
 * set it per build). Falls back to the Android emulator → host loopback for local dev.
 *
 * NOTE: android.package / ios.bundleIdentifier are permanent once an app is uploaded to the
 * Play Store / App Store. Change them here BEFORE the first upload if needed.
 */
/** @type {Record<'athletes' | 'officials', { name: string; slug: string; scheme: string; id: string; color: string; easProjectId: string }>} */
const VARIANTS = {
  athletes: {
    name: 'AURA Athletes',
    slug: 'aura-athletes',
    scheme: 'aura-athletes',
    id: 'in.acsce.aura.athletes',
    color: '#1d4ed8',
    easProjectId: '4dd2d93e-d74e-4768-9acb-c355e388689f',
  },
  officials: {
    name: 'AURA Officials',
    slug: 'aura-officials',
    scheme: 'aura-officials',
    id: 'in.acsce.aura.officials',
    color: '#0f172a',
    easProjectId: 'fec8ea98-bdcb-4d57-9a5d-b19c008776bf',
  },
};

/** @param {import('expo/config').ConfigContext} ctx @returns {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  /** @type {'athletes' | 'officials'} */
  const variant = process.env.APP_VARIANT === 'officials' ? 'officials' : 'athletes';
  const v = VARIANTS[variant];

  return {
    ...config,
    name: v.name,
    slug: v.slug,
    owner: 'ganesh_a_k_11',
    scheme: v.scheme,
    version: '1.0.0',
    // Officials run on phones and tablets in any orientation; the athlete app stays portrait
    orientation: variant === 'officials' ? 'default' : 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: variant === 'officials',
      bundleIdentifier: v.id,
      // Only standard HTTPS — exempt from US export rules, so App Store Connect skips the
      // encryption questions on every upload
      config: { usesNonExemptEncryption: false },
      infoPlist: {
        NSCameraUsageDescription:
          variant === 'officials'
            ? 'AURA Officials uses the camera to scan athlete ID-card QR codes.'
            : 'AURA Athletes uses the camera to scan the QR code on your ID card to log in.',
      },
    },
    android: {
      package: v.id,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      // Exact-time reminders (30/10/5 min before call room). Android 14+ denies this by default;
      // the app asks the athlete to allow it and falls back to best-effort timing otherwise.
      permissions: variant === 'athletes' ? ['android.permission.SCHEDULE_EXACT_ALARM'] : ['android.permission.VIBRATE'],
    },
    web: { favicon: './assets/favicon.png' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-camera',
        {
          cameraPermission:
            variant === 'officials'
              ? 'AURA Officials uses the camera to scan athlete ID-card QR codes.'
              : 'AURA Athletes uses the camera to scan the QR code on your ID card to log in.',
        },
      ],
      [
        'expo-notifications',
        {
          color: v.color,
          defaultChannel: 'call-room',
        },
      ],
      [
        'expo-build-properties',
        {
          android: {
            // Plain-HTTP is only allowed for local test builds pointed at an http:// API
            // (e.g. http://localhost:5000/api over `adb reverse`). Real builds use https:// → blocked.
            usesCleartextTraffic: /^http:\/\//i.test(process.env.EXPO_PUBLIC_API_URL || ''),
            // Faster local builds: ANDROID_BUILD_ARCHS=arm64-v8a compiles native code for one chip
            // type only. Leave unset for store builds (all architectures).
            ...(process.env.ANDROID_BUILD_ARCHS ? { buildArchs: process.env.ANDROID_BUILD_ARCHS.split(',') } : {}),
          },
        },
      ],
    ],
    experiments: { typedRoutes: true },
    extra: {
      appVariant: variant,
      apiUrl: process.env.EXPO_PUBLIC_API_URL || null,
      // EAS project (expo.dev/accounts/ganesh_a_k_11) — also required for push notification tokens
      eas: { projectId: v.easProjectId },
    },
  };
};
