'use strict';

const crypto = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REMOTE_DIR = path.join(__dirname, 'remote');
const DEFAULT_PORT = 8787;
const DEFAULT_SECURE_PORT = 8788;
const PORT_TRIES = 10;
const MAX_BODY_BYTES = 4096;
const MAX_CLIENTS = 32;
const MAX_PROJECT_BYTES = 4 * 1024 * 1024 * 1024;
const CERT_DIR = 'remote-cert';
const UPLOAD_DIR = 'remote-uploads';

function uploadFileName(value) {
  let name = String(value || '').trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    // El nombre llega tal cual.
  }
  name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim();
  if (!name) return 'proyecto.cuepad';
  return name.slice(0, 160);
}

// Botones del APC mini que no son pads: 64–71 (pista), 82–89 (escena) y 98 (Shift).
const CONTROL_NOTES = new Set([
  64, 65, 66, 67, 68, 69, 70, 71,
  82, 83, 84, 85, 86, 87, 88, 89,
  98,
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('La orden es demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        reject(new Error('JSON no válido'));
      }
    });
    req.on('error', reject);
  });
}

function lanAddresses() {
  const result = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      result.push({ name, address: entry.address });
    }
  }
  return result;
}

class RemoteServer {
  constructor({
    onCommand,
    onStatus = null,
    dataDir = null,
    onProjectUpload = null,
    maxProjectBytes = MAX_PROJECT_BYTES,
  } = {}) {
    this.onCommand = onCommand;
    this.onStatus = onStatus;
    this.onProjectUpload = onProjectUpload;
    this.dataDir = dataDir || path.join(os.tmpdir(), 'cue-player-pad');
    this.uploadDir = path.join(this.dataDir, UPLOAD_DIR);
    this.maxProjectBytes = Math.max(1, Number(maxProjectBytes) || MAX_PROJECT_BYTES);
    this.projectUploadBusy = false;
    this.httpServer = null;
    this.httpsServer = null;
    this.port = null;
    this.securePort = null;
    this.secureError = null;
    this.error = null;
    this.lastState = null;
    this.clients = new Set();
    this.heartbeat = null;
  }

  info() {
    if (!this.httpServer) {
      return { enabled: false, error: this.error || 'El servidor no está iniciado' };
    }

    const base = (scheme, host, port) => `${scheme}://${host}:${port}/`;
    const urls = [{ label: 'Este equipo', url: base('http', '127.0.0.1', this.port) }];
    const secureUrls = [];

    for (const item of lanAddresses()) {
      urls.push({
        label: `${item.name} · ${item.address}`,
        url: base('http', item.address, this.port),
      });
    }

    if (this.httpsServer) {
      secureUrls.push({
        label: 'Este equipo',
        url: base('https', '127.0.0.1', this.securePort),
      });
      for (const item of lanAddresses()) {
        secureUrls.push({
          label: `${item.name} · ${item.address}`,
          url: base('https', item.address, this.securePort),
        });
      }
    }

    return {
      enabled: true,
      port: this.port,
      securePort: this.httpsServer ? this.securePort : null,
      httpsAvailable: Boolean(this.httpsServer),
      secureError: this.secureError,
      maxProjectBytes: this.maxProjectBytes,
      urls,
      secureUrls,
    };
  }

  async start() {
    // Restos de una carga interrumpida en una ejecución anterior.
    await fsp.rm(this.uploadDir, { recursive: true, force: true }).catch(() => {});

    this.httpServer = await this.listenOnFreePort(DEFAULT_PORT, 'http');
    this.port = this.httpServer.address().port;

    try {
      const credentials = await this.ensureCertificate();
      this.httpsServer = await this.listenOnFreePort(DEFAULT_SECURE_PORT, 'https', credentials);
      this.securePort = this.httpsServer.address().port;
      this.secureError = null;
    } catch (error) {
      this.secureError = error instanceof Error ? error.message : String(error);
      console.error('Control remoto HTTPS:', this.secureError);
    }

    this.heartbeat = setInterval(() => {
      for (const res of this.clients) {
        try {
          res.write(': latido\n\n');
        } catch {
          this.clients.delete(res);
        }
      }
    }, 20000);

    this.onStatus?.(this.info());
    return this.info();
  }

  async listenOnFreePort(startPort, protocol, credentials = null) {
    let lastError = null;

    for (let attempt = 0; attempt < PORT_TRIES; attempt += 1) {
      const port = startPort + attempt;
      try {
        return await this.listen(port, protocol, credentials);
      } catch (error) {
        lastError = error;
        if (error.code !== 'EADDRINUSE') throw error;
      }
    }

    const error = new Error(
      `No hay ningún puerto libre entre ${startPort} y ${startPort + PORT_TRIES - 1}`,
    );
    error.cause = lastError;
    throw error;
  }

  listen(port, protocol = 'http', credentials = null) {
    return new Promise((resolve, reject) => {
      const onRequest = (req, res) => {
        this.handle(req, res).catch((error) => {
          console.error('Control remoto:', error);
          try {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Error interno');
          } catch {
            // La respuesta ya estaba cerrada.
          }
        });
      };

      const server = protocol === 'https'
        ? https.createServer({ key: credentials.key, cert: credentials.cert }, onRequest)
        : http.createServer(onRequest);

      // Los proyectos grandes pueden tardar en subir; el corte por inactividad
      // se controla en la propia carga, no con el límite global de petición.
      server.requestTimeout = 30 * 60 * 1000;
      server.headersTimeout = 60 * 1000;

      server.once('error', (error) => {
        try {
          server.close();
        } catch {
          // El servidor no llegó a escuchar.
        }
        reject(error);
      });
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        server.on('error', (error) => console.error('Control remoto:', error));
        resolve(server);
      });
    });
  }

  async ensureCertificate() {
    const dir = path.join(this.dataDir, CERT_DIR);
    const keyPath = path.join(dir, 'key.pem');
    const certPath = path.join(dir, 'cert.pem');
    const metaPath = path.join(dir, 'meta.json');
    const hosts = [...new Set([
      'localhost',
      '127.0.0.1',
      ...lanAddresses().map((item) => item.address),
    ])];

    try {
      const [key, cert, metaRaw] = await Promise.all([
        fsp.readFile(keyPath, 'utf8'),
        fsp.readFile(certPath, 'utf8'),
        fsp.readFile(metaPath, 'utf8'),
      ]);
      const meta = JSON.parse(metaRaw);
      const known = new Set(Array.isArray(meta.hosts) ? meta.hosts : []);
      const expires = Date.parse(meta.expires || '');
      const stillValid = Number.isFinite(expires) && expires - Date.now() > 30 * 24 * 60 * 60 * 1000;
      if (stillValid && hosts.every((host) => known.has(host))) {
        return { key, cert };
      }
    } catch {
      // No hay certificado utilizable: se genera uno nuevo.
    }

    let generate;
    try {
      ({ generate } = require('selfsigned'));
    } catch (error) {
      throw new Error(`No se pudo cargar el generador de certificados (${error.message})`);
    }

    const notBefore = new Date();
    const notAfter = new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
    const pems = await generate(
      [
        { name: 'commonName', value: 'CUE PLAYER PAD' },
        { name: 'organizationName', value: 'CUE PLAYER PAD' },
      ],
      {
        keySize: 2048,
        algorithm: 'sha256',
        notBeforeDate: notBefore,
        notAfterDate: notAfter,
        extensions: [
          { name: 'basicConstraints', cA: false, critical: true },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
          { name: 'extKeyUsage', serverAuth: true },
          {
            name: 'subjectAltName',
            altNames: hosts.map((host) => (
              net.isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }
            )),
          },
        ],
      },
    );

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(keyPath, pems.private, 'utf8');
    await fsp.writeFile(certPath, pems.cert, 'utf8');
    await fsp.writeFile(
      metaPath,
      JSON.stringify({ hosts, created: notBefore.toISOString(), expires: notAfter.toISOString() }, null, 2),
      'utf8',
    );

    return { key: pems.private, cert: pems.cert };
  }

  stop() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;

    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        // Cliente ya cerrado.
      }
    }
    this.clients.clear();

    for (const server of [this.httpServer, this.httpsServer]) {
      if (!server) continue;
      try {
        server.close();
      } catch {
        // El servidor ya estaba cerrado.
      }
    }
    this.httpServer = null;
    this.httpsServer = null;
  }

  broadcast(state) {
    this.lastState = state;
    const payload = `data: ${JSON.stringify({ type: 'state', state })}\n\n`;

    for (const res of this.clients) {
      try {
        res.write(payload);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const headers = {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    const isPost = req.method === 'POST'
      && (url.pathname === '/api/command' || url.pathname === '/api/project');

    if (req.method !== 'GET' && req.method !== 'HEAD' && !isPost) {
      res.writeHead(405, { ...headers, allow: 'GET, HEAD, POST' });
      res.end();
      return;
    }

    if (url.pathname === '/api/events') {
      this.handleEvents(req, res, headers);
      return;
    }

    if (url.pathname === '/api/info') {
      res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        app: 'CUE PLAYER PAD',
        secure: Boolean(req.socket.encrypted),
        httpPort: this.port,
        httpsPort: this.httpsServer ? this.securePort : null,
        maxProjectBytes: this.maxProjectBytes,
      }));
      return;
    }

    if (url.pathname === '/api/command') {
      await this.handleCommand(req, res, headers);
      return;
    }

    if (url.pathname === '/api/project') {
      await this.handleProjectUpload(req, res, headers, url);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      await this.serveFile(res, 'index.html', headers);
      return;
    }

    if (url.pathname === '/remote.css' || url.pathname === '/remote.js' || url.pathname === '/midi-remote.js') {
      await this.serveFile(res, url.pathname.slice(1), headers);
      return;
    }

    res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }

  handleEvents(req, res, headers) {
    if (this.clients.size >= MAX_CLIENTS) {
      res.writeHead(503, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Demasiados clientes conectados' }));
      return;
    }

    res.writeHead(200, {
      ...headers,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    if (this.lastState) {
      res.write(`data: ${JSON.stringify({ type: 'state', state: this.lastState })}\n\n`);
    }

    this.clients.add(res);
    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  async handleCommand(req, res, headers) {
    let command;
    try {
      command = await readJsonBody(req);
    } catch (error) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      return;
    }

    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Orden no válida' }));
      return;
    }

    const allowed = new Set([
      'toggle', 'mute', 'stop_all', 'reset', 'master_mute', 'master', 'control', 'fader',
    ]);
    if (!allowed.has(command.kind)) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Función no permitida' }));
      return;
    }

    if ((command.kind === 'toggle' || command.kind === 'mute')
      && (!Number.isInteger(command.note) || command.note < 0 || command.note > 63)) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Pad no válido' }));
      return;
    }

    if (command.kind === 'control' && !CONTROL_NOTES.has(command.note)) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Botón no válido' }));
      return;
    }

    if (command.kind === 'fader'
      && (!Number.isInteger(command.cc) || command.cc < 0 || command.cc > 127
        || !Number.isFinite(Number(command.value)) || command.value < 0 || command.value > 1)) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Fader no válido' }));
      return;
    }

    if (command.kind === 'master'
      && (!Number.isFinite(Number(command.value)) || command.value < 0 || command.value > 1)) {
      res.writeHead(400, { ...headers, 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Volumen no válido' }));
      return;
    }

    this.onCommand?.(command);

    res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  }

  async handleProjectUpload(req, res, headers, url) {
    const jsonHeaders = { ...headers, 'content-type': 'application/json; charset=utf-8' };
    const fail = (status, message) => {
      try {
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(status, jsonHeaders);
        res.end(JSON.stringify({ error: message }));
      } catch {
        // El navegador cerró la conexión antes de la respuesta.
      }
    };

    if (typeof this.onProjectUpload !== 'function') {
      req.resume();
      fail(503, 'La carga de proyectos no está disponible');
      return;
    }

    if (this.projectUploadBusy) {
      req.resume();
      fail(409, 'Ya hay un proyecto cargándose. Espera a que termine.');
      return;
    }

    const fileName = uploadFileName(
      req.headers['x-project-name'] || url.searchParams.get('name'),
    );
    if (!/\.cuepad$/i.test(fileName)) {
      req.resume();
      fail(400, 'El archivo debe tener la extensión .cuepad');
      return;
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > this.maxProjectBytes) {
      req.resume();
      fail(413, `El proyecto supera el límite de ${Math.round(this.maxProjectBytes / (1024 * 1024))} MB`);
      return;
    }

    const maxBytes = this.maxProjectBytes;
    let tempPath = null;
    let size = 0;
    let tooBig = false;

    this.projectUploadBusy = true;

    // Si la red se queda muda, no dejamos el servidor bloqueado para siempre.
    req.setTimeout(2 * 60 * 1000, () => {
      req.destroy(new Error('La carga quedó inactiva durante demasiado tiempo'));
    });

    try {
      await fsp.mkdir(this.uploadDir, { recursive: true });
      tempPath = path.join(this.uploadDir, `${Date.now()}-${crypto.randomUUID()}.cuepad`);

      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > maxBytes) {
            tooBig = true;
            callback();
            return;
          }
          callback(null, chunk);
        },
      });

      await pipeline(req, limiter, createWriteStream(tempPath));
      // La espera de extracción y carga ya no es una subida: no debe cortarse
      // por el tiempo de inactividad de la recepción.
      req.setTimeout(0);

      if (tooBig) {
        fail(413, `El proyecto supera el límite de ${Math.round(maxBytes / (1024 * 1024))} MB`);
        return;
      }

      if (size === 0) {
        fail(400, 'El archivo enviado está vacío');
        return;
      }

      // Si el navegador cerró la pestaña justo al terminar de enviar, no
      // aplicamos un proyecto que ya nadie va a confirmar.
      if (res.destroyed) return;

      const result = await this.onProjectUpload({ filePath: tempPath, fileName, size });

      if (!res.destroyed) {
        res.writeHead(200, jsonHeaders);
        res.end(JSON.stringify({ ok: true, ...result }));
      }
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
      fail(status, error instanceof Error ? error.message : String(error));
    } finally {
      this.projectUploadBusy = false;
      if (tempPath) {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
      }
    }
  }

  async serveFile(res, name, headers) {
    const filePath = path.normalize(path.join(REMOTE_DIR, name));
    const inside = path.relative(REMOTE_DIR, filePath);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      res.writeHead(403, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('Prohibido');
      return;
    }

    let data;
    try {
      data = await fsp.readFile(filePath);
    } catch {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }

    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const extra = name.endsWith('.html')
      ? {
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
      }
      : {};

    res.writeHead(200, {
      ...headers,
      ...extra,
      'content-type': type,
      'cache-control': 'no-store',
    });
    res.end(data);
  }
}

module.exports = { RemoteServer };
