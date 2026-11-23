import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptics are reserved for meaningful moments (HIG: causality, harmony, utility).
 * Fire them on the same tick as the visual change they describe.
 *
 * iOS and Android use the system haptic engine. On the web, browsers with the
 * Vibration API (Chrome and Firefox on Android) get short equivalent patterns;
 * elsewhere (desktop, iOS Safari) these are silent no-ops.
 */
const native = Platform.OS === 'ios' || Platform.OS === 'android';

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Blocked without a user gesture, or unsupported — feedback is optional
    }
  }
}

/** Light tick — goal contribution confirmed, meal swapped. */
export function tick() {
  if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else vibrate(10);
}

/** Selection changed — day picker, segmented control, chip toggle. */
export function selection() {
  if (native) Haptics.selectionAsync().catch(() => {});
  else vibrate(5);
}

/** Success pattern — document parsed, plan ready, meal cooked. */
export function success() {
  if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else vibrate([12, 60, 18]);
}

/** Warning pattern — e.g. a plan can't meet the nutrition floor on this budget. */
export function warning() {
  if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  else vibrate([20, 80, 20]);
}
