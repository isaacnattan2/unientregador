import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

const deferredKey = 'uni.updates.deferred';
const pendingKey = 'uni.updates.pending';
const embedded = 'embedded';
const enabled = Platform.OS !== 'web' && Updates.isEnabled;

function manifestId(manifest: object): string {
  if ('id' in manifest && typeof manifest.id === 'string') return manifest.id;
  throw new Error('Update manifest has no ID');
}

export function useAppUpdates(ready: boolean, pushNotice?: string) {
  const [phase, setPhase] = useState<'checking' | 'updating' | null>(null);
  const [available, setAvailable] = useState(false);
  const working = useRef(false);
  const prompted = useRef<string | undefined>(undefined);
  const initialized = useRef(false);

  const install = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    setPhase('updating');
    try {
      const update = await Updates.fetchUpdateAsync();
      if (!update.isNew && !update.isRollBackToEmbedded) {
        setAvailable(false);
        Alert.alert('Atualização indisponível', 'Verifique novamente se há uma nova versão.');
        return;
      }
      const target = update.isRollBackToEmbedded ? embedded : manifestId(update.manifest);
      await SecureStore.setItemAsync(pendingKey, target);
      try {
        await Updates.reloadAsync();
      } catch {
        Alert.alert('Atualização baixada', 'Não foi possível reabrir o app automaticamente. Feche e abra o UniEntregador para concluir.');
      }
    } catch {
      Alert.alert('Não foi possível concluir a atualização', 'Tente novamente em Meu perfil → Atualizações do app.');
    } finally {
      working.current = false;
      setPhase(null);
    }
  }, []);

  const check = useCallback(async (manual: boolean) => {
    if (!enabled) {
      if (manual) Alert.alert('Atualizações indisponíveis', 'Esta instalação não está configurada para receber atualizações pelo app.');
      return;
    }
    if (working.current) return;
    working.current = true;
    if (manual) setPhase('checking');
    try {
      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable && !update.isRollBackToEmbedded) {
        setAvailable(false);
        if (manual) Alert.alert('UniEntregador atualizado', 'Você já está usando a versão mais recente disponível.');
        return;
      }
      const id = update.isRollBackToEmbedded ? `rollback:${Updates.updateId}` : manifestId(update.manifest);
      setAvailable(true);
      if (!manual && (prompted.current === id || await SecureStore.getItemAsync(deferredKey).catch(() => null) === id)) return;
      if (!manual && AppState.currentState !== 'active') return;

      prompted.current = id;
      Alert.alert('Nova atualização disponível', 'Quer atualizar o UniEntregador agora? O app será reaberto ao concluir.', [
        { text: 'Agora não', style: 'cancel', onPress: () => { void SecureStore.setItemAsync(deferredKey, id).catch(() => undefined); } },
        { text: 'Atualizar', onPress: () => { void install(); } },
      ], { cancelable: false });
    } catch {
      if (manual) Alert.alert('Não foi possível verificar atualizações', 'Confira a sua conexão e tente novamente.');
    } finally {
      working.current = false;
      setPhase(null);
    }
  }, [install]);

  useEffect(() => {
    if (!ready || !enabled) return;
    let active = true;
    void (async () => {
      if (!initialized.current) {
        const target = await SecureStore.getItemAsync(pendingKey).catch(() => null);
        if (!active) return;
        initialized.current = true;
        if (target) {
          await SecureStore.deleteItemAsync(pendingKey).catch(() => undefined);
          if (!active) return;
          const applied = target === embedded ? Updates.isEmbeddedLaunch : Updates.updateId?.toLowerCase() === target.toLowerCase();
          Alert.alert(applied ? 'Atualização concluída' : 'Atualização não aplicada', applied
            ? 'O UniEntregador já está usando a atualização.'
            : 'O app abriu com outra versão. Você pode verificar novamente em Meu perfil.');
          return;
        }
      }
      if (AppState.currentState === 'active') void check(false);
    })();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && initialized.current) void check(false);
    });
    return () => { active = false; subscription.remove(); };
  }, [ready, check]);

  useEffect(() => {
    if (ready && pushNotice && AppState.currentState === 'active') void check(false);
  }, [ready, pushNotice, check]);

  return { available, phase, check };
}

export type AppUpdates = ReturnType<typeof useAppUpdates>;
