import { useWindowDimensions } from 'react-native';

/**
 * Screen-size rules for the officials app (phones and tablets, any orientation).
 *   wide  — landscape with room for two columns: camera left, controls right
 *   large — tablet-sized screen: bigger camera and result text
 *   cameraHeight — as large as the screen allows while leaving room for the controls
 */
export function useOfficialsLayout() {
  const { width, height } = useWindowDimensions();
  const large = Math.min(width, height) >= 600;
  const wide = width >= 720 && width > height;
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), hi));
  const cameraHeight = wide
    ? clamp(height - (height < 500 ? 130 : 230), 220, 680) // short landscape phones keep the bib box on screen
    : clamp(height * (large ? 0.5 : 0.44), 260, large ? 640 : 420);
  return { width, height, wide, large, cameraHeight };
}
