const { build } = require('../eas.json');

function androidReleaseTarget(args, extraFlags = []) {
  let selected;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (extraFlags.includes(arg)) continue;
    let target;
    if (arg === '--preview') target = 'preview';
    else if (arg === '--channel') target = args[++index];
    else if (arg.startsWith('--channel=')) target = arg.slice('--channel='.length);
    else throw new Error('Opção não reconhecida: ' + arg);

    if (!['preview', 'production'].includes(target)) {
      throw new Error('Use --channel preview ou --channel production.');
    }
    if (selected) throw new Error('Informe apenas um canal.');
    selected = target;
  }

  const target = selected ?? 'preview';
  if (build[target]?.channel !== target) {
    throw new Error('Confira o canal do perfil ' + target + ' em eas.json.');
  }
  return { target, channel: build[target].channel };
}

module.exports = { androidReleaseTarget };
