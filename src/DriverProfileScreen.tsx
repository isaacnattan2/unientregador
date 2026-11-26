import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { TextInputProps } from 'react-native';
import { ApiError, getDriverDeliveryRate, getDriverProfile, saveDriverDeliveryRate, saveDriverProfile, uploadDriverLicensePhoto } from './api';
import type { DriverDeliveryRate, DriverProfile } from './api';
import { useAppTheme } from './AppTheme';
import type { AppPalette } from './AppTheme';
import type { AppUpdates } from './useAppUpdates';
import { DriverLicenseCamera } from './DriverLicenseCamera';

const vehicles = [
  ['bicycle', 'Bicicleta'], ['motorcycle', 'Moto'], ['car', 'Carro'],
  ['utility', 'Utilitário'], ['van', 'Van'], ['truck', 'Caminhão'],
];

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatRate = (cents: number) => currency.format(cents / 100) + '/km';

export function DriverProfileScreen({ token, onClose, onSaved, onRateSaved, onExpired, updates, menuOpen, section }: {
  updates: AppUpdates;
  menuOpen: boolean;
  section: 'profile' | 'rate';
  token: string; onClose: () => void; onSaved: (name: string) => void; onRateSaved: () => void; onExpired: () => void;
}) {
  const isRate = section === 'rate';
  const theme = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [profile, setProfile] = useState<DriverProfile>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [version, retry] = useState(0);
  const [rate, setRate] = useState<DriverDeliveryRate>();
  const [rateInput, setRateInput] = useState('');
  const [rateError, setRateError] = useState('');
  const [rateNotice, setRateNotice] = useState('');
  const [rateVersion, retryRate] = useState(0);
  const [savingRate, setSavingRate] = useState(false);
  const submitting = useRef(false);
  const uploadingLicense = useRef(false);
  const [sendingLicense, setSendingLicense] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  async function sendLicensePhoto(pick: () => Promise<{
    uri: string; fileName?: string | null; mimeType?: string; fileSize?: number;
  } | undefined>) {
    if (uploadingLicense.current) return false;
    uploadingLicense.current = true;
    setSendingLicense(true);
    setLicenseError('');
    try {
      const photo = await pick();
      if (!photo) return false;
      if ((photo.fileSize ?? 0) > 5 * 1024 * 1024) {
        setLicenseError('Selecione uma foto de até 5 MB.');
        return false;
      }
      const { uploadedAt } = await uploadDriverLicensePhoto(token, photo);
      setProfile((current) => current && { ...current, licensePhotoUploadedAt: uploadedAt });
      return true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      else setLicenseError(err instanceof Error ? err.message : 'Não foi possível enviar a foto da CNH.');
      return false;
    } finally {
      uploadingLicense.current = false;
      setSendingLicense(false);
    }
  }

  function selectLicensePhoto() {
    return sendLicensePhoto(async () => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      return result.canceled ? undefined : result.assets[0];
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    if (isRate) return;
    setLoading(true);
    setError('');
    void getDriverProfile(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) setProfile(data);
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      else setError(err instanceof Error ? err.message : 'Não foi possível carregar o perfil.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [token, onExpired, version, isRate]);

  function applyRate(data: DriverDeliveryRate) {
    setRate(data);
    setRateInput(data.effectiveCents == null ? '' : (data.effectiveCents / 100).toFixed(2).replace('.', ','));
  }

  useEffect(() => {
    const controller = new AbortController();
    if (!isRate) return;
    setRateError('');
    void getDriverDeliveryRate(token, controller.signal).then((data) => {
      if (!controller.signal.aborted) applyRate(data);
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      else setRateError('Não foi possível carregar a taxa de entrega.');
    });
    return () => controller.abort();
  }, [token, onExpired, rateVersion, isRate]);

  async function saveRate() {
    if (!rate?.canEdit || !rate.policy || submitting.current) return;
    setRateError('');
    setRateNotice('');
    const input = rateInput.trim();
    const cents = Math.round(Number(input.replace(',', '.')) * 100);
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(input) || cents > 1000000) {
      setRateError('Informe um valor válido em reais por quilômetro.');
      return;
    }
    const { minimumCents, maximumCents } = rate.policy;
    if ((minimumCents !== null && cents < minimumCents) || (maximumCents !== null && cents > maximumCents)) {
      setRateError('A taxa precisa respeitar os limites definidos pela administração.');
      return;
    }
    submitting.current = true;
    setSavingRate(true);
    try {
      const saved = await saveDriverDeliveryRate(token, cents);
      applyRate(saved);
      setRateNotice('Taxa de entrega salva.');
      onRateSaved();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      else {
        if (err instanceof ApiError && err.status === 409) {
          try {
            applyRate(await getDriverDeliveryRate(token));
            onRateSaved();
          } catch {
            setRate(undefined);
          }
        }
        setRateError(err instanceof Error ? err.message : 'Não foi possível salvar a taxa.');
      }
    } finally {
      submitting.current = false;
      setSavingRate(false);
    }
  }

  async function save() {
    if (!profile || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      const updated = await saveDriverProfile(token, profile);
      onSaved(updated.fullName);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onExpired();
      else setError(err instanceof Error ? err.message : 'Não foi possível salvar o perfil.');
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function field(key: keyof DriverProfile, label: string, options?: TextInputProps) {
    return <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...options} style={styles.input} accessibilityLabel={label} editable={!saving}
        value={profile?.[key] ?? ''} onChangeText={(value) => setProfile((current) => current && { ...current, [key]: value })} />
    </View>;
  }

  useEffect(() => {
    if (Platform.OS !== 'android' || menuOpen) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (cameraOpen) {
        if (!uploadingLicense.current) setCameraOpen(false);
      } else if (!submitting.current && !uploadingLicense.current) onClose();
      return true;
    });
    return () => listener.remove();
  }, [cameraOpen, onClose, menuOpen]);
  return (
    <View style={styles.screen}>
      {cameraOpen ? (
        <DriverLicenseCamera
          onClose={() => setCameraOpen(false)}
          onPhoto={async (photo) => {
            await sendLicensePhoto(async () => photo);
            setCameraOpen(false);
          }} />
      ) : <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>{isRate ? 'Taxa de entrega' : 'Meu perfil'}</Text>
          {!isRate && <>
            <View style={styles.group}>
              <Text accessibilityRole="header" style={styles.subtitle}>Atualizações do app</Text>
              {updates.available && !updates.phase && <Text accessibilityLiveRegion="polite">Há uma atualização disponível.</Text>}
              <Pressable accessibilityRole="button" disabled={updates.phase !== null}
                accessibilityState={{ disabled: updates.phase !== null, busy: updates.phase !== null }}
                onPress={() => void updates.check(true)} style={styles.option}>
                <Text style={styles.label}>{updates.phase === 'updating' ? 'Atualizando…' : updates.phase === 'checking'
                  ? 'Verificando…' : updates.available ? 'Atualizar app' : 'Verificar atualizações'}</Text>
              </Pressable>
            </View>
            {loading && <ActivityIndicator color={theme.primary} />}
            {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {!loading && !profile && <Pressable accessibilityRole="button" style={styles.option}
              onPress={() => retry((value) => value + 1)}><Text style={styles.label}>Tentar novamente</Text></Pressable>}
            {profile && <>
              <View style={styles.group}>
                <Text accessibilityRole="header" style={styles.subtitle}>Dados pessoais</Text>
                {field('fullName', 'Nome completo', { autoComplete: 'name', maxLength: 255 })}
                {field('email', 'E-mail', { autoComplete: 'email', keyboardType: 'email-address', autoCapitalize: 'none', maxLength: 255 })}
                {field('phone', 'Telefone com DDD', { autoComplete: 'tel', keyboardType: 'phone-pad', maxLength: 20 })}
              </View>
              <View style={styles.group}>
                <Text accessibilityRole="header" style={styles.subtitle}>Foto da CNH</Text>
                {profile.licensePhotoUploadedAt && <Text style={styles.label}>Foto enviada em {new Date(profile.licensePhotoUploadedAt).toLocaleDateString('pt-BR')}</Text>}
                {!!licenseError && <Text accessibilityRole="alert" style={styles.error}>{licenseError}</Text>}
                {Platform.OS !== 'web' && <Pressable accessibilityRole="button" disabled={sendingLicense || saving}
                  onPress={() => { setLicenseError(''); setCameraOpen(true); }} style={styles.option}>
                  <Text style={styles.label}>Fotografar CNH</Text>
                </Pressable>}
                <Pressable accessibilityRole="button" disabled={sendingLicense || saving}
                  onPress={() => void selectLicensePhoto()} style={styles.option}>
                  <Text style={styles.label}>{sendingLicense ? 'Enviando…' : profile.licensePhotoUploadedAt ? 'Substituir pela galeria' : 'Escolher da galeria'}</Text>
                </Pressable>
              </View>
              <View style={styles.group}>
                <Text accessibilityRole="header" style={styles.subtitle}>Veículo</Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Tipo de veículo" style={styles.options}>
                  {vehicles.map(([value, label]) => {
                    const selected = profile.vehicleType === value;
                    return <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: saving }}
                      disabled={saving} style={[styles.option, selected && styles.selected]}
                      onPress={() => setProfile({ ...profile, vehicleType: value })}>
                      <Text style={selected ? styles.white : styles.label}>{label}</Text>
                    </Pressable>;
                  })}
                </View>
                {field('manufacturer', 'Fabricante', { maxLength: 100 })}
                {field('brand', 'Marca', { maxLength: 100 })}
                {field('color', 'Cor', { maxLength: 50 })}
                {field('plate', profile.vehicleType === 'bicycle' ? 'Placa (opcional)' : 'Placa', { autoCapitalize: 'characters', maxLength: 10 })}
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }}
                disabled={saving || savingRate || sendingLicense} onPress={() => void save()} style={[styles.option, styles.selected]}>
                <Text style={styles.white}>{saving ? 'Salvando…' : 'Salvar alterações'}</Text>
              </Pressable>
            </>}
          </>}
          {isRate && <View style={styles.group}>
            {!!rateError && <Text accessibilityRole="alert" style={styles.error}>{rateError}</Text>}
            {!!rateNotice && <Text accessibilityLiveRegion="polite" style={styles.label}>{rateNotice}</Text>}
            {!rate && (rateError ? (
              <Pressable accessibilityRole="button" onPress={() => retryRate((value) => value + 1)} style={styles.option}>
                <Text style={styles.label}>Tentar novamente</Text>
              </Pressable>
            ) : <ActivityIndicator color={theme.primary} />)}
            {rate && !rate.policy && <Text>A administração ainda não configurou a taxa por km.</Text>}
            {rate?.policy && (
              <>
                {rate.effectiveCents != null && <Text style={styles.label}>Taxa aplicada {formatRate(rate.effectiveCents)}</Text>}
                {rate.canEdit ? (
                  <>
                    {rate.policy.minimumCents !== null && <Text>Taxa mínima {formatRate(rate.policy.minimumCents)}</Text>}
                    {rate.policy.maximumCents !== null && <Text>Taxa máxima {formatRate(rate.policy.maximumCents)}</Text>}
                    <Text style={styles.label}>Sua taxa (R$/km)</Text>
                    <TextInput style={styles.input} accessibilityLabel="Sua taxa em reais por quilômetro"
                      keyboardType="decimal-pad" maxLength={8} editable={!saving && !savingRate}
                      value={rateInput} onChangeText={setRateInput} />
                    <Pressable accessibilityRole="button" disabled={saving || savingRate} onPress={() => void saveRate()}
                      style={[styles.option, styles.selected]}>
                      <Text style={styles.white}>{savingRate ? 'Salvando…' : 'Salvar taxa'}</Text>
                    </Pressable>
                  </>
                ) : <Text>A administração definiu a taxa padrão para suas entregas.</Text>}
              </>
            )}
          </View>}
        </ScrollView>
      </KeyboardAvoidingView>}
    </View>
  );
}

const createStyles = ({ primary, secondaryInk, onPrimary }: AppPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7fb' },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 16, gap: 14 },
  title: { fontSize: 24, fontWeight: '800', color: secondaryInk },
  subtitle: { fontSize: 18, fontWeight: '800', color: secondaryInk },
  group: { backgroundColor: '#fff', padding: 16, borderWidth: 1, borderColor: '#d7e3ef', borderRadius: 12, gap: 12 },
  field: { gap: 5 },
  label: { color: secondaryInk, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, minHeight: 44, paddingHorizontal: 12, color: secondaryInk },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#eaf2ff', borderRadius: 8 },
  selected: { backgroundColor: primary },
  white: { color: onPrimary, fontWeight: '700' },
  error: { color: '#a0262f' },
});
