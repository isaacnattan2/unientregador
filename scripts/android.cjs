const { spawn, spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { prepareWindowsAutolinking } = require('./windows-autolinking.cjs');

const project = path.resolve(__dirname, '..');
const cli = path.relative(project, require.resolve('expo/bin/cli'));
const windows = process.platform === 'win32';

function runAndroid(projectPath) {
  const env = { ...process.env };
  if (windows && !env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && env.LOCALAPPDATA) {
    const sdk = path.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    if (existsSync(path.join(sdk, 'platforms'))) env.ANDROID_HOME = sdk;
  }

  let command = 'run:android';
  const args = process.argv.slice(2);
  if (args[0] === '--gradle') {
    command = null;
    args.shift();
  }

  return runExpo(projectPath, env, command, args);
}

async function runExpo(projectPath, env, command, args) {
  const android = path.join(projectPath, 'android');
  if (windows && projectPath !== project && !args.some((arg) => arg === '--help' || arg === '-h')) {
    if (!existsSync(path.join(android, 'settings.gradle'))) {
      const prebuild = await launch(process.execPath, [cli, 'prebuild', '--platform', 'android'], projectPath, env);
      if (prebuild !== 0) return prebuild;
    }
    prepareWindowsAutolinking(project, projectPath, env);
  }
  if (!command) {
    return windows ? launch('cmd.exe', ['/d', '/c', 'gradlew.bat', ...args], android, env)
      : launch(path.join(android, 'gradlew'), [...args], android, env);
  }
  return launch(process.execPath, [cli, command, ...args], projectPath, env);
}

function launch(executable, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit' });
    const interrupt = () => { child.kill('SIGINT'); };
    process.on('SIGINT', interrupt);
    child.once('error', (error) => {
      process.off('SIGINT', interrupt);
      reject(error);
    });
    child.once('close', (status, signal) => {
      process.off('SIGINT', interrupt);
      resolve(status ?? (signal === 'SIGINT' ? 130 : 1));
    });
  });
}

async function main() {
  if (!windows) return runAndroid(project);

  for (const letter of 'ZYXWVUTSRQPONMLKJIHGFED') {
    const drive = letter + ':';
    const mapping = spawnSync('subst.exe', [drive, path.dirname(project)], { encoding: 'utf8' });
    if (mapping.error) throw mapping.error;
    if (mapping.status !== 0) continue;
    try {
      const shortProject = path.join(drive + '\\', path.basename(project));
      console.log('Build Android usando o caminho curto ' + shortProject);
      return await runAndroid(shortProject);
    } finally {
      const removal = spawnSync('subst.exe', [drive, '/D'], { stdio: 'inherit' });
      if (removal.status !== 0) console.warn('Não foi possível remover a unidade temporária ' + drive + '.');
    }
  }
  throw new Error('Não foi possível criar uma unidade temporária para o build Android.');
}

main().then((status) => { process.exitCode = status; }).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

