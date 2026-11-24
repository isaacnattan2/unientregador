import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { addDriverShift, addDriverWeeklyShift, ApiError, deleteDriverShift, deleteDriverWeeklyShift, getDriverDispatch, setDriverPresence } from './api';
import type { DriverShift, DriverWeeklyShift } from './api';
import { useAppTheme } from './AppTheme';
import { DriverLocationPermissionError, requestDriverBackgroundPermission, startDriverBackgroundLocation, stopDriverBackgroundLocation } from './DriverBackgroundLocation';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const weekdays = [1, 2, 3, 4, 5];
const week = [1, 2, 3, 4, 5, 6, 7];
const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function daysLabel(days: number[]) {
  if (days.length === 7) return 'Todos os dias';
  if (days.join() === weekdays.join()) return 'Segunda a sexta';
  return days.map((day) => dayNames[day - 1]).join(', ');
}

function parseDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day &&
    date.getHours() === hour && date.getMinutes() === minute ? date.toISOString() : null;
}

async function position(requestPermission: boolean, signal?: AbortSignal) {
  const permission = requestPermission ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Permita o acesso à localização para informar sua área de trabalho.');
  if (signal?.aborted) throw new Error('Consulta de localização cancelada.');
  const location = await Location.getLastKnownPositionAsync({ maxAge: 20000, requiredAccuracy: 150 })
    ?? (Platform.OS === 'android' && signal
      ? await waitForAndroidPosition(signal)
      : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  return { latitude: location.coords.latitude, longitude: location.coords.longitude };
}

function waitForAndroidPosition(signal: AbortSignal): Promise<Location.LocationObject> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Consulta de localização cancelada.'));
      return;
    }
    let subscription: Location.LocationSubscription | undefined;
    let finished = false;
    const unavailable = 'O GPS está ligado, mas ainda não recebemos sua posição. Verifique a localização do aparelho e tente novamente.';
    const timer = setTimeout(() => finish(undefined, unavailable), 15000);
    function cancel() { finish(undefined, 'Consulta de localização cancelada.'); }
    function finish(location?: Location.LocationObject, error = unavailable) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      subscription?.remove();
      if (location) resolve(location);
      else reject(new Error(error));
    }
    signal.addEventListener('abort', cancel, { once: true });
    void Location.watchPositionAsync({
      accuracy: Location.Accuracy.High,
      timeInterval: 1000,
      mayShowUserSettingsDialog: false,
    }, (location) => {
      if (location.timestamp >= Date.now() - 20000) finish(location);
    }, () => finish()).then((watcher) => {
      if (finished) watcher.remove();
      else subscription = watcher;
    }).catch(() => finish());
  });
}

async function isGpsEnabled() {
  if (Platform.OS !== 'android') return Location.hasServicesEnabledAsync();
  const status = await Location.getProviderStatusAsync();
  return status.locationServicesEnabled && status.gpsAvailable === true;
}

function waitForGps(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let checking = false;
    function cleanup() {
      clearInterval(timer);
      listener.remove();
      signal.removeEventListener('abort', cancel);
    }
    function cancel() {
      cleanup();
      resolve(false);
    }
    async function check() {
      if (checking || signal.aborted || AppState.currentState !== 'active') return;
      checking = true;
      try {
        if (await isGpsEnabled() && !signal.aborted && AppState.currentState === 'active') {
          cleanup();
          resolve(true);
        }
      } catch (error) {
        cleanup();
        reject(error);
      } finally {
        checking = false;
      }
    }
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void check(); });
    const timer = setInterval(() => void check(), 1500);
    signal.addEventListener('abort', cancel, { once: true });
    void check();
  });
}

export function DriverDispatchControls({ token, onExpired, agenda, setAgenda, offerOverlay, onDismissOffer }: {
  token: string; onExpired: () => void; agenda: boolean; setAgenda: (open: boolean) => void;
  offerOverlay?: React.ReactNode; onDismissOffer?: () => void;
}) {
  const { primary, onPrimary, secondaryInk } = useAppTheme();
  const [online, setOnline] = useState<boolean>();
  const [shifts, setShifts] = useState<DriverShift[]>([]);
  const [weeklyShifts, setWeeklyShifts] = useState<DriverWeeklyShift[]>([]);
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [mode, setMode] = useState<'weekly' | 'single'>('weekly');
  const [days, setDays] = useState<number[]>(weekdays);
  const [weeklyStarts, setWeeklyStarts] = useState('');
  const [weeklyEnds, setWeeklyEnds] = useState('');
  const [busy, setBusy] = useState(false);
  const [waitingForGps, setWaitingForGps] = useState(false);
  const [error, setError] = useState('');
  const [trackingError, setTrackingError] = useState<Error | null>(null);
  const sending = useRef(false);
  const locationAttempt = useRef<AbortController | null>(null);

  useEffect(() => () => {
    locationAttempt.current?.abort();
    locationAttempt.current = null;
  }, [token]);

  function report(err: unknown) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
    else setError(err instanceof Error ? err.message : 'Não foi possível atualizar a disponibilidade.');
  }

  useEffect(() => {
    const controller = new AbortController();
    void getDriverDispatch(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setOnline(data.online); setShifts(data.shifts); setWeeklyShifts(data.weeklyShifts ?? []); }
    }).catch((err) => {
      if (!controller.signal.aborted) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
        else setError('Não foi possível consultar a disponibilidade.');
      }
    });
    return () => controller.abort();
  }, [token, onExpired]);

  useEffect(() => {
    if (online === undefined) return;
    if (!online) {
      setTrackingError(null);
      void stopDriverBackgroundLocation().catch(() => undefined);
      return;
    }
    let active = true;
    let updating = false;
    function startTracking() {
      void startDriverBackgroundLocation().then(() => {
        if (active && AppState.currentState === 'active') setTrackingError(null);
      }).catch((err) => {
        if (active) setTrackingError(err instanceof DriverLocationPermissionError ? err : new Error('Não foi possível atualizar a localização em segundo plano.'));
      });
    }
    async function heartbeat() {
      if (!active || updating || sending.current || AppState.currentState !== 'active') return;
      updating = true;
      try {
        const point = await position(false);
        if (active && !sending.current) {
          const presence = await setDriverPresence(token, 'location', point);
          if (active && !sending.current) setOnline(presence.online);
        }
      } catch (err) {
        if (active && err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      } finally { updating = false; }
    }
    const timer = setInterval(() => void heartbeat(), 30000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startTracking();
        void heartbeat();
      }
    });
    startTracking();
    void heartbeat();
    return () => { active = false; clearInterval(timer); listener.remove(); };
  }, [online, onExpired, token]);

  async function apply(operation: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (err) { report(err); }
    finally { sending.current = false; setBusy(false); }
  }

  async function updateCheckIn() {
    if (online) {
      setOnline((await setDriverPresence(token, 'checkout')).online);
      return;
    }
    await withLocation(async (point, signal) => {
      await requestDriverBackgroundPermission().catch(() => undefined);
      if (signal.aborted) return;
      const presence = await setDriverPresence(token, 'checkin', point, signal);
      if (!signal.aborted) setOnline(presence.online);
    });
  }

  async function withLocation(operation: (point: Awaited<ReturnType<typeof position>>, signal: AbortSignal) => Promise<void>) {
    const attempt = new AbortController();
    const { signal } = attempt;
    locationAttempt.current = attempt;
    try {
      while (!signal.aborted) {
        if (!await isGpsEnabled() || AppState.currentState !== 'active') {
          if (signal.aborted) return;
          setWaitingForGps(true);
          if (!await waitForGps(signal)) return;
          setWaitingForGps(false);
        }
        if (signal.aborted) return;
        let point;
        try {
          point = await position(true, signal);
        } catch (error) {
          if (signal.aborted) return;
          if (!await isGpsEnabled()) continue;
          throw error;
        }
        if (!await isGpsEnabled() || AppState.currentState !== 'active') continue;
        if (signal.aborted) return;
        await operation(point, signal);
        return;
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      if (locationAttempt.current === attempt) {
        locationAttempt.current = null;
        setWaitingForGps(false);
      }
    }
  }

  function button(label: string, run: () => void, filled = false, disabled = busy) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
      style={[styles.button, { backgroundColor: filled ? primary : '#eaf2ff' }]} onPress={run}>
      <Text style={{ color: filled ? onPrimary : secondaryInk, fontWeight: '700' }}>{label}</Text>
    </Pressable>;
  }

  async function saveShift() {
    if (mode === 'weekly') {
      const start = weeklyStarts.trim();
      const end = weeklyEnds.trim();
      if (!days.length || !timePattern.test(start) || !timePattern.test(end)) {
        throw new Error('Selecione pelo menos um dia e preencha os horários no formato HH:mm.');
      }
      await withLocation(async (point, signal) => {
        const shift = await addDriverWeeklyShift(token, days, start, end, point, signal);
        if (signal.aborted) return;
        setWeeklyShifts((current) => [...current, shift].sort((a, b) => a.days[0] - b.days[0] || a.start_time.localeCompare(b.start_time)));
        setWeeklyStarts('');
        setWeeklyEnds('');
      });
      return;
    }
    const start = parseDate(starts);
    const end = parseDate(ends);
    if (!start || !end) throw new Error('Informe início e fim no formato DD/MM/AAAA HH:mm.');
    await withLocation(async (point, signal) => {
      const shift = await addDriverShift(token, start, end, point, signal);
      if (signal.aborted) return;
      setShifts((current) => [...current, shift].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      setStarts('');
      setEnds('');
    });
  }

  const gpsPrompt = waitingForGps && <>
    <Text accessibilityLiveRegion="polite" style={{ color: secondaryInk }}>
      {Platform.OS === 'ios'
        ? 'Ative os Serviços de Localização em Ajustes › Privacidade e Segurança e volte ao app para continuar.'
        : 'Ative a localização do aparelho. A operação continuará automaticamente quando o GPS estiver ligado.'}
    </Text>
    <View style={styles.row}>
      {Platform.OS === 'android' && button('Abrir ajustes de localização', () => {
        void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => {
          setError('Abra os ajustes do aparelho e ative a localização.');
        });
      }, false, false)}
      {button(agenda ? 'Cancelar cadastro' : 'Cancelar check-in', () => locationAttempt.current?.abort(), false, false)}
    </View>
  </>;

  return (
    <View style={styles.controls}>
      <Text style={{ color: secondaryInk }}>{online ? 'Check-in ativo' : online === false ? 'Indisponível para entregas imediatas' : 'Disponibilidade a consultar'}</Text>
      <View style={styles.row}>
        {button(waitingForGps ? 'Aguardando GPS…' : busy ? 'Aguarde…' : online ? 'Fazer check-out' : 'Fazer check-in',
          () => void apply(updateCheckIn), !online)}
        {button('Agenda', () => { setError(''); setAgenda(true); })}
      </View>
      {!agenda && gpsPrompt}
      {!agenda && online && trackingError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>{trackingError.message}</Text>
          {trackingError instanceof DriverLocationPermissionError && button('Abrir configurações', () => {
            void Linking.openSettings().catch(() => setError('Não foi possível abrir as configurações do app.'));
          })}
        </>
      )}
      {!agenda && !!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Modal visible={agenda} animationType="slide" onRequestClose={onDismissOffer ?? (() => { if (!busy) setAgenda(false); })}>
        <SafeAreaView style={styles.screen}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.agenda}>
            <View style={styles.row}>
              <Text accessibilityRole="header" style={[styles.title, { color: secondaryInk }]}>Agenda de entregas</Text>
              {button('Voltar', () => { setError(''); setAgenda(false); })}
            </View>
            <Text>Cadastre os horários em que poderá receber ofertas. A localização atual será usada como ponto de partida do turno.</Text>
            <View style={styles.row}>
              {button('Horário semanal', () => { setMode('weekly'); setError(''); }, mode === 'weekly')}
              {button('Data avulsa', () => { setMode('single'); setError(''); }, mode === 'single')}
            </View>
            {mode === 'weekly' ? <>
              <View style={styles.row}>
                {button('Dias úteis (seg a sex)', () => setDays(weekdays))}
                {button('Todos os dias', () => setDays(week))}
              </View>
              <Text style={{ color: secondaryInk }}>Dias da semana</Text>
              <View style={styles.row}>
                {week.map((day) => {
                  const selected = days.includes(day);
                  return <Pressable key={day} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }}
                    disabled={busy} style={[styles.day, { backgroundColor: selected ? primary : '#eaf2ff' }]}
                    onPress={() => setDays((current) => selected ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b))}>
                    <Text style={{ color: selected ? onPrimary : secondaryInk }}>{dayNames[day - 1]}</Text>
                  </Pressable>;
                })}
              </View>
              <View style={styles.row}>
                <TextInput accessibilityLabel="Início do horário semanal" placeholder="Início · HH:mm"
                  style={[styles.input, styles.timeInput]} value={weeklyStarts} onChangeText={setWeeklyStarts} maxLength={5} editable={!busy} />
                <TextInput accessibilityLabel="Fim do horário semanal" placeholder="Fim · HH:mm"
                  style={[styles.input, styles.timeInput]} value={weeklyEnds} onChangeText={setWeeklyEnds} maxLength={5} editable={!busy} />
              </View>
            </> : <>
              <TextInput accessibilityLabel="Início do turno" placeholder="Início · DD/MM/AAAA HH:mm"
                style={styles.input} value={starts} onChangeText={setStarts} editable={!busy} />
              <TextInput accessibilityLabel="Fim do turno" placeholder="Fim · DD/MM/AAAA HH:mm"
                style={styles.input} value={ends} onChangeText={setEnds} editable={!busy} />
            </>}
            {button(mode === 'weekly' ? 'Adicionar horário semanal' : 'Adicionar data avulsa', () => void apply(saveShift), true)}
            {agenda && gpsPrompt}
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {!shifts.length && !weeklyShifts.length && <Text>Nenhum horário cadastrado.</Text>}
            {weeklyShifts.length > 0 && <Text accessibilityRole="header" style={styles.sectionTitle}>Horários semanais</Text>}
            {weeklyShifts.map((shift) => <View style={styles.shift} key={shift.id}>
              <Text>{daysLabel(shift.days)} · {shift.start_time}–{shift.end_time}{shift.end_time < shift.start_time ? ' do dia seguinte' : ''}</Text>
              {button('Excluir horário semanal', () => void apply(async () => {
                await deleteDriverWeeklyShift(token, shift.id);
                setWeeklyShifts((current) => current.filter((item) => item.id !== shift.id));
              }))}
            </View>)}
            {shifts.length > 0 && <Text accessibilityRole="header" style={styles.sectionTitle}>Datas avulsas</Text>}
            {shifts.map((shift) => <View style={styles.shift} key={shift.id}>
              <Text>{dateTime.format(new Date(shift.starts_at))} até {dateTime.format(new Date(shift.ends_at))}</Text>
              {button('Excluir horário', () => void apply(async () => {
                await deleteDriverShift(token, shift.id);
                setShifts((current) => current.filter((item) => item.id !== shift.id));
              }))}
            </View>)}
          </ScrollView>
          {offerOverlay}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: 18, paddingVertical: 8, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8 },
  error: { color: '#a0262f' },
  screen: { flex: 1, backgroundColor: '#f4f7fb' },
  agenda: { padding: 18, gap: 12, width: '100%', maxWidth: 600, alignSelf: 'center' },
  title: { fontSize: 22, fontWeight: '800', flex: 1 },
  input: { borderColor: '#cbd5e1', borderWidth: 1, borderRadius: 8, minHeight: 44, paddingHorizontal: 12 },
  timeInput: { flex: 1, minWidth: 115 },
  day: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  shift: { padding: 12, gap: 8, backgroundColor: '#fff', borderRadius: 8 },
});
