import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { ApiError, clearDeliveryPosition, formatOrderCode, getDeliveryRoute, publishDeliveryPosition } from './api';
import type { Coordinates, Delivery, DeliveryRoute } from './api';
import { LegacyDeliveryMap } from './LegacyDeliveryMap';
import { distanceToRoute } from './routeDistance';
import { useAppTheme } from './AppTheme';
import type { AppPalette } from './AppTheme';

const mapStyle = process.env.EXPO_PUBLIC_OSM_MAP_STYLE_URL?.trim() || 'https://tiles.openfreemap.org/styles/liberty';
const useLegacyMap = Platform.OS === 'android' && Number(Platform.Version) <= 25;

export function DeliveryNavigation({ delivery, token, onEnded, onStop }: {
  delivery: Delivery; token: string; onEnded: () => void; onStop: () => void;
}) {
  const theme = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [position, setPosition] = useState<Coordinates>();
  const [route, setRoute] = useState<DeliveryRoute>();
  const [message, setMessage] = useState('Aguardando localização…');
  const [routeError, setRouteError] = useState('');
  const [retry, setRetry] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [following, setFollowing] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const camera = useRef<CameraRef>(null);
  const stopSharing = useRef<() => void>(() => undefined);
  const currentRoute = useRef<DeliveryRoute>(undefined);

  useEffect(() => {
    if (!mapReady || !following || !position) return;
    camera.current?.easeTo({ center: [position.longitude, position.latitude], duration: 400 });
  }, [mapReady, following, position]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let watcher: Location.LocationSubscription | undefined;
    let latest: Location.LocationObject | undefined;
    let publishing = false;
    let routing = false;
    let lastPublished = 0;
    let lastRoute = 0;
    let offRouteSamples = 0;
    let currentPublication: Promise<void> | undefined;

    async function publish() {
      const now = Date.now();
      if (!latest || now - latest.timestamp > 30000 || publishing || now - lastPublished < 7500 ||
          signal.aborted || AppState.currentState !== 'active') return;
      const { latitude, longitude } = latest.coords;
      publishing = true;
      lastPublished = now;
      try {
        currentPublication = publishDeliveryPosition(token, delivery.orderId, { latitude, longitude }, signal);
        await currentPublication;
        if (signal.aborted) return;
        setMessage('Localização compartilhada com o cliente.');
        const routeAge = now - lastRoute;
        if (!routing && routeAge >= 32000 && (!currentRoute.current || offRouteSamples >= 2 || routeAge >= 45000)) {
          routing = true;
          lastRoute = now;
          setRecalculating(!!currentRoute.current && offRouteSamples >= 2);
          void getDeliveryRoute(token, delivery.orderId, signal).then((value) => {
            if (!signal.aborted) {
              currentRoute.current = value;
              offRouteSamples = 0;
              setRoute(value);
              setRouteError('');
            }
          }).catch((err) => {
            if (!signal.aborted) setRouteError(err instanceof Error ? err.message : 'Rota indisponível no momento.');
          }).finally(() => {
            routing = false;
            if (!signal.aborted) setRecalculating(false);
          });
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) onEnded();
        else setMessage('Não foi possível compartilhar a localização. Tentando novamente…');
      } finally {
        publishing = false;
        currentPublication = undefined;
      }
    }

    async function start() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (signal.aborted) return;
        if (!permission.granted) {
          setMessage('Permita o acesso à localização para compartilhar a posição e traçar a rota.');
          return;
        }
        watcher = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0,
        }, (value) => {
          if (signal.aborted || (latest && value.timestamp <= latest.timestamp)) return;
          latest = value;
          const { latitude, longitude, accuracy } = value.coords;
          const nextPosition = { latitude, longitude };
          setPosition(nextPosition);
          if (currentRoute.current && accuracy !== null && accuracy <= 60 &&
              distanceToRoute(nextPosition, currentRoute.current.points) > Math.max(65, accuracy * 1.5)) {
            offRouteSamples++;
          } else {
            offRouteSamples = 0;
          }
          void publish();
        }, () => {
          if (!signal.aborted) setMessage('Não foi possível obter a localização. Verifique o GPS.');
        });
        if (signal.aborted) watcher.remove();
      } catch {
        if (!signal.aborted) setMessage('Não foi possível obter a localização. Verifique o GPS.');
      }
    }

    const timer = setInterval(() => {
      void publish();
      if (latest && Date.now() - latest.timestamp > 30000) setMessage('Aguardando uma nova posição do GPS…');
    }, 8000);
    stopSharing.current = () => {
      const pendingPublication = currentPublication;
      controller.abort();
      clearInterval(timer);
      watcher?.remove();
      void Promise.resolve(pendingPublication).catch(() => undefined)
        .then(() => clearDeliveryPosition(token, delivery.orderId)).catch(() => undefined);
      onStop();
    };
    void start();
    return () => {
      controller.abort();
      clearInterval(timer);
      watcher?.remove();
    };
  }, [delivery.orderId, token, onEnded, onStop, retry]);

  const destination = delivery.destinationAddress || delivery.destinationArea;
  const endpoint = route?.points.at(-1);
  async function openDirections() {
    if (!position || !endpoint) return;
    try {
      const waypoints = [position.longitude, position.latitude, endpoint.longitude, endpoint.latitude].join(',');
      await Linking.openURL('https://valhalla.openstreetmap.de/directions?profile=motorcycle&wps=' + encodeURIComponent(waypoints));
    } catch {
      setRouteError('Não foi possível abrir a navegação.');
    }
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>Rota do pedido #{formatOrderCode(delivery.orderId)}</Text>
      <Text style={styles.body}>{destination}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text>
      {position && (useLegacyMap ? <LegacyDeliveryMap position={position} route={route}
        following={following} onPan={() => setFollowing(false)} /> : (
        <Map mapStyle={mapStyle} style={styles.map} onDidFinishLoadingMap={() => setMapReady(true)}
          onRegionWillChange={({ nativeEvent }) => { if (nativeEvent.userInteraction) setFollowing(false); }}>
          <Camera ref={camera} initialViewState={{ center: [position.longitude, position.latitude], zoom: 16 }} />
          {route && (
            <GeoJSONSource data={{ type: 'LineString', coordinates: route.points.map((point) => [point.longitude, point.latitude]) }}>
              <Layer type="line" paint={{ 'line-color': theme.primary, 'line-width': 5 }} />
            </GeoJSONSource>
          )}
          {endpoint && (
            <GeoJSONSource data={{ type: 'Point', coordinates: [endpoint.longitude, endpoint.latitude] }}>
              <Layer type="circle" paint={{ 'circle-radius': 8, 'circle-color': theme.secondary, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }} />
            </GeoJSONSource>
          )}
          <GeoJSONSource data={{ type: 'Point', coordinates: [position.longitude, position.latitude] }}>
            <Layer type="circle" paint={{ 'circle-radius': 8, 'circle-color': theme.primary, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }} />
          </GeoJSONSource>
        </Map>
      ))}
      {recalculating && <Text accessibilityLiveRegion="polite" style={styles.body}>Recalculando rota…</Text>}
      {route && <Text style={styles.body}>
        {(route.distanceMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km · cerca de {Math.ceil(route.durationSeconds / 60)} min
      </Text>}
      {route && <Text style={styles.body}>Rota de moto em versão beta. Respeite a sinalização da via.</Text>}
      {!!routeError && <Text style={styles.body}>{routeError}</Text>}
      <View style={styles.actions}>
        {position && !following && <Pressable accessibilityRole="button" onPress={() => setFollowing(true)} style={styles.button}>
          <Text style={styles.buttonText}>Centralizar no GPS</Text>
        </Pressable>}
        {position && endpoint && <Pressable accessibilityRole="button" onPress={() => void openDirections()} style={styles.button}>
          <Text style={styles.buttonText}>Abrir rota no navegador</Text>
        </Pressable>}
        {!position && <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={styles.button}>
          <Text style={styles.buttonText}>Tentar localizar</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" onPress={() => stopSharing.current()} style={styles.button}>
          <Text style={styles.buttonText}>Parar compartilhamento</Text>
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = ({ secondary, secondaryInk, onSecondary }: AppPalette) => StyleSheet.create({
  panel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e3ef', borderRadius: 12, padding: 16, marginTop: 12, gap: 10 },
  heading: { fontSize: 18, fontWeight: '800', color: secondaryInk },
  body: { fontSize: 14, color: '#4d617a' },
  map: { width: '100%', height: 300, borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, backgroundColor: secondary },
  buttonText: { fontWeight: '700', color: onSecondary },
});
