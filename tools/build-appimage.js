'use strict';

// Genera el AppImage de Linux.
// - En Linux: usa electron-builder directamente.
// - En Windows/macOS: usa Docker si está instalado (el AppImage necesita
//   enlaces simbólicos y herramientas de Linux).
// Uso: npm run dist:appimage [-- --docker] [--help]

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const dockerImage = 'electronuserland/builder:latest';
const { version } = require(path.join(projectDir, 'package.json'));
const artifact = `dist/CUE-Player-Pad-${version}-x86_64.AppImage`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    console.error(`No se pudo ejecutar «${command}»: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function dockerReady() {
  const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function printHelp() {
  console.log(`Generar el AppImage de CUE PLAYER PAD

  npm run dist:appimage            Genera el AppImage (Linux nativo).
  npm run dist:appimage -- --docker  Fuerza la compilación con Docker.

En Linux hace falta Node.js 20+ y las dependencias instaladas (npm ci).
En Windows y macOS se usa Docker Desktop porque Windows no puede crear los
enlaces simbólicos que necesita el AppImage.

Alternativas sin Docker:
  - Compilar en un equipo Linux con «npm ci && npm run dist:appimage».
  - Usar GitHub Actions: pestaña Actions → Build distributables → Run workflow.

El resultado queda en ${artifact}.`);
}

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

const useDocker = args.has('--docker');

if (process.platform === 'linux' && !useDocker) {
  console.log('Generando el AppImage en Linux…');
  const status = run('npx', ['electron-builder', '--linux', 'AppImage', '--x64']);
  process.exit(status);
}

if (!dockerReady()) {
  console.error(`No se puede generar el AppImage directamente en este sistema.

Windows y macOS no pueden crear los enlaces simbólicos y el sistema de archivos
que necesita un AppImage. Opciones:

  1. Instala Docker Desktop y vuelve a ejecutar:
       npm run dist:appimage
     (o «npm run dist:appimage -- --docker»)

  2. Compila en un equipo Linux:
       npm ci
       npm run dist:appimage

  3. Usa GitHub Actions: pestaña Actions → Build distributables → Run workflow.

El AppImage se generaría en ${artifact}.`);
  process.exit(1);
}

console.log('Generando el AppImage con Docker…');
const dockerArgs = [
  'run',
  '--rm',
  '-v',
  `${projectDir}:/project`,
  '-v',
  '/project/node_modules',
  '-v',
  'cue-player-pad-npm-cache:/root/.npm',
  '-v',
  'cue-player-pad-electron-cache:/root/.cache/electron',
  '-v',
  'cue-player-pad-builder-cache:/root/.cache/electron-builder',
  '-w',
  '/project',
  dockerImage,
  'bash',
  '-lc',
  'npm ci && npx electron-builder --linux AppImage --x64',
];

process.exit(run('docker', dockerArgs));
