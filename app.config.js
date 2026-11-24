const { withProjectBuildGradle } = require('expo/config-plugins');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

function withShortExpoCmakePath(config) {
  return withProjectBuildGradle(config, (mod) => {
    const directive = "apply from: '../scripts/android-cmake.gradle'";
    // The React Native root plugin can evaluate :app, so register the CMake hooks first.
    const reactPlugin = /^apply plugin: ['"]com\.facebook\.react\.rootproject['"]\s*$/m;
    const contents = mod.modResults.contents.replace(directive, '').trimEnd();
    mod.modResults.contents = contents.replace(reactPlugin, (line) => `${directive}\n${line.trimEnd()}\n`);
    return mod;
  });
}

const pushMode = process.env.ONESIGNAL_APNS_MODE || 'development';

module.exports = ({ config }) => ({
  ...config,
  updates: {
    ...config.updates,
    requestHeaders: {
      ...config.updates?.requestHeaders,
      'expo-channel-name': process.env.UNI_UPDATE_CHANNEL || 'preview',
    },
  },
  android: {
    ...config.android,
    ...(existsSync(join(__dirname, 'google-services.json')) && { googleServicesFile: './google-services.json' }),
  },
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      UIBackgroundModes: [...new Set([...(config.ios?.infoPlist?.UIBackgroundModes ?? []), 'remote-notification'])],
    },
    entitlements: { ...config.ios?.entitlements, 'aps-environment': pushMode },
  },
  plugins: [
    ['onesignal-expo-plugin', { mode: pushMode }],
    ...(config.plugins ?? []),
    ['expo-location', {
      isAndroidForegroundServiceEnabled: true,
      isIosBackgroundLocationEnabled: true,
      locationAlwaysAndWhenInUsePermission: 'Permita atualizar sua localização enquanto o check-in estiver ativo, mesmo com o app em segundo plano, para receber ofertas próximas.',
      locationWhenInUsePermission: 'Permita a localização para traçar sua rota e compartilhar sua posição com o cliente durante a entrega.',
    }],
    '@maplibre/maplibre-react-native',
    withShortExpoCmakePath,
  ],
});
