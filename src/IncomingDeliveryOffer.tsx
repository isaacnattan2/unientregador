import React, { useEffect, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Delivery } from './api';
import { useAppTheme } from './AppTheme';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const time = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function IncomingDeliveryOffer({ offer, deadline, busy, error, onAccept, onDecline, onClose, embedded = false }: {
  offer: Delivery; deadline: number; busy: boolean; error: string;
  embedded?: boolean;
  onAccept: () => void; onDecline: () => void; onClose: () => void;
}) {
  const theme = useAppTheme();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    Keyboard.dismiss();
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const expired = remaining === 0;
  const disabled = busy || expired;
  const countdown = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const trackWidth = `${Math.min(100, remaining * 100 / (offer.scheduledAt ? 300 : 60))}%` as const;
  const amount = offer.deliveryFee === null ? null : Number(offer.deliveryFee);

  const content = (
      <View style={[styles.overlay, embedded && styles.embedded]}>
        <ScrollView contentContainerStyle={styles.layout} keyboardShouldPersistTaps="handled">
          <View accessibilityViewIsModal style={styles.card}>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.secondaryInk }]}>Nova corrida</Text>
              <Text accessibilityLabel={`${remaining} segundos restantes`} style={[styles.timer, { color: expired ? '#9f1239' : theme.primaryInk }]}>
                {countdown}
              </Text>
            </View>
            <View style={styles.track}><View style={[styles.progress, { width: trackWidth, backgroundColor: theme.primary }]} /></View>
            <View style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.caption}>Valor da corrida</Text>
                <Text style={styles.amount}>{amount === null ? 'A definir' : currency.format(amount)}</Text>
              </View>
              {offer.distanceMeters != null && <View style={styles.summaryItem}>
                <Text style={styles.caption}>Distância</Text>
                <Text style={styles.distance}>{(offer.distanceMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km</Text>
              </View>}
            </View>
            <View style={styles.route}>
              <Text style={styles.caption}>Retirada</Text>
              <Text style={[styles.store, { color: theme.secondaryInk }]}>{offer.pickup.storeName}</Text>
              {!!offer.pickup.address && <Text style={styles.address}>{offer.pickup.address}</Text>}
              <Text style={styles.caption}>Destino</Text>
              <Text style={styles.address}>{offer.destinationAddress ?? offer.destinationArea ?? 'Endereço não informado'}</Text>
              {offer.scheduledAt && <Text style={styles.address}>Retirada a partir de {time.format(new Date(offer.scheduledAt))}</Text>}
            </View>
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {expired && <Text accessibilityLiveRegion="polite" style={styles.error}>Oferta expirada.</Text>}
            <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy }} disabled={disabled} onPress={onAccept}
              style={({ pressed }) => [styles.accept, { backgroundColor: theme.primary }, (pressed || disabled) && styles.dimmed]}>
              <Text style={[styles.acceptLabel, { color: theme.onPrimary }]}>{busy ? 'Respondendo…' : 'Aceitar corrida'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={expired ? onClose : onDecline} style={styles.secondary}>
              <Text style={{ color: theme.secondaryInk, fontWeight: '700' }}>{expired ? 'Fechar' : 'Recusar oferta'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
  );
  return embedded ? content : (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!busy) onClose(); }}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#101828b8' },
  embedded: { ...StyleSheet.absoluteFill, zIndex: 10 },
  layout: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 40 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 22, width: '100%', maxWidth: 470, alignSelf: 'center', gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 26, fontWeight: '800' },
  timer: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 5, borderRadius: 3, backgroundColor: '#e2e8f0', overflow: 'hidden' },
  progress: { height: '100%', borderRadius: 3 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, backgroundColor: '#f1f5f9', borderRadius: 14, padding: 14 },
  summaryItem: { flexGrow: 1, gap: 3 },
  caption: { color: '#475467', fontSize: 14, fontWeight: '600' },
  amount: { color: '#13704c', fontSize: 24, fontWeight: '800' },
  distance: { color: '#182230', fontSize: 22, fontWeight: '700' },
  route: { gap: 5 },
  store: { fontSize: 17, fontWeight: '800' },
  address: { color: '#344054', fontSize: 15, marginBottom: 4 },
  accept: { minHeight: 56, justifyContent: 'center', alignItems: 'center', borderRadius: 14, padding: 12 },
  acceptLabel: { fontSize: 18, fontWeight: '800' },
  secondary: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#9f1239' },
  dimmed: { opacity: 0.55 },
});
