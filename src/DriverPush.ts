import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { NotificationClickEvent, NotificationWillDisplayEvent } from 'react-native-onesignal';
import appConfig from '../app.json';
import { getDriverPushAlias } from './api';

export type PushDestination = { section: 'available' | 'accepted'; offerId?: string; showNative?: () => void };
export type OrderCancellationNotice = { id: string; orderId: string };
type DriverPushData = Partial<PushDestination> & { event?: string; orderId?: string };

let initialized = false;
const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID?.trim() || appConfig.expo.extra.oneSignalAppId;

export function useDriverPush(token: string | undefined, restoring: boolean) {
  const [destination, setDestination] = useState<PushDestination | null>(null);
  const [cancellations, setCancellations] = useState<OrderCancellationNotice[]>([]);
  const permissionRequested = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || restoring) return;
    const controller = new AbortController();
    const { signal } = controller;
    let removeListeners: (() => void) | undefined;
    if (!token) {
      setDestination(null);
      setCancellations([]);
    }

    void import('react-native-onesignal').then(async ({ LogLevel, OneSignal }) => {
      if (signal.aborted) return;
      if (!initialized) {
        if (process.env.EXPO_PUBLIC_ONESIGNAL_DEBUG === '1') OneSignal.Debug.setLogLevel(LogLevel.Verbose);
        OneSignal.initialize(appId);
        initialized = true;
      }
      if (!token) {
        OneSignal.logout();
        return;
      }

      const seenCancellations = new Set<string>();
      function queueCancellation(id: string, data: DriverPushData | undefined) {
        if (data?.event !== 'cancelled' || typeof data.orderId !== 'string') return false;
        const { orderId } = data;
        if (!seenCancellations.has(id)) {
          seenCancellations.add(id);
          setCancellations((current) => [...current, { id, orderId }]);
        }
        return true;
      }
      const onClick = ({ notification }: NotificationClickEvent) => {
        const data = notification.additionalData as DriverPushData | undefined;
        if (queueCancellation(notification.notificationId, data)) return;
        if (data?.section === 'available' || data?.section === 'accepted') setDestination({ section: data.section, offerId: data.offerId });
      };
      const onForeground = (event: NotificationWillDisplayEvent) => {
        const notification = event.getNotification();
        const data = notification.additionalData as DriverPushData | undefined;
        if (queueCancellation(notification.notificationId, data)) {
          event.preventDefault();
          return;
        }
        if (data?.section !== 'available' || typeof data.offerId !== 'string') return;
        event.preventDefault();
        setDestination({ section: 'available', offerId: data.offerId, showNative: () => notification.display() });
      };

      OneSignal.Notifications.addEventListener('click', onClick);
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', onForeground);
      removeListeners = () => {
        OneSignal.Notifications.removeEventListener('click', onClick);
        OneSignal.Notifications.removeEventListener('foregroundWillDisplay', onForeground);
      };
      const alias = await getDriverPushAlias(token, signal);
      if (signal.aborted) return;
      OneSignal.login(alias);

      let granted = await OneSignal.Notifications.getPermissionAsync();
      if (signal.aborted) return;
      if (!granted && !permissionRequested.current) {
        permissionRequested.current = true;
        granted = await OneSignal.Notifications.requestPermission(true);
      }
      if (!signal.aborted && granted) OneSignal.User.pushSubscription.optIn();
    }).catch((error) => {
      if (!signal.aborted) console.warn('Não foi possível iniciar o push do UniEntregador.', error);
    });

    return () => {
      controller.abort();
      removeListeners?.();
    };
  }, [restoring, token]);

  return {
    destination,
    cancellation: cancellations[0],
    acknowledgeCancellation: (id: string) => setCancellations((current) => current.filter((notice) => notice.id !== id)),
  };
}
