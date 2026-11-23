const { spawnSync } = require('node:child_process');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const expoCli = path.relative(project, require.resolve('expo/bin/cli'));
const args = ['run:android', '--variant', 'release', '--device', '--no-bundler', ...process.argv.slice(2)];

function runRelease(projectPath) {
  const result = spawnSync(process.execPath, [expoCli, ...args], {
    cwd: projectPath,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  if (process.platform !== 'win32') return runRelease(project);

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
