import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Local-notification helper for the timer's "time's up" alert.
 *
 * Why: iOS keeps the JS timer alive in the background via an active audio
 * session (`UIBackgroundModes: audio`), but Android has no equivalent, so a
 * backgrounded/killed app would never ring. A system-scheduled local
 * notification is delivered by the OS at the target time regardless of whether
 * the JS process is alive, which is how we get iOS-parity on Android.
 *
 * Behaviour:
 * - Foreground: the in-app ring already fires from `TimerProvider`, so the
 *   notification is suppressed here (no banner / no sound) to avoid a double
 *   alert.
 * - Background/terminated: the OS delivers the notification with a sound.
 */

const TIMER_CHANNEL_ID = 'timer';
const END_NOTIFICATION_ID = 'timer-end';

/**
 * Delay added to the completion time before the system notification fires.
 * When the app is alive the JS completion handler runs at `endsAt` (within one
 * 100ms tick) and cancels this pending notification before it fires, so we get
 * a single in-app ring. If the app is dead, the notification still fires a
 * moment later as the safety net. Either way there is no double-ding.
 */
const END_NOTIFICATION_DELAY_MS = 400;

let handlerConfigured = false;
let notificationRevision = 0;
let notificationQueue = Promise.resolve();

/** Register the foreground notification handler and the Android channel. */
export function configureNotificationHandling() {
  if (Platform.OS === 'web' || handlerConfigured) return;
  handlerConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // Foreground: the app renders its own completion state + ring. Suppress
      // the notification so we never double-alert while the app is in front.
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  void (async () => {
    try {
      await Notifications.setNotificationChannelAsync(TIMER_CHANNEL_ID, {
        name: '计时器',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        enableVibrate: true,
      });
    } catch {
      // Channel creation is best-effort; ignore failures (e.g. on web).
    }
  })();
}

/** Request notification permission if not already granted. Returns granted. */
export async function ensureNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

async function cancelScheduledEnd() {
  try {
    await Notifications.cancelScheduledNotificationAsync(END_NOTIFICATION_ID);
  } catch {
    // Nothing to cancel.
  }
}

/** Cancel the pending "time's up" notification, if any. */
export async function cancelEndNotification(): Promise<void> {
  if (Platform.OS === 'web') return;
  ++notificationRevision;
  notificationQueue = notificationQueue.then(cancelScheduledEnd);
  await notificationQueue;
}

/** Schedule the system reminder for the current countdown deadline. */
export async function scheduleEndNotification(endsAt: Date): Promise<void> {
  if (Platform.OS === 'web') return;
  const revision = ++notificationRevision;
  // Serialize native writes, but let pause/reset cancel while permission is pending.
  notificationQueue = notificationQueue.then(cancelScheduledEnd);
  if (!await ensureNotificationPermissions() || revision !== notificationRevision) return;

  notificationQueue = notificationQueue.then(async () => {
    if (revision !== notificationRevision || Date.now() >= endsAt.getTime()) return;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: END_NOTIFICATION_ID,
        content: {
          title: '计时结束',
          body: '计时器时间到了',
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(endsAt.getTime() + END_NOTIFICATION_DELAY_MS),
          channelId: TIMER_CHANNEL_ID,
        },
      });
    } catch {
      // The live timer still handles the alarm if scheduling fails.
    }
  });
  await notificationQueue;
}
