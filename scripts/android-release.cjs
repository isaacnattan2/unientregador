const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { prepareWindowsAutolinking } = require('./windows-autolinking.cjs');

const project = path.resolve(__dirname, '..');
const expoCli = path.relative(project, require.resolve('expo/bin/cli'));
const args = process.argv.slice(2);
const windows = process.platform === 'win32';

function runRelease(projectPath) {
  const firebaseConfig = path.join(projectPath, 'google-services.json');
  const androidApp = path.join(projectPath, 'android', 'app');
  if (existsSync(firebaseConfig) && existsSync(androidApp)) {
    copyFileSync(firebaseConfig, path.join(androidApp, 'google-services.json'));
  }
  const env = { ...process.env };
  let sentryAuthToken = env.SENTRY_AUTH_TOKEN?.trim();
  for (const filename of ['.env.local', '.env']) {
    if (sentryAuthToken) break;
    const file = path.join(projectPath, filename);
    if (existsSync(file)) sentryAuthToken = parseEnv(readFileSync(file, 'utf8')).SENTRY_AUTH_TOKEN?.trim();
  }
  if (sentryAuthToken) {
    env.SENTRY_AUTH_TOKEN = sentryAuthToken;
  } else {
    env.SENTRY_DISABLE_AUTO_UPLOAD = 'true';
    console.warn('SENTRY_AUTH_TOKEN ausente. Configure-o em unientregador/.env.local para enviar os source maps. A publicação do APK pode continuar.');
  }
  if (windows && !env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && env.LOCALAPPDATA) {
    const sdk = path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    if (existsSync(path.join(sdk, 'platforms'))) env.ANDROID_HOME = sdk;
  }

  const android = path.join(projectPath, 'android');
  const wrapper = path.join(android, windows ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(wrapper)) throw new Error('Gere a pasta Android com npx expo prebuild --platform android antes da release.');

  if (windows && projectPath !== project) prepareWindowsAutolinking(project, projectPath, env);

  const result = args.length
    ? spawnSync(process.execPath, [expoCli, 'run:android', '--variant', 'release', '--no-bundler', ...args],
      { cwd: projectPath, stdio: 'inherit', env })
    : windows
      ? spawnSync('cmd.exe', ['/d', '/c', 'gradlew.bat', 'app:assembleRelease'], { cwd: android, stdio: 'inherit', env })
      : spawnSync(wrapper, ['app:assembleRelease'], { cwd: android, stdio: 'inherit', env });
  if (result.status === 0) {
    console.log('APK: ' + path.join(project, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'));
  }
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  if (!windows) return runRelease(project);

  for (const letter of 'ZYXWVUTSRQPONMLKJIHGFED') {
    const drive = `${letter}:`;
    const mapping = spawnSync('subst.exe', [drive, path.dirname(project)], { encoding: 'utf8' });
    if (mapping.error) throw mapping.error;
    if (mapping.status !== 0) continue;

    try {
      const shortProject = path.join(`${drive}\\`, path.basename(project));
      console.log(`Build Android usando o caminho curto ${shortProject}`);
      return runRelease(shortProject);
    } finally {
      const removal = spawnSync('subst.exe', [drive, '/D'], { stdio: 'inherit' });
      if (removal.status !== 0) console.warn(`Não foi possível remover a unidade temporária ${drive}.`);
    }
  }

  throw new Error('Não foi possível criar uma unidade temporária para o build Android.');
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
