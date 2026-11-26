const { spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

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
  const localEnv = path.join(projectPath, '.env.local');
  if (!env.SENTRY_AUTH_TOKEN && existsSync(localEnv)) {
    env.SENTRY_AUTH_TOKEN = parseEnv(readFileSync(localEnv, 'utf8')).SENTRY_AUTH_TOKEN;
  }
  if (!env.SENTRY_AUTH_TOKEN?.trim()) {
    env.SENTRY_DISABLE_AUTO_UPLOAD = 'true';
    console.warn('SENTRY_AUTH_TOKEN ausente. O APK sera gerado com o Sentry ativo, sem upload de source maps.');
  }
  if (windows && !env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && env.LOCALAPPDATA) {
    const sdk = path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    if (existsSync(path.join(sdk, 'platforms'))) env.ANDROID_HOME = sdk;
  }

  const android = path.join(projectPath, 'android');
  const wrapper = path.join(android, windows ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(wrapper)) throw new Error('Gere a pasta Android com npx expo prebuild --platform android antes da release.');

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
