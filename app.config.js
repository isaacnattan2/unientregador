const { AndroidConfig, withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainApplication, withProjectBuildGradle } = require('expo/config-plugins');
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
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

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    const directive = "apply from: rootProject.file('../scripts/android-signing.gradle')";
    if (!mod.modResults.contents.includes(directive)) {
      mod.modResults.contents = mod.modResults.contents.trimEnd() + '\n\n' + directive + '\n';
    }
    return mod;
  });
}

function withDeliveryOfferChannel(config) {
  return withMainApplication(config, (mod) => {
    const channelId = 'uni_delivery_offers_v1';
    if (mod.modResults.contents.includes('"' + channelId + '"')) return mod;
    const onCreate = '    super.onCreate()';
    if (mod.modResults.language !== 'kt' || !mod.modResults.contents.includes(onCreate)) {
      throw new Error('Não foi possível configurar o canal Android de ofertas no MainApplication.');
    }
    mod.modResults.contents = mod.modResults.contents.replace(onCreate, [
      onCreate,
      '    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {',
      '      val channel = android.app.NotificationChannel(',
      '        "' + channelId + '", "Ofertas de entrega", android.app.NotificationManager.IMPORTANCE_HIGH',
      '      )',
      '      val sound = android.net.Uri.parse("android.resource://$packageName/raw/uni_delivery_offer")',
      '      val audio = android.media.AudioAttributes.Builder()',
      '        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build()',
      '      channel.setSound(sound, audio)',
      '      getSystemService(android.app.NotificationManager::class.java).createNotificationChannel(channel)',
      '    }',
    ].join('\n'));
    return mod;
  });
}

function withDeliveryOfferCountdown(config) {
  const extensionPackage = 'br.com.uniweb.unientregador';
  const className = 'DeliveryOfferNotificationExtension';
  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application, 'com.onesignal.NotificationServiceExtension', extensionPackage + '.' + className,
    );
    return mod;
  });
  return withDangerousMod(config, ['android', (mod) => {
    const sourceDirectory = join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...extensionPackage.split('.'));
    mkdirSync(sourceDirectory, { recursive: true });
    const file = className + '.kt';
    copyFileSync(join(__dirname, 'scripts', file), join(sourceDirectory, file));
    return mod;
  }]);
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
    ['onesignal-expo-plugin', { mode: pushMode, sounds: ['./assets/uni_delivery_offer.wav'] }],
    ...(config.plugins ?? []),
    ['expo-location', {
      isAndroidForegroundServiceEnabled: true,
      isIosBackgroundLocationEnabled: true,
      locationAlwaysAndWhenInUsePermission: 'Permita atualizar sua localização enquanto o check-in estiver ativo, mesmo com o app em segundo plano, para receber ofertas próximas.',
      locationWhenInUsePermission: 'Permita a localização para traçar sua rota e compartilhar sua posição com o cliente durante a entrega.',
    }],
    '@maplibre/maplibre-react-native',
    withShortExpoCmakePath,
    withDeliveryOfferChannel,
    withDeliveryOfferCountdown,
    withAndroidReleaseSigning,
  ],
});
