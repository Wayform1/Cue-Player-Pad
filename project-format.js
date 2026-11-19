'use strict';

// Formato de proyecto propio de CUE PLAYER PAD (.cuepad).
//
// Un archivo .cuepad es un contenedor binario sencillo y autocontenido:
//
//   [8 bytes]  firma "CUEPAD01"
//   [4 bytes]  longitud de la cabecera JSON (uint32 little-endian)
//   [n bytes]  cabecera JSON en UTF-8
//   [n bytes]  audio de cada pad, en el mismo orden que la cabecera
//
// La cabecera guarda la configuración completa (pads, volúmenes, faders,
// master y asignaciones) más una lista de audios con su tamaño y SHA-256.
// Los audios se guardan sin comprimir porque ya suelen estar comprimidos
// (MP3, OGG, M4A…) y así se evita duplicar el trabajo al guardar y abrir.
//
// Al abrir un proyecto, los audios se extraen a una carpeta de la aplicación
// y la configuración se devuelve con las rutas ya apuntando a esa carpeta.
// De ese modo el proyecto funciona en otro equipo sin depender de las rutas
// originales.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAGIC = Buffer.from('CUEPAD01', 'ascii');
const FORMAT_NAME = 'cue-player-pad-project';
const FORMAT_VERSION = 1;
const MAX_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;

const MIME_TYPES = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
};

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeFileName(value, fallback = 'pista') {
  const source = typeof value === 'string' && value.trim() ? value : fallback;
  const base = path.basename(source);
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function fileExtension(filePath) {
  return path.extname(typeof filePath === 'string' ? filePath : '').toLowerCase();
}

function mimeFor(filePath) {
  return MIME_TYPES[fileExtension(filePath)] || 'application/octet-stream';
}

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} no es válido`);
  }
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;

  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      throw new Error('El archivo del proyecto está incompleto');
    }
    offset += bytesRead;
  }

  return buffer;
}

/**
 * Escribe un proyecto .cuepad autocontenido.
 *
 * @param {object} options
 * @param {string} options.filePath Ruta de destino.
 * @param {object} options.config Configuración ya saneada.
 * @param {string} options.appVersion Versión visible de la aplicación.
 * @param {string} [options.projectId] Identificador estable para la extracción.
 * @returns {Promise<{embedded: number, missing: number, missingPads: number[], bytes: number}>}
 */
async function writeProjectFile({ filePath, config, appVersion, projectId }) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('La ruta del proyecto no es válida');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('La configuración del proyecto no es válida');
  }

  const portableConfig = JSON.parse(JSON.stringify(config));
  const pads = portableConfig.pads && typeof portableConfig.pads === 'object'
    ? portableConfig.pads
    : {};
  portableConfig.pads = pads;

  const audio = [];
  const missing = [];
  let totalBytes = 0;

  const notes = Object.keys(pads)
    .map((key) => Number(key))
    .filter((note) => Number.isInteger(note) && note >= 0 && note <= 63)
    .sort((a, b) => a - b);

  for (const note of notes) {
    const entry = pads[note];
    if (!entry || typeof entry.path !== 'string' || !entry.path) {
      delete pads[note];
      continue;
    }

    try {
      const stat = await fsp.stat(entry.path);
      if (!stat.isFile()) throw new Error('no es un archivo');
      if (stat.size > MAX_AUDIO_BYTES) {
        throw new Error('supera el límite de 512 MB');
      }
      if (totalBytes + stat.size > MAX_TOTAL_BYTES) {
        throw new Error('el proyecto supera el límite total de 4 GB');
      }

      const bytes = await fsp.readFile(entry.path);
      if (bytes.length > MAX_AUDIO_BYTES) {
        throw new Error('supera el límite de 512 MB');
      }
      if (totalBytes + bytes.length > MAX_TOTAL_BYTES) {
        throw new Error('el proyecto supera el límite total de 4 GB');
      }

      const originalName = path.basename(entry.path);
      const suggested = typeof entry.name === 'string' && entry.name.trim()
        ? entry.name
        : originalName;
      let name = safeFileName(suggested, `pista-${note + 1}`);
      if (!path.extname(name) && path.extname(originalName)) {
        name += path.extname(originalName);
      }

      audio.push({
        pad: note,
        name,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        mime: mimeFor(entry.path),
        bytes,
      });

      totalBytes += bytes.length;

      // La ruta absoluta no viaja en el proyecto: se sustituye por una marca
      // que se resuelve al extraer el audio en el equipo de destino.
      pads[note] = {
        ...entry,
        path: `@audio:${note}`,
      };
    } catch (error) {
      delete pads[note];
      // No se guarda la ruta ni el error completo para no filtrar nombres de
      // usuario al compartir el proyecto; basta con saber qué pads faltan.
      missing.push({
        pad: note,
        name: typeof entry.name === 'string' && entry.name.trim()
          ? entry.name
          : path.basename(entry.path),
      });
    }
  }

  const header = {
    format: FORMAT_NAME,
    format_version: FORMAT_VERSION,
    app: 'CUE PLAYER PAD',
    app_version: typeof appVersion === 'string' ? appVersion : '',
    id: typeof projectId === 'string' && ID_PATTERN.test(projectId)
      ? projectId
      : crypto.randomUUID(),
    saved_at: new Date().toISOString(),
    config: portableConfig,
    audio: audio.map(({ bytes, ...meta }) => meta),
    missing,
  };

  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerBytes.length > MAX_HEADER_BYTES) {
    throw new Error('La cabecera del proyecto es demasiado grande');
  }

  const dataStart = MAGIC.length + 4 + headerBytes.length;
  const totalSize = dataStart + audio.reduce((sum, item) => sum + item.bytes.length, 0);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  let handle = null;
  try {
    handle = await fsp.open(tempPath, 'w');

    let position = 0;
    await handle.write(MAGIC, 0, MAGIC.length, position);
    position += MAGIC.length;

    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(headerBytes.length, 0);
    await handle.write(lengthBuffer, 0, 4, position);
    position += 4;

    await handle.write(headerBytes, 0, headerBytes.length, position);
    position += headerBytes.length;

    for (const item of audio) {
      await handle.write(item.bytes, 0, item.bytes.length, position);
      position += item.bytes.length;
      item.bytes = null;
    }

    await handle.sync();
    await handle.close();
    handle = null;

    await fsp.rename(tempPath, filePath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // El descriptor ya puede estar cerrado.
      }
    }
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    embedded: audio.length,
    missing: missing.length,
    missingPads: missing.map((item) => item.pad),
    bytes: totalSize,
  };
}

/**
 * Lee un proyecto .cuepad y extrae sus audios.
 *
 * @param {object} options
 * @param {string} options.filePath Ruta del proyecto.
 * @param {string} options.extractRoot Carpeta base para extraer los audios.
 * @param {(input: unknown) => object} options.sanitizeConfig Validador de configuración.
 * @returns {Promise<{config: object, header: object, audioCount: number, missingPads: number[], extractedDir: string}>}
 */
async function readProjectFile({ filePath, extractRoot, sanitizeConfig }) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('La ruta del proyecto no es válida');
  }
  if (typeof extractRoot !== 'string' || !extractRoot) {
    throw new Error('No hay una carpeta para extraer el proyecto');
  }
  if (typeof sanitizeConfig !== 'function') {
    throw new Error('Falta el validador de configuración');
  }

  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error('La ruta no es un archivo');
  if (stat.size < MAGIC.length + 4) throw new Error('El archivo no es un proyecto válido');

  const handle = await fsp.open(filePath, 'r');
  let tempDir = null;

  try {
    const magic = await readExact(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) {
      throw new Error('El archivo no es un proyecto de CUE PLAYER PAD');
    }

    const lengthBuffer = await readExact(handle, 4, MAGIC.length);
    const headerLength = lengthBuffer.readUInt32LE(0);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
      throw new Error('La cabecera del proyecto no es válida');
    }

    const headerBytes = await readExact(handle, headerLength, MAGIC.length + 4);
    let header;
    try {
      header = JSON.parse(headerBytes.toString('utf8'));
    } catch (error) {
      throw new Error(`La cabecera del proyecto está dañada (${errorMessage(error)})`);
    }

    if (!header || header.format !== FORMAT_NAME) {
      throw new Error('El archivo no es un proyecto de CUE PLAYER PAD');
    }
    if (header.format_version !== FORMAT_VERSION) {
      throw new Error(`Versión de proyecto no compatible (${header.format_version})`);
    }
    if (typeof header.id !== 'string' || !ID_PATTERN.test(header.id)) {
      throw new Error('El identificador del proyecto no es válido');
    }
    if (!Array.isArray(header.audio)) {
      throw new Error('La lista de audios del proyecto no es válida');
    }

    const config = sanitizeConfig(header.config);
    const dataStart = MAGIC.length + 4 + headerLength;

    let totalAudio = 0;
    const seen = new Set();
    for (const item of header.audio) {
      if (!item || typeof item !== 'object') {
        throw new Error('La lista de audios del proyecto no es válida');
      }
      assertInteger(item.pad, 0, 63, 'El pad del audio');
      assertInteger(item.size, 0, MAX_AUDIO_BYTES, 'El tamaño del audio');
      if (seen.has(item.pad)) throw new Error(`El pad ${item.pad + 1} está duplicado`);
      seen.add(item.pad);
      if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) {
        throw new Error('La firma de un audio no es válida');
      }
      totalAudio += item.size;
      if (totalAudio > MAX_TOTAL_BYTES) {
        throw new Error('El proyecto supera el límite total de 4 GB');
      }
    }

    if (dataStart + totalAudio > stat.size) {
      throw new Error('El proyecto está incompleto o dañado');
    }

    await fsp.mkdir(extractRoot, { recursive: true });
    tempDir = path.join(extractRoot, `.tmp-${header.id}-${process.pid}-${Date.now()}`);
    await fsp.mkdir(tempDir, { recursive: true });

    let offset = dataStart;
    for (const item of header.audio) {
      const name = safeFileName(item.name, `pista-${item.pad + 1}`);
      const destination = path.join(tempDir, `${item.pad}-${name}`);
      const destinationHandle = await fsp.open(destination, 'w');
      const hash = crypto.createHash('sha256');

      try {
        let remaining = item.size;
        let position = offset;

        while (remaining > 0) {
          const chunkLength = Math.min(1024 * 1024, remaining);
          const chunk = await readExact(handle, chunkLength, position);
          hash.update(chunk);
          await destinationHandle.write(chunk, 0, chunk.length, item.size - remaining);
          position += chunkLength;
          remaining -= chunkLength;
        }
      } finally {
        await destinationHandle.close();
      }

      if (hash.digest('hex') !== item.sha256) {
        throw new Error(`El audio del pad ${item.pad + 1} está dañado`);
      }

      const existing = config.pads[item.pad] || {};
      config.pads[item.pad] = {
        path: path.join(extractRoot, header.id, `${item.pad}-${name}`),
        name: existing.name ?? null,
        volume: existing.volume ?? 1,
        fader: existing.fader ?? null,
      };

      offset += item.size;
    }

    const finalDir = path.join(extractRoot, header.id);
    await fsp.rm(finalDir, { recursive: true, force: true });
    await fsp.rename(tempDir, finalDir);
    tempDir = null;

    const missingPads = Array.isArray(header.missing)
      ? header.missing
        .map((item) => Number(item?.pad))
        .filter((pad) => Number.isInteger(pad) && pad >= 0 && pad < 64)
      : [];

    return {
      config,
      header,
      audioCount: header.audio.length,
      missingPads,
      extractedDir: finalDir,
    };
  } finally {
    if (tempDir) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    await handle.close();
  }
}

module.exports = {
  FORMAT_NAME,
  FORMAT_VERSION,
  MAGIC,
  MAX_AUDIO_BYTES,
  MAX_TOTAL_BYTES,
  readProjectFile,
  safeFileName,
  writeProjectFile,
};
