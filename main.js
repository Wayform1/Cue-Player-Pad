'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { RemoteServer } = require('./remote-server');

const APP_SCHEME = 'apcsampler';
const RENDERER_DIR = path.join(__dirname, 'renderer');
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const DEFAULT_CONFIG = { version: 3, master: 1, master_cc: 56, controls: {}, pads: {} };

const LEGACY_APP_NAME = 'APC mini Sampler';

app.setName('CUE PLAYER PAD');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let configPath = null;
let remoteServer = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'pads.json');
}

function clampNumber(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('La configuración no es un objeto válido');
  }

  // Formatos antiguos: el JSON era directamente { "0": {path: ...}, ... }
  const wrapped = input.pads && typeof input.pads === 'object' && !Array.isArray(input.pads);
  const rawPads = wrapped ? input.pads : input;

  const result = {
    version: 3,
    master: wrapped ? clampNumber(input.master, 1, 0, 1) : 1,
    master_cc: 56,
    controls: {},
    pads: {},
  };

  if (wrapped && Object.prototype.hasOwnProperty.call(input, 'master_cc')) {
    result.master_cc = input.master_cc === null
      ? null
      : Math.round(clampNumber(input.master_cc, 56, 0, 127));
  }

  if (wrapped && input.controls && typeof input.controls === 'object' && !Array.isArray(input.controls)) {
    for (const [key, value] of Object.entries(input.controls)) {
      const note = Number(key);
      const isControl = (note >= 64 && note <= 71) || (note >= 82 && note <= 89) || note === 98;
      if (!isControl) continue;
      if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,40}$/.test(value)) continue;
      result.controls[note] = value;
    }
  }

  for (const [key, rawEntry] of Object.entries(rawPads)) {
    const note = Number(key);
    if (!Number.isInteger(note) || note < 0 || note > 63) continue;

    let entry = rawEntry;
    if (typeof entry === 'string') entry = { path: entry };
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !entry.path) {
      continue;
    }

    let fader = null;
    if (Object.prototype.hasOwnProperty.call(entry, 'fader') && entry.fader !== null) {
      const value = typeof entry.fader === 'number' ? entry.fader : Number(entry.fader);
      if (Number.isFinite(value)) {
        fader = Math.min(127, Math.max(0, Math.round(value)));
      }
    }

    result.pads[note] = {
      path: entry.path.slice(0, 4096),
      name: typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.slice(0, 200)
        : null,
      volume: clampNumber(entry.volume, 1, 0, 1),
      fader,
    };
  }

  return result;
}

async function writeConfig(data) {
  const safe = sanitizeConfig(data);
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8');
  await fsp.rename(tmp, configPath);
}

function writeConfigSync(data) {
  const safe = sanitizeConfig(data);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), 'utf8');
  fs.renameSync(tmp, configPath);
}

async function ensureConfig() {
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  try {
    await fsp.access(configPath);
    return;
  } catch {
    // Aún no existe: se intenta migrar desde versiones anteriores.
  }

  const legacyPaths = [
    path.join(app.getPath('appData'), LEGACY_APP_NAME, 'pads.json'),
    path.join(__dirname, 'pads.json'),
  ];

  for (const legacy of legacyPaths) {
    if (path.resolve(legacy) === path.resolve(configPath)) continue;
    try {
      await fsp.access(legacy);
      await fsp.copyFile(legacy, configPath);
      console.info(`Configuración migrada desde ${legacy}`);
      return;
    } catch {
      // Siguiente candidato.
    }
  }

  await writeConfig(DEFAULT_CONFIG);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      let relative = decodeURIComponent(url.pathname);
      if (!relative || relative === '/') relative = '/index.html';

      const filePath = path.normalize(path.join(RENDERER_DIR, relative));
      const insideRenderer = path.relative(RENDERER_DIR, filePath);
      if (insideRenderer.startsWith('..') || path.isAbsolute(insideRenderer)) {
        return new Response('Forbidden', { status: 403 });
      }

      const data = await fsp.readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, {
        headers: {
          'content-type': type,
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('dialog:pick-audio', async (event, title) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: typeof title === 'string' && title ? title.slice(0, 120) : 'Cargar pista',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['wav', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'webm'],
        },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('fs:read-audio', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Ruta de archivo no válida');
    }
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('La ruta no es un archivo');
    if (stat.size > MAX_AUDIO_BYTES) {
      throw new Error('El archivo supera el límite de 512 MB');
    }
    return await fsp.readFile(filePath);
  });

  ipcMain.handle('config:load', async () => {
    await ensureConfig();

    let raw;
    try {
      raw = await fsp.readFile(configPath, 'utf8');
    } catch (error) {
      return {
        config: null,
        path: configPath,
        error: `No se pudo leer el archivo (${errorMessage(error)})`,
      };
    }

    try {
      return { config: sanitizeConfig(JSON.parse(raw)), path: configPath };
    } catch (error) {
      let backupPath = null;
      try {
        backupPath = `${configPath}.bak`;
        await fsp.copyFile(configPath, backupPath);
      } catch {
        backupPath = null;
      }

      const backupNote = backupPath
        ? ` Se guardó una copia del archivo dañado en ${path.basename(backupPath)}.`
        : '';

      return {
        config: sanitizeConfig(DEFAULT_CONFIG),
        path: configPath,
        backupPath,
        error: `pads.json no es válido (${errorMessage(error)}).${backupNote}`,
      };
    }
  });

  ipcMain.handle('config:save', async (_event, data) => {
    await writeConfig(data);
    return true;
  });

  ipcMain.on('config:save-sync', (event, data) => {
    try {
      writeConfigSync(data);
      event.returnValue = true;
    } catch (error) {
      console.error('No se pudo guardar pads.json:', error);
      event.returnValue = false;
    }
  });

  ipcMain.handle('config:path', () => configPath);

  ipcMain.handle('project:save', async (event, data) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const suggested = `CUE PLAYER PAD ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}.json`;

    const result = await dialog.showSaveDialog(owner, {
      title: 'Guardar proyecto',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'Proyecto CUE PLAYER PAD', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    const project = {
      ...sanitizeConfig(data),
      app: 'CUE PLAYER PAD',
      saved_at: stamp.toISOString(),
    };

    await fsp.writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf8');
    return { canceled: false, path: result.filePath };
  });

  ipcMain.on('remote:publish', (_event, state) => {
    remoteServer?.broadcast(state);
  });

  ipcMain.handle('remote:info', () => (
    remoteServer?.info() ?? { enabled: false, error: 'Servidor no iniciado' }
  ));
}

function configurePermissions(ses) {
  const isMidi = (permission) => permission === 'midi' || permission === 'midiSysex';

  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(isMidi(permission));
  });

  ses.setPermissionCheckHandler((_webContents, permission) => isMidi(permission));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: '#0c1016',
    show: false,
    autoHideMenuBar: true,
    title: 'CUE PLAYER PAD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  configurePermissions(mainWindow.webContents.session);

  mainWindow.loadURL(`${APP_SCHEME}://renderer/index.html`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${APP_SCHEME}://renderer/`)) event.preventDefault();
  });

  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = String(input.key || '').toLowerCase();
      if (
        input.type === 'keyDown'
        && (key === 'f12' || (input.control && input.shift && key === 'i'))
      ) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    configPath = getConfigPath();
    try {
      await ensureConfig();
    } catch (error) {
      console.error('No se pudo preparar pads.json:', error);
    }
    registerAppProtocol();
    registerIpc();

    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

    createWindow();

    remoteServer = new RemoteServer({
      onCommand: (command) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remote:command', command);
        }
      },
      onStatus: (info) => {
        const lan = info.urls?.find((item) => item.label !== 'Este equipo');
        console.info(`Control remoto activo en el puerto ${info.port}${lan ? ` · ${lan.url}` : ''}`);
      },
    });

    try {
      await remoteServer.start();
    } catch (error) {
      console.error('No se pudo iniciar el control remoto:', error);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    remoteServer?.stop();
    remoteServer = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
