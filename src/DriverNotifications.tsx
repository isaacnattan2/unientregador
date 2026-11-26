import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { nativeBuildVersion } from 'expo-application';
import * as Updates from 'expo-updates';
import { getDriverNotifications, markDriverNotificationRead } from './api';
import type { DriverNotification, DriverNotificationFeed } from './api';

const audience = new URLSearchParams({
  platform: Platform.OS, channel: Updates.channel ?? '', runtimeVersion: Updates.runtimeVersion ?? '',
}).toString();
const installedVersionCode = Platform.OS === 'android' ? Number(nativeBuildVersion) : 0;
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function availableApk(release: DriverNotificationFeed['release']) {
  return installedVersionCode > 0 && release && release.versionCode > installedVersionCode ? release : null;
}

export function useDriverNotifications(token: string | undefined, signal: number) {
  const [state, setState] = useState<{ token: string; feed?: DriverNotificationFeed; error?: boolean }>();
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const feed = await getDriverNotifications(token, audience, controller.signal);
      if (!controller.signal.aborted) setState({ token, feed });
    } catch {
      if (!controller.signal.aborted) setState((old) => ({ token, feed: old?.token === token ? old.feed : undefined, error: true }));
    }
  }, [token]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => { listener.remove(); request.current?.abort(); };
  }, [refresh]);
  useEffect(() => { void refresh(); }, [refresh, signal]);

  const markRead = useCallback(async (id: string) => {
    if (!token) return;
    await markDriverNotificationRead(token, audience, id);
    await refresh();
  }, [refresh, token]);

  const current = state?.token === token ? state : undefined;
  const checkApk = useCallback(async (signal: AbortSignal) => {
    if (!token) throw new Error('Entre na sua conta para atualizar o aplicativo.');
    const feed = await getDriverNotifications(token, audience, signal);
    return { release: availableApk(feed.release), hasActiveDelivery: feed.hasActiveDelivery };
  }, [token]);
  return {
    items: current?.feed?.items ?? [], unreadCount: current?.feed?.unreadCount ?? 0,
    checked: Boolean(current), error: Boolean(current?.error),
    availableRelease: availableApk(current?.feed?.release ?? null), refresh, markRead, checkApk,
  };
}

export type DriverNotifications = ReturnType<typeof useDriverNotifications>;

export function DriverNotificationPanel({ mode, token, notifications, onClose, onHistory, onSelect }: {
  mode: 'menu' | 'history'; token: string; notifications: DriverNotifications;
  onClose: () => void; onHistory: () => void; onSelect: (notice: DriverNotification) => void;
}) {
  const [history, setHistory] = useState<DriverNotification[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [pending, setPending] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyRequest = useRef<AbortController | null>(null);
  const read = mode === 'history';

  const loadHistory = useCallback(async (offset: number) => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setPending(true);
    setHistoryError(false);
    try {
      const result = await getDriverNotifications(token, audience, controller.signal, true, offset);
      if (controller.signal.aborted) return;
      setHistory((old) => offset === 0 ? result.items : [...old, ...result.items.filter((item) => !old.some(({ id }) => id === item.id))]);
      setNextOffset(result.nextOffset);
    } catch {
      if (!controller.signal.aborted) setHistoryError(true);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }, [token]);

  useEffect(() => {
    if (read) void loadHistory(0);
    return () => historyRequest.current?.abort();
  }, [loadHistory, read]);

  const items = read ? history : notifications.items;
  const error = read ? historyError : notifications.error;
  return (
    <View style={styles.overlay} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      {!read && <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />}
      <View style={read ? styles.history : styles.menu}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">{read ? 'Notificações lidas' : 'Notificações'}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar notificações" style={styles.close}>
            <Text style={styles.closeText} accessible={false}>×</Text>
          </Pressable>
        </View>
        <ScrollView style={read ? styles.historyList : styles.menuList}>
          {items.map((notice) => (
            <Pressable key={notice.id} accessibilityRole="button" onPress={() => onSelect(notice)} style={styles.item}>
              <Text style={styles.itemTitle}>{notice.title}</Text>
              <Text style={styles.body}>{notice.body}</Text>
              <Text style={styles.time}>{date.format(new Date(notice.createdAt))}</Text>
            </Pressable>
          ))}
          {!items.length && !error && <Text style={styles.empty}>
            {(read ? pending : !notifications.checked) ? 'Carregando…' : read ? 'Nenhuma notificação lida.' : 'Nenhuma notificação nova.'}
          </Text>}
          {error && <Pressable accessibilityRole="button" style={styles.action} onPress={() => {
            if (read) void loadHistory(nextOffset ?? 0);
            else void notifications.refresh();
          }}><Text style={styles.actionText}>Tentar novamente</Text></Pressable>}
          {read && items.length > 0 && !error && nextOffset !== null && <Pressable accessibilityRole="button" disabled={pending}
            style={styles.action} onPress={() => void loadHistory(nextOffset)}>
            <Text style={styles.actionText}>{pending ? 'Carregando…' : 'Ver mais'}</Text>
          </Pressable>}
        </ScrollView>
        {!read && <Pressable accessibilityRole="button" onPress={onHistory} style={styles.action}>
          <Text style={styles.actionText}>Ver notificações lidas</Text>
        </Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 12 },
  menu: { position: 'absolute', top: 54, right: 12, width: '92%', maxWidth: 380,
    backgroundColor: '#fff', borderColor: '#d9e4f0', borderWidth: 1, borderRadius: 12, elevation: 6,
    shadowColor: '#132740', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  history: { flex: 1, backgroundColor: '#fff' },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, borderBottomWidth: 1, borderBottomColor: '#d9e4f0' },
  title: { flex: 1, color: '#172a43', fontSize: 17, fontWeight: '700' },
  close: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  closeText: { fontSize: 25, color: '#4d617a' },
  menuList: { maxHeight: 320 },
  historyList: { flex: 1 },
  item: { padding: 14, gap: 4, borderBottomWidth: 1, borderBottomColor: '#e4edf5' },
  itemTitle: { color: '#172a43', fontSize: 14, fontWeight: '700' },
  body: { color: '#344a64', fontSize: 14 },
  time: { color: '#4d617a', fontSize: 12 },
  empty: { padding: 14, color: '#4d617a' },
  action: { padding: 14, minHeight: 44, alignItems: 'center' },
  actionText: { color: '#155bc7', fontWeight: '700' },
});
