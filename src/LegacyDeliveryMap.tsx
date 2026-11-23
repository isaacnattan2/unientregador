import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { Coordinates, DeliveryRoute } from './api';
import { useAppTheme } from './AppTheme';

const source = { html: `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
 integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<style>html,body,#map{height:100%;margin:0}</style>
</head><body><div id="map" aria-label="Mapa da entrega"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
 integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
if (!window.L) {
  window.ReactNativeWebView.postMessage('error');
} else {
  var map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors'
  }).addTo(map);
  var driver = L.circleMarker([0, 0], { color: '#1762d1', fillOpacity: 1 }).addTo(map);
  var line = L.polyline([], { color: '#1762d1', weight: 5 }).addTo(map);
  var destination = L.circleMarker([0, 0], { color: '#152844', fillOpacity: 1 });
  var centered = false;
  map.on('dragstart', function () { window.ReactNativeWebView.postMessage('pan'); });
  window.setDeliveryMapColors = function (primary, secondary) {
    driver.setStyle({ color: primary, fillColor: primary });
    line.setStyle({ color: primary });
    destination.setStyle({ color: secondary, fillColor: secondary });
  };
  window.updateDeliveryMap = function (position, points, following) {
    driver.setLatLng(position);
    if (!centered) { map.setView(position, 16); centered = true; }
    else if (following && !map.getCenter().equals(position)) { map.panTo(position, { animate: true, duration: 0.4 }); }
    line.setLatLngs(points);
    if (points.length) {
      destination.setLatLng(points[points.length - 1]).addTo(map);
    } else {
      destination.remove();
    }
  };
  window.ReactNativeWebView.postMessage('ready');
}
</script></body></html>` };

export function LegacyDeliveryMap({ position, route, following, onPan }: {
  position: Coordinates; route?: DeliveryRoute; following: boolean; onPan: () => void;
}) {
  const webView = useRef<WebView<object>>(null);
  const { primary, secondary } = useAppTheme();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready) return;
    webView.current?.injectJavaScript(`window.setDeliveryMapColors(${JSON.stringify(primary)}, ${JSON.stringify(secondary)}); true;`);
  }, [ready, primary, secondary]);

  useEffect(() => {
    if (!ready) return;
    const current = [position.latitude, position.longitude];
    const points = route?.points.map(({ latitude, longitude }) => [latitude, longitude]) ?? [];
    webView.current?.injectJavaScript(`window.updateDeliveryMap(${JSON.stringify(current)}, ${JSON.stringify(points)}, ${following}); true;`);
  }, [position, route, ready, following]);

  if (failed) return <Text role="status">Não foi possível carregar o mapa da entrega.</Text>;
  return (
    <View style={styles.container}>
      <WebView<object> ref={webView} source={source} originWhitelist={['*']}
        applicationNameForUserAgent="UniEntregador/1.0" androidLayerType="software"
        onShouldStartLoadWithRequest={({ url }) => url === 'about:blank'}
        onError={() => setFailed(true)}
        onMessage={({ nativeEvent }) => {
          if (nativeEvent.data === 'ready') setReady(true);
          if (nativeEvent.data === 'error') setFailed(true);
          if (nativeEvent.data === 'pan') onPan();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 300, borderRadius: 8, overflow: 'hidden' },
});
