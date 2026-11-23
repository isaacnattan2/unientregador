const { withProjectBuildGradle } = require('expo/config-plugins');

function withShortExpoCmakePath(config) {
  return withProjectBuildGradle(config, (mod) => {
    const directive = "apply from: '../scripts/android-cmake.gradle'";
    if (!mod.modResults.contents.includes(directive)) {
      mod.modResults.contents += `\n${directive}\n`;
    }
    return mod;
  });
}

const pushEnabled = Boolean(process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID);
const pushMode = process.env.ONESIGNAL_APNS_MODE || 'development';

module.exports = ({ config }) => ({
  ...config,
  ...(pushEnabled && {
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        UIBackgroundModes: [...new Set([...(config.ios?.infoPlist?.UIBackgroundModes ?? []), 'remote-notification'])],
      },
      entitlements: { ...config.ios?.entitlements, 'aps-environment': pushMode },
    },
  }),
  plugins: [
    ...(pushEnabled ? [['onesignal-expo-plugin', { mode: pushMode }]] : []),
    ...(config.plugins ?? []),
    ['expo-location', {
      locationWhenInUsePermission: 'Permita a localização para traçar sua rota e compartilhar sua posição com o cliente durante a entrega.',
    }],
    '@maplibre/maplibre-react-native',
    withShortExpoCmakePath,
  ],
});
