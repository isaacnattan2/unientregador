import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, getDriverFinance } from './api';
import type { DriverFinance } from './api';
import { useAppTheme } from './AppTheme';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function DriverFinanceScreen({ token, menuOpen, onBack, onExpired }: {
  token: string; menuOpen: boolean; onBack: () => void; onExpired: () => void;
}) {
  const theme = useAppTheme();
  const [data, setData] = useState<DriverFinance>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void getDriverFinance(token, controller.signal).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setData(undefined);
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) onExpired();
      else setError(failure instanceof Error ? failure.message : 'Não foi possível consultar o saldo.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [token, onExpired, revision]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') setRevision((current) => current + 1);
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (menuOpen) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => listener.remove();
  }, [menuOpen, onBack]);

  const canWithdraw = !loading && data?.configured && data.availableBalance > 0 && data.approval.bankAccountInfo === 'APPROVED';
  function openWithdrawal() {
    if (!canWithdraw || !data?.configured) return;
    setError('');
    void Linking.openURL(data.sandbox ? 'https://sandbox.asaas.com/login/auth' : 'https://www.asaas.com/login/auth').catch(() => {
      setError('Não foi possível abrir o Asaas. Tente novamente.');
    });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.secondaryInk }]}>Financeiro</Text>
        <Pressable accessibilityRole="button" disabled={loading} onPress={() => setRevision((current) => current + 1)} style={styles.button}>
          <Text style={[styles.action, { color: theme.primaryInk, opacity: loading ? 0.5 : 1 }]}>Atualizar saldo</Text>
        </Pressable>
      </View>
      {loading && <ActivityIndicator color={theme.primary} accessibilityLabel="Consultando saldo" />}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {data?.configured ? (
        <View style={styles.card}>
          <Text style={styles.caption}>Saldo disponível no Asaas{data.sandbox ? ' · Sandbox' : ''}</Text>
          <Text style={[styles.balance, { color: theme.secondaryInk }]}>{currency.format(data.availableBalance)}</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canWithdraw }} disabled={!canWithdraw}
            onPress={openWithdrawal} style={[styles.button, { backgroundColor: theme.primary, opacity: canWithdraw ? 1 : 0.5 }]}>
            <Text style={[styles.action, { color: theme.onPrimary }]}>Sacar pelo Asaas</Text>
          </Pressable>
          <Text style={styles.caption}>{data.availableBalance <= 0 ? 'Saque disponível quando houver saldo.'
            : data.approval.bankAccountInfo !== 'APPROVED' ? 'Aguarde a aprovação dos dados bancários para sacar.'
              : 'Entre na sua conta Asaas para escolher o valor e confirmar o saque.'}</Text>
        </View>
      ) : data && (
        <View style={styles.card}>
          <Text style={styles.caption}>{data.registrationPending || data.approval
            ? 'Aguarde a aprovação do cadastro no Asaas para consultar o saldo e sacar.'
            : 'Vincule sua conta Asaas na área do entregador para consultar o saldo e sacar.'}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderColor: '#d9e2ef', borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  caption: { fontSize: 14, color: '#475569' },
  balance: { fontSize: 30, fontWeight: '700' },
  button: { minHeight: 44, borderRadius: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  action: { fontSize: 15, fontWeight: '600' },
  error: { color: '#991b1b', fontSize: 14 },
});
