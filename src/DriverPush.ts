import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { NotificationClickEvent, NotificationWillDisplayEvent, PushSubscriptionChangedState } from 'react-native-onesignal';
import appConfig from '../app.json';
import { getDriverPushAlias } from './api';

export type PushDestination = { section: 'available' | 'accepted'; offerId?: string; showNative?: () => void };

let initialized = false;
const appId = appConfig.expo.extra.oneSignalAppId;

export function useDriverPush(token: string | undefined, restoring: boolean) {
  const [destination, setDestination] = useState<PushDestination | null>(null);
  const verificationShown = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web' || restoring) return;
    const controller = new AbortController();
    const { signal } = controller;
    let removeListeners: (() => void) | undefined;
    if (!token) setDestination(null);

    void import('react-native-onesignal').then(async ({ OneSignal }) => {
      if (signal.aborted) return;
      if (!initialized) {
        OneSignal.initialize(appId);
        initialized = true;
      }
      if (!token) {
        OneSignal.logout();
        return;
      }

      function verify(id: string | null | undefined) {
        if (signal.aborted || !id || id.startsWith('local-') || verificationShown.current) return;
        verificationShown.current = true;
        Alert.alert(
          'OneSignal conectado',
          'Toque abaixo para habilitar as notificações de ofertas de entrega.',
          [{ text: 'Entendi', onPress: () => {
            if (!signal.aborted) void OneSignal.Notifications.requestPermission(true).catch((error) => {
              console.warn('Não foi possível solicitar a permissão de notificações.', error);
            });
          } }],
          { cancelable: false },
        );
      }
      const onSubscriptionChange = ({ current }: PushSubscriptionChangedState) => verify(current.id);
      const onClick = ({ notification }: NotificationClickEvent) => {
        const data = notification.additionalData as Partial<PushDestination> | undefined;
        if (data?.section === 'available' || data?.section === 'accepted') setDestination({ section: data.section, offerId: data.offerId });
      };
      const onForeground = (event: NotificationWillDisplayEvent) => {
        const notification = event.getNotification();
        const data = notification.additionalData as Partial<PushDestination> | undefined;
        if (data?.section !== 'available' || typeof data.offerId !== 'string') return;
        event.preventDefault();
        setDestination({ section: 'available', offerId: data.offerId, showNative: () => notification.display() });
      };

      OneSignal.User.pushSubscription.addEventListener('change', onSubscriptionChange);
      OneSignal.Notifications.addEventListener('click', onClick);
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', onForeground);
      removeListeners = () => {
        OneSignal.User.pushSubscription.removeEventListener('change', onSubscriptionChange);
        OneSignal.Notifications.removeEventListener('click', onClick);
        OneSignal.Notifications.removeEventListener('foregroundWillDisplay', onForeground);
      };
      void OneSignal.User.pushSubscription.getIdAsync().then(verify).catch((error) => {
        if (!signal.aborted) console.warn('Não foi possível consultar a inscrição de push.', error);
      });
      const alias = await getDriverPushAlias(token, signal);
      if (!signal.aborted) OneSignal.login(alias);
    }).catch((error) => {
      if (!signal.aborted) console.warn('Não foi possível iniciar o push do UniEntregador.', error);
    });

    return () => {
      controller.abort();
      removeListeners?.();
    };
  }, [restoring, token]);

  return destination;
}
