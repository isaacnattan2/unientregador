
const { spawnSync } = require('node:child_process');
const { readFileSync, realpathSync, writeFileSync } = require('node:fs');
const path = require('node:path');

function prepareWindowsAutolinking(project, shortProject, env) {
  env.UNIENTREGADOR_SHORT_ROOT = shortProject;
  env.UNIENTREGADOR_REAL_ROOT = realpathSync.native(project);
  prepareSettings(shortProject);
}

function prepareSettings(projectPath) {
  const settings = path.join(projectPath, 'android', 'settings.gradle');
  const source = readFileSync(settings, 'utf8');
  const marker = 'UNIENTREGADOR_SHORT_ROOT';
  if (source.includes(marker)) return;
  const anchor = "  if (System.getenv('EXPO_USE_COMMUNITY_AUTOLINKING') == '1') {";
  if (!source.includes(anchor)) throw new Error('Não foi possível localizar a configuração de autolinking do Expo.');
  const block = [
    "  if (System.getenv('UNIENTREGADOR_SHORT_ROOT')) {",
    "    def config = new File(rootDir, '.gradle/unientregador-autolinking.json')",
    "    config.parentFile.mkdirs()",
    "    config.text = providers.exec {",
    "      workingDir(rootDir.parentFile)",
    "      commandLine('node', 'scripts/windows-autolinking.cjs')",
    "    }.standardOutput.asText.get()",
    "    new File(rootDir, 'build/generated/autolinking').mkdirs()",
    "    ex.autolinkLibrariesFromConfigFile(config)",
    "  } else if (System.getenv('EXPO_USE_COMMUNITY_AUTOLINKING') == '1') {",
  ].join(source.includes('\r\n') ? '\r\n' : '\n');
  writeFileSync(settings, source.replace(anchor, block));
}

function resolveConfig() {
  const result = spawnSync(process.execPath, [
    '--no-warnings', '--eval', "require('expo/bin/autolinking')",
    'expo-modules-autolinking', 'react-native-config', '--platform', 'android', '--json',
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'O autolinking do Expo falhou.');

  const physicalRoot = path.win32.normalize(process.env.UNIENTREGADOR_REAL_ROOT);
  const shortRoot = process.env.UNIENTREGADOR_SHORT_ROOT;
  const prefix = physicalRoot.toLowerCase() + '\\';
  const config = JSON.parse(result.stdout, (key, value) => {
    if (typeof value !== 'string' || !path.win32.isAbsolute(value)) return value;
    const candidate = path.win32.normalize(value);
    const lower = candidate.toLowerCase();
    const mapped = lower === physicalRoot.toLowerCase() ? shortRoot : lower.startsWith(prefix)
      ? path.win32.join(shortRoot, candidate.slice(prefix.length))
      : value;
    // React Native interpolates these two paths directly into generated CMake code.
    return key === 'cmakeListsPath' || key === 'cxxModuleCMakeListsPath' ? mapped.replace(/\\/g, '/') : mapped;
  });
  process.stdout.write(JSON.stringify(config));
}

module.exports = { prepareWindowsAutolinking };
if (require.main === module) resolveConfig();

