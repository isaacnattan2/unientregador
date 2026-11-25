import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import appConfig from './app.json';
import { acceptDelivery, ApiError, cancelDelivery, confirmDelivery, formatOrderCode, getCurrentDriverOffer, getDeliveries, getDriverName, loginDriver, pickupDelivery, respondToDeliveryOffer, setDriverPresence } from './src/api';
import type { Delivery, DriverSession } from './src/api';
import { DeliveryNavigation } from './src/DeliveryNavigation';
import { DriverProfileScreen } from './src/DriverProfileScreen';
import { DriverDispatchControls } from './src/DriverDispatchControls';
import { IncomingDeliveryOffer, OrderCancellationPopup } from './src/IncomingDeliveryOffer';
import { AppThemeProvider, useAppTheme } from './src/AppTheme';
import type { AppPalette } from './src/AppTheme';
import type { StyleProp, ViewStyle } from 'react-native';
import { useDriverPush } from './src/DriverPush';
import type { OrderCancellationNotice, PushDestination } from './src/DriverPush';
import { useAppUpdates } from './src/useAppUpdates';
import type { AppUpdates } from './src/useAppUpdates';

import { sessionKey, sessionStorageOptions, stopDriverBackgroundLocation } from './src/DriverBackgroundLocation';
type DeliverySection = 'available' | 'accepted';
const deliveryKey = (item: Delivery) => item.missedOfferId ?? item.orderId;
const muted = '#4d617a';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const appVersion = appConfig.expo.extra.displayVersion.trim() ||
  Updates.runtimeVersion || appConfig.expo.version;
const activeUpdate = !Updates.isEmbeddedLaunch && Updates.updateId ? Updates.updateId.slice(0, 8) : null;
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function Button({ label, onPress, disabled = false, secondary = false, style }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, style, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={[styles.buttonLabel, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

function Login({ onLogin, notice }: { onLogin: (session: DriverSession) => Promise<void>; notice: string }) {
  const styles = useStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(notice);
  const [loading, setLoading] = useState(false);
  const passwordInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const submitting = useRef(false);
  const canSubmit = !!email.trim() && !!password && !loading;

  async function submit() {
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError('');
    try {
      await onLogin(await loginDriver(email, password));
    } catch (err) {
      setError(messageOf(err, 'Não foi possível entrar.'));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.loginLayout} keyboardShouldPersistTaps="handled">
        <View style={styles.loginCard}>
          <Text style={styles.brand} accessibilityRole="header">UniEntregador</Text>
          <Text style={styles.title} accessibilityRole="header">Entrar</Text>
          <Text style={styles.description}>Use sua conta de entregador do Uniweb.</Text>
          <Text style={styles.label}>E-mail</Text>
          <TextInput style={styles.input} accessibilityLabel="E-mail" editable={!loading} value={email}
            onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
            autoComplete="email" returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
          <Text style={styles.label}>Senha</Text>
          <TextInput ref={passwordInput} style={styles.input} accessibilityLabel="Senha" editable={!loading} value={password}
            onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password"
            returnKeyType="go" onSubmitEditing={() => void submit()} />
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Button label={loading ? 'Entrando…' : 'Entrar'} disabled={!canSubmit} onPress={() => void submit()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const deliveryStatusLabels = {
  available: 'Disponível',
  in_progress: 'Entrega em andamento',
  delivered: 'Entrega realizada',
  cancelled: 'Entrega cancelada pelo entregador',
  cancelled_by_store: 'Pedido cancelado',
};

type DeliveryAction = { kind: 'accept' | 'decline' | 'pickup' } | { kind: 'cancel'; reason?: string } | { kind: 'confirm'; code: string };

function DeliveryCard({ delivery, submitting, disabled, actionError, onSubmit, onNavigate, map }: {
  delivery: Delivery; submitting: DeliveryAction['kind'] | undefined; disabled: boolean;
  actionError: string; onSubmit: (action: DeliveryAction) => void;
  onNavigate: () => void; map?: React.ReactNode;
}) {
  const styles = useStyles();
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [reporting, setReporting] = useState(false);
  const [now, setNow] = useState(Date.now);
  const status = delivery.status === 'missed' ? 'available' : delivery.status ?? 'available';
  const active = delivery.status === 'in_progress';
  const incident = delivery.dispatchState === 'incident';
  const assigned = delivery.dispatchState === 'assigned';
  const scheduledTime = delivery.scheduledAt ? new Date(delivery.scheduledAt) : null;
  const remaining = delivery.offerExpiresAt ? Math.max(0, Math.ceil((Date.parse(delivery.offerExpiresAt) - now) / 1000)) : null;
  const fee = delivery.deliveryFee === null ? null : Number(delivery.deliveryFee);
  const timestamp = delivery.createdAt ? new Date(delivery.createdAt) : null;
  useEffect(() => {
    if (!delivery.offerExpiresAt && !(assigned && scheduledTime)) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [delivery.offerExpiresAt, assigned, delivery.scheduledAt]);
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.cardTitle}>{delivery.pickup.storeName}</Text>
      <View style={styles.orderSummary}>
        <Text style={styles.order}>Pedido #{formatOrderCode(delivery.orderId)}</Text>
        <Text style={[styles.deliveryStatus, styles[status === 'cancelled_by_store' ? 'cancelled' : status]]}>
          {incident && active ? 'Ocorrência em análise' : assigned && active ? 'Aguardando retirada' :
            delivery.offerId && !delivery.status ? 'Oferta de entrega' : deliveryStatusLabels[status]}
        </Text>
      </View>
      <Text style={styles.label}>Retirada</Text>
      <Text style={styles.body}>{delivery.pickup.address || 'Endereço não informado pela loja'}</Text>
      <Text style={styles.label}>Destino</Text>
      <Text style={styles.body}>{delivery.destinationAddress || delivery.destinationArea || 'Endereço não informado'}</Text>
      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.caption}>{delivery.managed ? 'Valor da corrida' : 'Taxa de entrega'}</Text>
          <Text style={styles.fee}>{fee !== null && Number.isFinite(fee) ? currency.format(fee) :
            delivery.rateCents != null ? 'Distância indisponível' : 'A definir'}</Text>
          {delivery.distanceMeters != null && delivery.rateCents != null && (
            <Text style={styles.caption}>
              {(delivery.distanceMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km · {currency.format(delivery.rateCents / 100)}/km
            </Text>
          )}
        </View>
        {timestamp && !Number.isNaN(timestamp.getTime()) && <Text style={styles.caption}>{dateTime.format(timestamp)}</Text>}
      </View>
      {scheduledTime && <Text style={styles.label}>Retirada a partir de {dateTime.format(scheduledTime)}</Text>}
      {active && !incident && assigned && (
        <>
          <Button label={submitting === 'pickup' ? 'Registrando…' : 'Confirmar retirada'} disabled={disabled || (!!scheduledTime && now < scheduledTime.getTime())}
            onPress={() => onSubmit({ kind: 'pickup' })} />
          <Button label="Desistir da entrega" secondary disabled={disabled}
            onPress={() => Alert.alert('Desistir da entrega?', 'A plataforma buscará outro entregador.', [
              { text: 'Voltar', style: 'cancel' }, { text: 'Desistir', style: 'destructive', onPress: () => onSubmit({ kind: 'cancel' }) },
            ])} />
        </>
      )}
      {active && !incident && !assigned && (
        <>
          <Button label="Ver mapa da entrega" secondary disabled={disabled} onPress={onNavigate} />
          {map}
          <Text style={styles.label}>Código de entrega</Text>
          <TextInput style={styles.input} accessibilityLabel="Código de entrega" placeholder="4 dígitos"
            keyboardType="number-pad" maxLength={4} value={code} editable={!disabled}
            onChangeText={(value) => setCode(value.replace(/[^0-9]/g, ''))} />
          <Button label={submitting === 'confirm' ? 'Confirmando…' : 'Confirmar entrega'}
            disabled={disabled || code.length !== 4} onPress={() => onSubmit({ kind: 'confirm', code })} />
          {delivery.managed ? <>
            <Button label={reporting ? 'Voltar à entrega' : 'Relatar problema na entrega'} secondary disabled={disabled}
              onPress={() => setReporting(!reporting)} />
            {reporting && <>
              <TextInput style={styles.input} accessibilityLabel="Motivo da ocorrência" placeholder="Descreva o problema e onde está o pacote"
                maxLength={500} value={reason} onChangeText={setReason} editable={!disabled} />
              <Button label={submitting === 'cancel' ? 'Enviando…' : 'Enviar ocorrência'} disabled={disabled || !reason.trim()}
                onPress={() => onSubmit({ kind: 'cancel', reason })} />
            </>}
          </> : <Button label={submitting === 'cancel' ? 'Cancelando…' : 'Cancelar entrega'} secondary disabled={disabled}
            onPress={() => Alert.alert('Cancelar entrega?', 'O pedido ficará marcado como entrega cancelada pelo entregador.', [
              { text: 'Manter entrega', style: 'cancel' },
              { text: 'Cancelar entrega', style: 'destructive', onPress: () => onSubmit({ kind: 'cancel' }) },
            ])} />}
        </>
      )}
      {!delivery.status && <>
        {remaining !== null && <Text style={styles.caption}>{remaining ? `Responda em até ${remaining} s` : 'Oferta expirada'}</Text>}
        <Button label={submitting === 'accept' ? 'Aceitando…' : 'Aceitar entrega'} disabled={disabled || remaining === 0}
          onPress={() => onSubmit({ kind: 'accept' })} />
        {delivery.offerId && <Button label="Recusar oferta" secondary disabled={disabled || remaining === 0}
          onPress={() => onSubmit({ kind: 'decline' })} />}
      </>}
      {!!actionError && <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
    </View>
  );
}

function Deliveries({ session, onExpired, onLogout, pushDestination, cancellation, onAcknowledgeCancellation, updates, checkinBlockNotice }: {
  session: DriverSession; onExpired: () => void; onLogout: () => Promise<void>;
  pushDestination: PushDestination | null;
  checkinBlockNotice?: string;
  cancellation?: OrderCancellationNotice;
  onAcknowledgeCancellation: (id: string) => void;
  updates: AppUpdates;
}) {
  const styles = useStyles();
  const { primary } = useAppTheme();
  const { token, name } = session;
  const [driverName, setDriverName] = useState(name);
  const [profileOpen, setProfileOpen] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [onlyMissed, setOnlyMissed] = useState(false);
  const onlyMissedRef = useRef(false);
  const [items, setItems] = useState<Delivery[]>([]);
  const [section, setSection] = useState<DeliverySection>(pushDestination?.section ?? 'available');
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [pending, setPending] = useState<'initial' | 'refresh' | 'more' | null>('initial');
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [submission, setSubmission] = useState<{ id: string; kind: DeliveryAction['kind'] } | null>(null);
  const [actionNotice, setActionNotice] = useState('');
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [mapOrderId, setMapOrderId] = useState<string | null>(null);
  const [offerMode, setOfferMode] = useState<'push' | 'polling'>('push');
  const [incoming, setIncoming] = useState<{ offer: Delivery; deadline: number } | null>(null);
  const dismissedOffer = useRef<string | undefined>(undefined);
  const offerRequest = useRef<AbortController | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const closeNavigation = useCallback(() => setMapOrderId(null), []);

  const refreshOffer = useCallback(async (force = false, showNative?: () => void) => {
    if (actionRequest.current) {
      showNative?.();
      return;
    }
    if (offerRequest.current && !force) return;
    offerRequest.current?.abort();
    const controller = new AbortController();
    offerRequest.current = controller;
    const started = Date.now();
    try {
      const { mode, offer, serverNow } = await getCurrentDriverOffer(token, controller.signal);
      if (controller.signal.aborted) return;
      setOfferMode(mode === 'polling' ? 'polling' : 'push');
      if (!offer?.offerId || !offer.offerExpiresAt || offer.offerId === dismissedOffer.current) {
        setIncoming((current) => current && current.deadline > Date.now() ? null : current);
        return;
      }
      const received = Date.now();
      const deadline = received + Date.parse(offer.offerExpiresAt) - Date.parse(serverNow) - (received - started) / 2;
      if (Number.isFinite(deadline) && deadline > received) setIncoming((current) => (
        current && current.offer.offerId === offer.offerId ? { offer, deadline: Math.min(current.deadline, deadline) } : { offer, deadline }
      ));
    } catch (err) {
      if (!controller.signal.aborted) {
        showNative?.();
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      }
    } finally {
      if (offerRequest.current === controller) offerRequest.current = null;
    }
  }, [token, onExpired]);

  function closeOffer(offer: Delivery) {
    dismissedOffer.current = offer.offerId;
    setIncoming(null);
  }

  useEffect(() => {
    if (name) return;
    const controller = new AbortController();
    void getDriverName(token, controller.signal).then((fullName) => {
      if (!controller.signal.aborted) setDriverName(fullName);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [token, name]);

  const load = useCallback(async (target: typeof section, offset: number, mode: 'initial' | 'refresh' | 'more') => {
    if (activeRequest.current && mode === 'more') return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(mode);
    setError('');
    try {
      const page = await getDeliveries(token, target, offset, controller.signal, onlyMissedRef.current);
      if (controller.signal.aborted) return;
      setItems((previous) => mode === 'more' ? [
        ...previous, ...page.items.filter((item) => !previous.some((old) => deliveryKey(old) === deliveryKey(item))),
      ] : page.items);
      setNextOffset(page.nextOffset);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      else setError(messageOf(err, 'Não foi possível carregar as entregas.'));
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (!controller.signal.aborted) setPending(null);
      }
    }
  }, [token, onExpired]);

  useEffect(() => {
    return () => {
      activeRequest.current?.abort();
      actionRequest.current?.abort();
      offerRequest.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    void load('available', 0, 'initial');
  }, [load]);

  useEffect(() => {
    if (!pushDestination) return;
    if (pushDestination?.offerId) {
      void refreshOffer(true, pushDestination.showNative);
      return;
    }
    const target = pushDestination.section;
    onlyMissedRef.current = false;
    setOnlyMissed(false);
    setSection(target);
    setItems([]);
    setNextOffset(null);
    void load(target, 0, 'initial');
  }, [load, pushDestination, refreshOffer]);

  useEffect(() => { void refreshOffer(); }, [refreshOffer]);

  useEffect(() => {
    if (!cancellation) return;
    const { orderId } = cancellation;
    setIncoming((current) => current?.offer.orderId === orderId ? null : current);
    setMapOrderId((current) => current === orderId ? null : current);
    void load(section, 0, 'refresh');
  }, [cancellation, load, section]);

  useEffect(() => {
    function refresh() {
      if (AppState.currentState === 'active' && !activeRequest.current && !actionRequest.current) void load(section, 0, 'refresh');
    }
    const interval = offerMode === 'polling' ? setInterval(() => {
      if (AppState.currentState === 'active') void refreshOffer();
    }, 6000) : undefined;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshOffer(true);
        refresh();
      }
    });
    return () => { if (interval !== undefined) clearInterval(interval); listener.remove(); };
  }, [load, offerMode, refreshOffer, section]);

  useEffect(() => {
    if (checkinBlockNotice && section === 'accepted') void load('accepted', 0, 'refresh');
  }, [checkinBlockNotice, load, section]);

  async function changeSection(target: typeof section) {
    setSection(target);
    setItems([]);
    setNextOffset(null);
    await load(target, 0, 'initial');
  }

  async function submitDelivery(item: Delivery, action: DeliveryAction) {
    if (actionRequest.current || signingOut) return;
    const controller = new AbortController();
    actionRequest.current = controller;
    offerRequest.current?.abort();
    setSubmission({ id: item.orderId, kind: action.kind });
    setActionNotice('');
    setActionError(null);
    try {
      if ((action.kind === 'accept' || action.kind === 'decline') && item.offerId) {
        await respondToDeliveryOffer(token, item.orderId, item.offerId, action.kind === 'accept', controller.signal);
      } else if (action.kind === 'accept') await acceptDelivery(token, item.orderId, controller.signal);
      else if (action.kind === 'cancel') await cancelDelivery(token, item.orderId, controller.signal, action.reason);
      else if (action.kind === 'pickup') await pickupDelivery(token, item.orderId, controller.signal);
      else if (action.kind === 'confirm') await confirmDelivery(token, item.orderId, action.code, controller.signal);
      if (controller.signal.aborted) return;
      if (item.offerId && (action.kind === 'accept' || action.kind === 'decline')) closeOffer(item);
      if (action.kind === 'accept') {
        setActionNotice(`Entrega do pedido #${formatOrderCode(item.orderId)} aceita.`);
        setSection('accepted');
        setItems([{ ...item, status: 'in_progress', dispatchState: item.managed ? 'assigned' : item.dispatchState }]);
        setNextOffset(null);
        if (!item.managed) setMapOrderId(item.orderId);
        await load('accepted', 0, 'refresh');
      } else if (action.kind === 'decline') {
        setItems((current) => current.filter((entry) => entry.orderId !== item.orderId));
        await load(section, 0, 'refresh');
      } else if (action.kind === 'pickup') {
        setActionNotice('Retirada confirmada.');
        await load('accepted', 0, 'refresh');
      } else if (action.kind === 'cancel' && item.managed) {
        setMapOrderId(null);
        setActionNotice(action.reason ? 'Ocorrência enviada ao suporte.' : 'A plataforma vai procurar outro entregador.');
        await load('accepted', 0, 'refresh');
      } else {
        setMapOrderId((previous) => previous === item.orderId ? null : previous);
        const status = action.kind === 'cancel' ? 'cancelled' : 'delivered';
        setItems((previous) => previous.map((delivery) => delivery.orderId === item.orderId
          ? { ...delivery, status } : delivery));
        const orderCode = formatOrderCode(item.orderId);
        setActionNotice(action.kind === 'cancel' ? `Entrega do pedido #${orderCode} cancelada.` :
          `Entrega do pedido #${orderCode} realizada.`);
        await load('accepted', 0, 'refresh');
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onExpired();
      } else {
        setActionError({ id: item.orderId, message: messageOf(err, 'Não foi possível atualizar a entrega.') });
        if (err instanceof ApiError && err.status === 409) await load(section, 0, 'refresh');
      }
    } finally {
      if (actionRequest.current === controller) {
        actionRequest.current = null;
        if (!controller.signal.aborted) setSubmission(null);
      }
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await setDriverPresence(token, 'checkout').catch(() => undefined);
      await onLogout();
    } catch {
      setError('Não foi possível encerrar a sessão. Tente novamente.');
      setSigningOut(false);
    }
  }

  const dismissIncoming = incoming ? () => {
    if (!actionRequest.current && !signingOut) closeOffer(incoming.offer);
  } : undefined;
  const offerPopup = incoming && <IncomingDeliveryOffer key={incoming.offer.offerId} offer={incoming.offer} deadline={incoming.deadline}
    embedded={agendaOpen || profileOpen}
    busy={submission !== null || signingOut} error={actionError?.id === incoming.offer.orderId ? actionError.message : ''}
    onAccept={() => void submitDelivery(incoming.offer, { kind: 'accept' })}
    onDecline={() => void submitDelivery(incoming.offer, { kind: 'decline' })}
    onClose={() => closeOffer(incoming.offer)} />;
  const popup = cancellation ? <OrderCancellationPopup key={cancellation.id} orderId={cancellation.orderId}
    embedded={agendaOpen || profileOpen} onAcknowledge={() => onAcknowledgeCancellation(cancellation.id)} /> : offerPopup;
  const dismissPopup = cancellation ? () => {} : dismissIncoming;

  return (
    <View style={styles.fill}>
      <View style={styles.feedHeader}>
        <View style={styles.feedIdentity}>
          <Text style={[styles.brand, styles.feedBrand]}>UniEntregador</Text>
          {!!driverName && <Text style={styles.feedDriverName} numberOfLines={2}>{driverName}</Text>}
          <Text style={styles.feedVersion}>Versão {appVersion}{activeUpdate ? ` · Atualização ${activeUpdate}` : ''}</Text>
        </View>
        <Button label={signingOut ? 'Saindo…' : 'Sair'} secondary style={styles.feedAction}
          disabled={signingOut || submission !== null} onPress={() => void signOut()} />
      </View>
      <View style={styles.profileActions}>
        <Button label="Meu perfil" secondary style={styles.feedAction} disabled={signingOut || submission !== null}
          onPress={() => setProfileOpen(true)} />
      </View>
      <DriverDispatchControls checkinBlockNotice={checkinBlockNotice} token={token} onExpired={onExpired} agenda={agendaOpen} setAgenda={setAgendaOpen}
        offerOverlay={agendaOpen ? popup : undefined} onDismissOffer={agendaOpen ? dismissPopup : undefined} />
      <View accessibilityRole="tablist" style={styles.deliveryTabs}>
        {(['available', 'accepted'] as const).map((target) => (
          <Pressable key={target} accessibilityRole="tab" accessibilityState={{ selected: section === target, disabled: submission !== null }}
            style={[styles.deliveryTab, section === target && styles.selectedTab]}
            disabled={submission !== null || section === target} onPress={() => {
              setActionError(null);
              setActionNotice('');
              void changeSection(target);
            }}>
            <Text style={[styles.deliveryTabLabel, section === target && styles.selectedTabLabel]}>
              {target === 'available' ? 'Disponíveis' : 'Minhas entregas'}
            </Text>
          </Pressable>
        ))}
      </View>
      <FlatList data={items} keyboardShouldPersistTaps="handled" keyExtractor={deliveryKey} renderItem={({ item }) => item.status === 'missed' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle} accessibilityRole="header">Pedido #{formatOrderCode(item.orderId)}</Text>
          <Text style={styles.description}>{item.pickup.storeName}</Text>
          <Text style={styles.description}>Sem resposta{item.missedAt ? ' em ' + new Date(item.missedAt).toLocaleString('pt-BR') : ''}</Text>
        </View>
      ) : (
        <DeliveryCard delivery={item} submitting={submission?.id === item.orderId ? submission.kind : undefined}
          disabled={submission !== null || signingOut}
          actionError={actionError?.id === item.orderId ? actionError.message : ''}
          onNavigate={() => setMapOrderId(item.orderId)}
          map={mapOrderId === item.orderId && item.status === 'in_progress' ? (
            <DeliveryNavigation delivery={item} token={token} onEnded={closeNavigation} onStop={closeNavigation} />
          ) : undefined}
          onSubmit={(action) => void submitDelivery(item, action)} />
      )}
        contentContainerStyle={styles.feedList}
        ListHeaderComponent={
          <View>
            <Text style={styles.feedTitle} accessibilityRole="header">
              {section === 'available' ? 'Entregas disponíveis' : 'Minhas entregas'}
            </Text>
            {section === 'accepted' && (
              <View style={styles.missedOffersFilter}>
                <Text style={styles.description}>Somente sem resposta</Text>
                <Switch accessibilityLabel="Somente sem resposta" value={onlyMissed}
                  disabled={submission !== null} onValueChange={(value) => {
                    onlyMissedRef.current = value;
                    setOnlyMissed(value);
                    setItems([]);
                    setNextOffset(null);
                    void load('accepted', 0, 'initial');
                  }} />
              </View>
            )}
            {!!actionNotice && <Text accessibilityLiveRegion="polite" style={styles.description}>{actionNotice}</Text>}
            {actionError && !items.some((item) => item.status !== 'missed' && item.orderId === actionError.id) &&
              <Text accessibilityRole="alert" style={styles.error}>{actionError.message}</Text>}
          </View>
        }
        refreshing={pending === 'refresh'} onRefresh={() => { void refreshOffer(true); void load(section, 0, 'refresh'); }}
        ListEmptyComponent={pending ? (
          <View style={styles.empty}><ActivityIndicator color={primary} /><Text style={styles.description}>Buscando entregas…</Text></View>
        ) : !error ? (
          <View style={styles.empty}><Text style={styles.cardTitle}>
            {section === 'available' ? 'Nenhuma entrega disponível' : onlyMissed ? 'Nenhum pedido sem resposta' : 'Nenhuma entrega no histórico'}
          </Text>
            <Text style={styles.description}>Puxe para baixo para atualizar a lista.</Text></View>
        ) : undefined}
        ListFooterComponent={<>
          {error ? (
            <View style={styles.footer}><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
              <Button label="Tentar novamente" secondary onPress={() => void load(section, 0, 'refresh')} /></View>
          ) : nextOffset !== null && (
            <View style={styles.footer}><Button label={pending === 'more' ? 'Carregando…' : 'Ver mais entregas'} secondary
              disabled={pending !== null || submission !== null} onPress={() => void load(section, nextOffset, 'more')} /></View>
          )}
        </>} />
      {profileOpen && <DriverProfileScreen token={token} onExpired={onExpired}
        offerOverlay={popup} onDismissOffer={dismissPopup} updates={updates}
        onClose={() => setProfileOpen(false)}
        onRateSaved={() => { if (section === 'available') void load('available', 0, 'refresh'); }}
        onSaved={(fullName) => {
          setDriverName(fullName);
          setProfileOpen(false);
          setActionNotice('Perfil atualizado.');
        }} />}
      {!agendaOpen && !profileOpen && popup}
    </View>
  );
}

export default function App() {
  return <AppThemeProvider><AppContent /></AppThemeProvider>;
}

function AppContent() {
  const styles = useStyles();
  const { primary } = useAppTheme();
  const [session, setSession] = useState<DriverSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState('');
  const { destination: pushDestination, cancellation, acknowledgeCancellation, updateNotice, checkinBlockNotice } = useDriverPush(session?.token, restoring);
  const updates = useAppUpdates(!restoring && !cancellation, updateNotice);

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(sessionKey).then(async (saved) => {
      if (saved && Platform.OS === 'ios') await SecureStore.setItemAsync(sessionKey, saved, sessionStorageOptions);
      if (active && saved) setSession({ token: saved, name: '' });
    })
      .catch(() => { if (active) setNotice('Não foi possível restaurar a sessão. Entre novamente.'); })
      .finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, []);

  const expire = useCallback(() => {
    setSession(null);
    setNotice('Sua sessão expirou. Entre novamente.');
    void SecureStore.deleteItemAsync(sessionKey).catch(() => undefined);
    void stopDriverBackgroundLocation().catch(() => undefined);
  }, []);

  async function remember(session: DriverSession) {
    try {
      await SecureStore.setItemAsync(sessionKey, session.token, sessionStorageOptions);
    } catch {
      throw new Error('Não foi possível guardar sua sessão no dispositivo. Tente novamente.');
    }
    setNotice('');
    setSession(session);
  }

  async function logout() {
    await SecureStore.deleteItemAsync(sessionKey);
    void stopDriverBackgroundLocation().catch(() => undefined);
    setSession(null);
    setNotice('');
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="dark-content" />
        {restoring ? <View style={styles.center}><ActivityIndicator size="large" color={primary} /><Text style={styles.description}>Restaurando sessão…</Text></View> :
          session ? <Deliveries key={session.token} session={session} onExpired={expire} onLogout={logout} pushDestination={pushDestination}
            checkinBlockNotice={checkinBlockNotice} cancellation={cancellation} onAcknowledgeCancellation={acknowledgeCancellation} updates={updates} /> :
            <Login onLogin={remember} notice={notice} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function useStyles() {
  const theme = useAppTheme();
  return React.useMemo(() => createStyles(theme), [theme]);
}

const createStyles = ({ primary, primaryInk, secondary, secondaryInk, onPrimary, onSecondary }: AppPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f2f6fb' },
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  loginLayout: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  loginCard: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: 24, borderRadius: 18, backgroundColor: '#fff' },
  brand: { fontSize: 16, fontWeight: '700', color: primaryInk, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '800', color: secondaryInk, marginBottom: 6 },
  description: { fontSize: 15, lineHeight: 22, color: muted, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '700', color: secondaryInk, marginTop: 12, marginBottom: 5 },
  input: { backgroundColor: '#f7faff', borderColor: '#c6d5e6', borderWidth: 1, borderRadius: 9, minHeight: 48,
    paddingHorizontal: 12, paddingVertical: 9, color: secondaryInk, fontSize: 16, marginBottom: 4 },
  button: { backgroundColor: primary, minHeight: 46, paddingHorizontal: 14, paddingVertical: 9,
    justifyContent: 'center', alignItems: 'center', borderRadius: 9, marginTop: 12 },
  secondary: { backgroundColor: secondary },
  buttonLabel: { fontSize: 15, fontWeight: '700', color: onPrimary, textAlign: 'center' },
  secondaryLabel: { color: onSecondary },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.55 },
  error: { color: '#a0262f', marginTop: 12, fontSize: 14, lineHeight: 20 },
  feedHeader: { paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#d9e4f0',
    backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 12 },
  feedIdentity: { flex: 1, minWidth: 0, gap: 2 },
  feedBrand: { marginBottom: 0 },
  feedDriverName: { color: muted, fontSize: 14 },
  feedVersion: { color: muted, fontSize: 12 },
  feedAction: { marginTop: 0 },
  profileActions: { alignItems: 'flex-end', width: '100%', maxWidth: 780, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12 },
  deliveryTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, width: '100%', maxWidth: 780, alignSelf: 'center' },
  missedOffersFilter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  deliveryTab: { flex: 1, minHeight: 44, justifyContent: 'center', borderRadius: 8, padding: 8, backgroundColor: '#fff' },
  selectedTab: { backgroundColor: primary },
  deliveryTabLabel: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: secondaryInk },
  selectedTabLabel: { color: onPrimary },
  orderSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
  deliveryStatus: { fontSize: 13, fontWeight: '700', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  available: { color: '#24456d', backgroundColor: '#eaf2ff' },
  in_progress: { color: '#744212', backgroundColor: '#fff0cf' },
  delivered: { color: '#166534', backgroundColor: '#dcfce7' },
  cancelled: { color: '#991b1b', backgroundColor: '#fee2e2' },
  feedTitle: { fontSize: 22, fontWeight: '800', color: secondaryInk, marginBottom: 12 },
  feedList: { width: '100%', maxWidth: 780, alignSelf: 'center', padding: 16, flexGrow: 1 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e3ef', padding: 16, borderRadius: 12, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '800', color: secondaryInk },
  order: { color: muted, fontSize: 13 },
  body: { fontSize: 15, lineHeight: 21, color: muted },
  caption: { fontSize: 12, color: muted },
  fee: { color: '#125527', fontSize: 17, fontWeight: '800', marginTop: 4 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'flex-end',
    borderTopWidth: 1, borderTopColor: '#e1ebf5', paddingTop: 12, marginTop: 12, gap: 8 },
  empty: { alignItems: 'center', paddingTop: 44, gap: 8 },
  footer: { paddingBottom: 10 },
});
