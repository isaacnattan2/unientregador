import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, getDriverProfile, saveDriverProfile } from './api';
import type { DriverProfile } from './api';
import { useAppTheme } from './AppTheme';
import type { AppPalette } from './AppTheme';

const vehicles = [
  ['bicycle', 'Bicicleta'], ['motorcycle', 'Moto'], ['car', 'Carro'],
  ['utility', 'Utilitário'], ['van', 'Van'], ['truck', 'Caminhão'],
];

export function DriverProfileScreen({ token, onClose, onSaved, onExpired }: {
  token: string; onClose: () => void; onSaved: (name: string) => void; onExpired: () => void;
}) {
  const theme = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [profile, setProfile] = useState<DriverProfile>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [version, retry] = useState(0);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
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
  }, [token, onExpired, version]);

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

  const close = () => { if (!submitting.current) onClose(); };
  return (
    <Modal animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>Meu perfil</Text>
              <Pressable accessibilityRole="button" disabled={saving} onPress={close} style={styles.option}>
                <Text style={styles.label}>Voltar</Text>
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
                disabled={saving} onPress={() => void save()} style={[styles.option, styles.selected]}>
                <Text style={styles.white}>{saving ? 'Salvando…' : 'Salvar alterações'}</Text>
              </Pressable>
            </>}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = ({ primary, secondaryInk, onPrimary }: AppPalette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7fb' },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 16, gap: 14 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
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
