'use strict';

// Prueba del contenedor .cuepad sin abrir Electron.
// Uso: node tools/test-project-format.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  MAGIC,
  readProjectFile,
  safeFileName,
  writeProjectFile,
} = require('../project-format');

function sanitizeForTest(input) {
  if (!input || typeof input !== 'object') throw new Error('config inválida');
  const pads = {};
  for (const [key, value] of Object.entries(input.pads || {})) {
    const note = Number(key);
    if (!Number.isInteger(note) || note < 0 || note > 63) continue;
    if (!value || typeof value.path !== 'string' || !value.path) continue;
    pads[note] = {
      path: value.path,
      name: typeof value.name === 'string' ? value.name : null,
      volume: Math.max(0, Math.min(1, Number(value.volume) || 1)),
      fader: value.fader === null || value.fader === undefined
        ? null
        : Math.max(0, Math.min(127, Math.round(Number(value.fader)))),
    };
  }
  return {
    version: 3,
    master: Math.max(0, Math.min(1, Number(input.master) || 1)),
    master_cc: 56,
    controls: { ...(input.controls || {}) },
    pads,
  };
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cuepad-test-'));
  const audioA = Buffer.concat([Buffer.from('RIFF'), crypto.randomBytes(2048)]);
  const audioB = Buffer.concat([Buffer.from('OggS'), crypto.randomBytes(4096)]);
  const fileA = path.join(root, 'Pista A.wav');
  const fileB = path.join(root, 'Pista B.ogg');
  await fsp.writeFile(fileA, audioA);
  await fsp.writeFile(fileB, audioB);

  const config = {
    version: 3,
    master: 0.73,
    master_cc: 56,
    controls: { 82: 'scene_toggle', 89: 'stop_all', 98: 'reset_state' },
    pads: {
      0: { path: fileA, name: 'Entrada', volume: 0.8, fader: 48 },
      5: { path: fileB, name: 'Salida', volume: 1, fader: null },
      9: { path: path.join(root, 'no-existe.wav'), name: 'Fantasma', volume: 1, fader: null },
    },
  };

  const projectPath = path.join(root, 'prueba.cuepad');
  const written = await writeProjectFile({
    filePath: projectPath,
    config,
    appVersion: '2.1.0',
  });

  assert.equal(written.embedded, 2);
  assert.equal(written.missing, 1);
  assert.deepEqual(written.missingPads, [9]);

  const raw = await fsp.readFile(projectPath);
  assert.ok(raw.subarray(0, MAGIC.length).equals(MAGIC), 'firma correcta');
  assert.equal(raw.readUInt32LE(8) > 0, true, 'cabecera presente');

  // No debe filtrar la ruta absoluta original.
  assert.equal(raw.includes(Buffer.from(root, 'utf8')), false, 'sin rutas absolutas');

  const extractRoot = path.join(root, 'extraidos');
  const opened = await readProjectFile({
    filePath: projectPath,
    extractRoot,
    sanitizeConfig: sanitizeForTest,
  });

  assert.equal(opened.audioCount, 2);
  assert.deepEqual(opened.missingPads, [9]);
  assert.equal(opened.config.master, 0.73);
  assert.equal(opened.config.controls[82], 'scene_toggle');
  assert.equal(opened.config.controls[98], 'reset_state');
  assert.equal(opened.config.pads[9], undefined);

  const extractedA = await fsp.readFile(opened.config.pads[0].path);
  const extractedB = await fsp.readFile(opened.config.pads[5].path);
  assert.ok(extractedA.equals(audioA), 'audio A idéntico');
  assert.ok(extractedB.equals(audioB), 'audio B idéntico');
  assert.equal(opened.config.pads[0].name, 'Entrada');
  assert.equal(opened.config.pads[0].volume, 0.8);
  assert.equal(opened.config.pads[0].fader, 48);
  assert.ok(opened.config.pads[0].path.startsWith(extractRoot), 'ruta extraída');
  assert.equal(safeFileName('../../evil.wav'), 'evil.wav', 'sin traversal');

  // Proyecto dañado: alterar un byte del audio.
  const corrupted = Buffer.from(raw);
  corrupted[corrupted.length - 1] ^= 0xff;
  const corruptedPath = path.join(root, 'danado.cuepad');
  await fsp.writeFile(corruptedPath, corrupted);
  await assert.rejects(
    () => readProjectFile({
      filePath: corruptedPath,
      extractRoot: path.join(root, 'extraidos-danado'),
      sanitizeConfig: sanitizeForTest,
    }),
    /dañado/,
  );

  // Firma incorrecta.
  const wrongMagic = Buffer.from(raw);
  wrongMagic.write('NOPE0000', 0, 'ascii');
  const wrongPath = path.join(root, 'firma.cuepad');
  await fsp.writeFile(wrongPath, wrongMagic);
  await assert.rejects(
    () => readProjectFile({
      filePath: wrongPath,
      extractRoot: path.join(root, 'extraidos-firma'),
      sanitizeConfig: sanitizeForTest,
    }),
    /no es un proyecto/,
  );

  await fsp.rm(root, { recursive: true, force: true });

  console.log(JSON.stringify({
    ok: true,
    embedded: written.embedded,
    missing: written.missing,
    bytes: written.bytes,
    extracted: opened.extractedDir,
    corruptedRejected: true,
    wrongMagicRejected: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
