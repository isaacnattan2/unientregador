const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { expo } = require('../app.json');
const { androidReleaseTarget } = require('./android-release-target.cjs');

const root = path.resolve(__dirname, '..');
const backend = path.resolve(root, '../uniweb/backend');

function readEnv(file) {
  try {
    return parseEnv(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function notify(channel) {
  const backendEnv = readEnv(path.join(backend, '.env'));
  const local = { ...readEnv(path.join(root, '.env')), ...readEnv(path.join(root, '.env.local')) };
  const appId = (process.env.ONESIGNAL_DRIVER_APP_ID ?? backendEnv.ONESIGNAL_DRIVER_APP_ID)?.trim();
  const apiKey = (process.env.ONESIGNAL_DRIVER_API_KEY ?? backendEnv.ONESIGNAL_DRIVER_API_KEY)?.trim();
  const expectedAppId = (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? local.EXPO_PUBLIC_ONESIGNAL_APP_ID)?.trim()
    || expo.extra.oneSignalAppId;

  if (!appId || !apiKey) throw new Error('Configure ONESIGNAL_DRIVER_APP_ID e ONESIGNAL_DRIVER_API_KEY.');
  if (appId !== expectedAppId) throw new Error('O App ID do OneSignal difere do configurado no UniEntregador.');

  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: { Authorization: 'Key ' + apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      app_id: appId,
      target_channel: 'push',
      isAndroid: true,
      isIos: false,
      isAnyWeb: false,
      isHuawei: false,
      isAdm: false,
      filters: [{ field: 'tag', key: 'uni_android_update_target', relation: '=', value: channel + ':' + expo.version }],
      headings: { en: 'Nova atualização do UniEntregador', pt: 'Nova atualização do UniEntregador' },
      contents: { en: 'Abra o app para atualizar.', pt: 'Abra o app para atualizar.' },
      data: { event: 'android_app_update', channel, runtimeVersion: expo.version },
    }),
  });

  if (!response.ok) throw new Error('O OneSignal respondeu com HTTP ' + response.status + '.');
  const result = await response.json();
  if (!result?.id) {
    throw new Error(`O OneSignal não confirmou destinatários para ${channel}:${expo.version}. Abra o APK compatível e confira se as notificações estão ativadas.`);
  }
  console.log('OneSignal aceitou o envio do aviso: ' + result.id);
}

async function recordUpdate(channel) {
  const connectionString = process.env.DATABASE_URL || readEnv(path.join(backend, '.env')).DATABASE_URL;
  if (!connectionString) throw new Error('Configure DATABASE_URL para registrar o aviso da OTA.');
  const { Client } = require(require.resolve('pg', { paths: [backend] }));
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query(
      `INSERT INTO driver_notifications (id, kind, title, body, data)
       VALUES ($1, 'android_app_update', $2, $3, $4)`,
      ['ota:' + randomUUID(), 'Nova atualização do UniEntregador', 'Abra o app para instalar a atualização.',
        JSON.stringify({ channel, runtimeVersion: expo.version })],
    );
  } finally {
    await client.end();
  }
}

function uploadSourceMaps(env, bundleDirectory) {
  const token = env.SENTRY_AUTH_TOKEN?.trim() ||
    readEnv(path.join(root, '.env.local')).SENTRY_AUTH_TOKEN?.trim() ||
    readEnv(path.join(root, '.env')).SENTRY_AUTH_TOKEN?.trim();
  if (!token) {
    console.warn('Source maps do Sentry ignorados. Configure SENTRY_AUTH_TOKEN em .env.local.');
    return;
  }

  const sdk = require.resolve('@sentry/react-native/package.json');
  const uploader = require.resolve('@sentry/expo-upload-sourcemaps/cli.js', { paths: [path.dirname(sdk)] });
  const { SentryCli } = require(require.resolve('@sentry/cli', { paths: [path.dirname(uploader)] }));
  const [, config] = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === '@sentry/react-native/expo');
  const upload = spawnSync(process.execPath, [uploader, bundleDirectory], {
    cwd: root, stdio: 'inherit', env: {
      ...env, SENTRY_AUTH_TOKEN: token, SENTRY_ORG: config.organization, SENTRY_PROJECT: config.project,
      SENTRY_URL: config.url, SENTRY_CLI_EXECUTABLE: env.SENTRY_CLI_EXECUTABLE || SentryCli.getPath(),
    },
  });
  if (upload.error) throw upload.error;
  if (upload.status !== 0) throw new Error('O uploader terminou com código ' + (upload.status ?? upload.signal) + '.');
}

async function main() {
  const args = process.argv.slice(2);
  const { target, channel } = androidReleaseTarget(args, ['--skip-push']);
  const bundleDirectory = '.expo/eas-' + target;
  if (expo.runtimeVersion?.policy !== 'appVersion') throw new Error('O script requer a política appVersion.');
  const env = { ...process.env, UNI_UPDATE_CHANNEL: channel };
  if (target === 'production') {
    const backendEnv = readEnv(path.join(backend, '.env'));
    env.EXPO_PUBLIC_API_URL = process.env.DRIVER_APP_RELEASE_API_URL || backendEnv.DRIVER_APP_RELEASE_API_URL ||
      'https://uniweb-p7mz.onrender.com/api';
  }
  if (!env.npm_execpath) throw new Error('Execute pelo npm run newversion:android.');
  delete env.ONESIGNAL_DRIVER_API_KEY;
  console.log(`Publicando OTA Android no canal ${channel}, runtime ${expo.version}.`);
  const publish = spawnSync(process.execPath, [
    process.env.npm_execpath, 'exec', '--yes', '--package=eas-cli@latest', '--', 'eas', 'update',
    '--platform', 'android', '--channel', channel, '--environment', target,
    '--input-dir', bundleDirectory, '--message', 'Nova versao Android do UniEntregador', '--non-interactive',
  ], { cwd: root, stdio: 'inherit', env });

  if (publish.status !== 0) {
    console.error('O EAS não concluiu a publicação. Nenhum aviso foi enviado.');
    process.exitCode = publish.status ?? 1;
    return;
  }

  try {
    await recordUpdate(channel);
  } catch (error) {
    console.warn('Publicação concluída, mas o aviso da OTA não entrou no histórico: ' + error.message);
  }

  try {
    uploadSourceMaps(env, bundleDirectory);
  } catch (error) {
    console.warn('A OTA foi publicada, mas o envio dos source maps ao Sentry falhou: ' + error.message);
  }

  if (args.includes('--skip-push')) return;

  try {
    await notify(channel);
  } catch (error) {
    console.error('OTA publicado no EAS, mas o envio do aviso falhou: ' + error.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
