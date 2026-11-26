import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as FileSystem from 'expo-file-system/legacy';
import type { DriverApkRelease } from './api';
import type { DriverNotifications } from './DriverNotifications';

const installer = requireOptionalNativeModule<{
  openInstaller(fileUri: string, versionCode: number, sha256: string): Promise<'permission' | 'installer'>;
}>('UniApkUpdater');
const directory = FileSystem.cacheDirectory && FileSystem.cacheDirectory + 'apk-updates/';
const isApkHash = (hash: unknown): hash is string => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash);
const cachedFile = (release: DriverApkRelease) => directory && isApkHash(release.sha256)
  ? `${directory}${release.versionCode}-${release.sha256}.apk` : null;

type UpdateOperation = { controller: AbortController; download?: FileSystem.DownloadResumable };

export function DriverApkUpdate({ initialRelease, checkApk, onClose }: {
  initialRelease: DriverApkRelease;
  checkApk: DriverNotifications['checkApk'];
  onClose: (versionCode: number) => void;
}) {
  const [release, setRelease] = useState(initialRelease);
  const [file, setFile] = useState<string | null>(null);
  const [phase, setPhase] = useState<'checking' | 'downloading' | 'installing' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const operation = useRef<UpdateOperation | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current?.controller.abort();
      void operation.current?.download?.cancelAsync().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const candidate = cachedFile(release);
    if (!candidate) return;
    let active = true;
    void FileSystem.getInfoAsync(candidate).then((info) => {
      if (active && info.exists) setFile(candidate);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [release.versionCode, release.sha256]);

  function cancelOrClose() {
    if (phase === 'installing') return;
    if (operation.current) {
      operation.current.controller.abort();
      void operation.current.download?.cancelAsync().catch(() => undefined);
    } else {
      onClose(release.versionCode);
    }
  }

  async function run(action: 'download' | 'install') {
    if (operation.current) return;
    if (!installer || !directory) {
      setMessage('Baixe o APK na área do entregador do UniWeb. O instalador não está disponível nesta build.');
      return;
    }

    const task: UpdateOperation = { controller: new AbortController() };
    operation.current = task;
    const { signal } = task.controller;
    let partial: string | undefined;
    setPhase('checking');
    setProgress(null);
    setMessage('');
    try {
      const latest = await checkApk(signal);
      if (signal.aborted) return;
      const next = latest.release;
      if (!next) {
        setMessage('Já está usando a versão mais recente disponível.');
        return;
      }
      if (next.versionCode !== release.versionCode || next.sha256 !== release.sha256) {
        setRelease(next);
        setFile(null);
        setMessage('Há um APK mais recente. Baixe a versão atual.');
        return;
      }
      const destination = cachedFile(next);
      if (!destination || !isApkHash(next.sha256) || new URL(next.downloadUrl).protocol !== 'https:') {
        throw new Error('O servidor não informou um APK válido para download.');
      }

      const existing = await FileSystem.getInfoAsync(destination);
      if (signal.aborted) return;
      if (action === 'install') {
        if (!existing.exists) {
          setFile(null);
          setMessage('O arquivo local não está mais disponível. Baixe o APK novamente.');
          return;
        }
        if (latest.hasActiveDelivery !== false) {
          setMessage(latest.hasActiveDelivery
            ? 'Conclua a entrega em andamento antes de instalar. O APK já está baixado.'
            : 'Não foi possível confirmar se há uma entrega em andamento. Tente novamente.');
          return;
        }
        setPhase('installing');
        try {
          const result = await installer.openInstaller(destination, next.versionCode, next.sha256);
          if (signal.aborted) return;
          setMessage(result === 'permission'
            ? 'Permita instalar apps a partir do UniEntregador nas configurações do Android. Depois, volte e toque em Instalar atualização.'
            : 'Confirme a instalação na tela do Android.');
        } catch (error) {
          setFile(null);
          await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
          throw error;
        }
        return;
      }

      if (existing.exists) {
        setFile(destination);
        return;
      }

      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const entries = await FileSystem.readDirectoryAsync(directory);
      for (const entry of entries) {
        if (/^\d+-[0-9a-f]{64}\.apk(?:\.part)?$/.test(entry)) {
          await FileSystem.deleteAsync(directory + entry, { idempotent: true });
        }
      }
      if (signal.aborted) return;
      partial = destination + '.part';
      setPhase('downloading');
      task.download = FileSystem.createDownloadResumable(next.downloadUrl, partial, {}, (tick) => {
        if (signal.aborted || tick.totalBytesExpectedToWrite <= 0) return;
        setProgress(Math.min(99, Math.floor(tick.totalBytesWritten * 100 / tick.totalBytesExpectedToWrite)));
      });
      const result = await task.download.downloadAsync();
      if (signal.aborted) return;
      if (result?.status !== 200) throw new Error('Não foi possível baixar o APK. Tente novamente para obter o link atual.');
      await FileSystem.moveAsync({ from: partial, to: destination });
      if (!signal.aborted) setFile(destination);
    } catch (error) {
      if (!signal.aborted) setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o app. Tente novamente.');
    } finally {
      if (partial) await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => undefined);
      operation.current = null;
      if (mounted.current) setPhase(null);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancelOrClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal onAccessibilityEscape={cancelOrClose}>
          <Text accessibilityRole="header" style={styles.title}>Atualizar UniEntregador</Text>
          <Text style={styles.body}>Versão {release.versionName}</Text>
          {phase && <View style={styles.progress}>
            <ActivityIndicator color="#155bc7" />
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {phase === 'downloading' ? `Baixando APK${progress === null ? '…' : ` · ${progress}%`}` :
                phase === 'installing' ? 'Verificando arquivo para instalar…' : 'Consultando a versão disponível…'}
            </Text>
          </View>}
          {phase === 'downloading' && progress !== null && (
            <View style={styles.track} accessible accessibilityRole="progressbar" accessibilityLabel="Download do APK"
              accessibilityValue={{ min: 0, max: 100, now: progress }}>
              <View style={[styles.bar, { width: `${progress}%` }]} />
            </View>
          )}
          {!!message && <Text style={styles.body} accessibilityLiveRegion="polite">{message}</Text>}
          {file && !phase && !message && <Text style={styles.body}>APK baixado. Confirme a instalação na próxima tela.</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={styles.secondary} disabled={phase === 'installing'} onPress={cancelOrClose}>
              <Text style={styles.secondaryText}>{phase && phase !== 'installing' ? 'Cancelar' : 'Agora não'}</Text>
            </Pressable>
            {!phase && <Pressable accessibilityRole="button" style={styles.primary} onPress={() => void run(file ? 'install' : 'download')}>
              <Text style={styles.primaryText}>{file ? 'Instalar atualização' : 'Baixar atualização'}</Text>
            </Pressable>}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(14, 30, 49, 0.55)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 16, alignSelf: 'center', width: '100%', maxWidth: 420, padding: 20, gap: 12 },
  title: { color: '#172a43', fontWeight: '700', fontSize: 19 },
  body: { color: '#344a64', fontSize: 15, lineHeight: 21 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#d9e4f0', overflow: 'hidden' },
  bar: { height: 6, backgroundColor: '#155bc7' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
  primary: { minHeight: 44, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#155bc7' },
  secondary: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryText: { color: '#155bc7', fontWeight: '700' },
});
