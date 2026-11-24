import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { ApiError, setDriverPresence } from './api';

const task = 'uni-driver-availability-location';
export const sessionKey = 'uniweb.driver.session';
export const sessionStorageOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export class DriverLocationPermissionError extends Error {}

let change = Promise.resolve();
let sending = false;
let lastSentAt = 0;

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(task, async ({ data, error }) => {
  if (error || sending) return;
  const point = data?.locations.reduce<Location.LocationObject | undefined>(
    (latest, location) => !latest || location.timestamp > latest.timestamp ? location : latest, undefined,
  );
  if (!point || point.timestamp < Date.now() - 60000 || Date.now() - lastSentAt < 25000) return;

  sending = true;
  try {
    const token = await SecureStore.getItemAsync(sessionKey);
    if (!token) {
      await stopDriverBackgroundLocation();
      return;
    }
    const { latitude, longitude } = point.coords;
    const presence = await setDriverPresence(token, 'location', { latitude, longitude });
    lastSentAt = Date.now();
    if (!presence.online) await stopDriverBackgroundLocation();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      await stopDriverBackgroundLocation().catch(() => undefined);
    }
  } finally {
    sending = false;
  }
});

function changeTracking(operation: () => Promise<void>) {
  const pending = change.then(operation);
  change = pending.catch(() => undefined);
  return pending;
}

export async function requestDriverBackgroundPermission() {
  if (Platform.OS === 'ios') await Location.requestBackgroundPermissionsAsync();
}

export function startDriverBackgroundLocation() {
  return changeTracking(async () => {
    if (AppState.currentState !== 'active') return;
    if (!(await Location.getForegroundPermissionsAsync()).granted) {
      throw new DriverLocationPermissionError('Para atualizar sua localização durante o check-in, permita o acesso à localização enquanto usa o app.');
    }
    if (Platform.OS === 'ios' && !(await Location.getBackgroundPermissionsAsync()).granted) {
      throw new DriverLocationPermissionError('Para receber ofertas em segundo plano, permita o acesso à localização em “Sempre” nos Ajustes.');
    }
    if (await Location.hasStartedLocationUpdatesAsync(task) || AppState.currentState !== 'active') return;
    await Location.startLocationUpdatesAsync(task, {
      accuracy: Location.Accuracy.High,
      timeInterval: 30000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'UniEntregador disponível',
        notificationBody: 'Sua localização é atualizada enquanto o check-in está ativo.',
        killServiceOnDestroy: true,
      },
    });
  });
}

export function stopDriverBackgroundLocation() {
  return changeTracking(async () => {
    if (await Location.hasStartedLocationUpdatesAsync(task)) await Location.stopLocationUpdatesAsync(task);
  });
}
