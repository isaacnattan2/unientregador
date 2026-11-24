const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { expo } = require('../app.json');
const { build } = require('../eas.json');

const root = path.resolve(__dirname, '..');
const channel = build.preview.channel;

function readEnv(file) {
  try {
    return parseEnv(readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function notify() {
  const backend = readEnv(path.resolve(root, '../uniweb/backend/.env'));
  const local = readEnv(path.join(root, '.env'));
  const appId = (process.env.ONESIGNAL_DRIVER_APP_ID ?? backend.ONESIGNAL_DRIVER_APP_ID)?.trim();
  const apiKey = (process.env.ONESIGNAL_DRIVER_API_KEY ?? backend.ONESIGNAL_DRIVER_API_KEY)?.trim();
  const expectedAppId = (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? local.EXPO_PUBLIC_ONESIGNAL_APP_ID)?.trim()
    || expo.extra.oneSignalAppId;

  if (!appId || !apiKey) throw new Error('Configure ONESIGNAL_DRIVER_APP_ID e ONESIGNAL_DRIVER_API_KEY.');
  if (appId !== expectedAppId) throw new Error('O App ID do OneSignal difere do configurado no UniEntregador.');
  if (expo.runtimeVersion?.policy !== 'appVersion') throw new Error('O script requer a política appVersion.');

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
  if (!result.id) throw new Error('O OneSignal não retornou um ID de envio. Confira se há dispositivos inscritos e registrados neste canal e runtime.');
  console.log('OneSignal aceitou o envio do aviso: ' + result.id);
}

async function main() {
  const env = { ...process.env, UNI_UPDATE_CHANNEL: channel };
  if (!env.npm_execpath) throw new Error('Execute pelo npm run newversion:android.');
  delete env.ONESIGNAL_DRIVER_API_KEY;
  const publish = spawnSync(process.execPath, [
    process.env.npm_execpath, 'exec', '--yes', '--package=eas-cli@latest', '--', 'eas', 'update',
    '--platform', 'android', '--channel', channel, '--environment', 'preview',
    '--input-dir', '.expo/eas-preview', '--message', 'Nova versao Android do UniEntregador', '--non-interactive',
  ], { cwd: root, stdio: 'inherit', env });

  if (publish.status !== 0) {
    console.error('O EAS não concluiu a publicação. Nenhum aviso foi enviado.');
    process.exitCode = publish.status ?? 1;
    return;
  }

  if (process.argv.includes('--skip-push')) return;

  try {
    await notify();
  } catch (error) {
    console.error('OTA publicado no EAS, mas o envio do aviso falhou: ' + error.message);
    process.exitCode = 1;
  }
}

void main();
