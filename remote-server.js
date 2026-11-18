'use strict';

const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const REMOTE_DIR = path.join(__dirname, 'remote');
const DEFAULT_PORT = 8787;
const PORT_TRIES = 10;
const MAX_BODY_BYTES = 4096;
const MAX_CLIENTS = 32;

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
  constructor({ onCommand, onStatus = null } = {}) {
    this.onCommand = onCommand;
    this.onStatus = onStatus;
    this.server = null;
    this.port = null;
    this.error = null;
    this.lastState = null;
    this.clients = new Set();
    this.heartbeat = null;
  }

  info() {
    if (!this.server) {
      return { enabled: false, error: this.error || 'El servidor no está iniciado' };
    }

    const base = (host) => `http://${host}:${this.port}/`;
    const urls = [{ label: 'Este equipo', url: base('127.0.0.1') }];

    for (const item of lanAddresses()) {
      urls.push({
        label: `${item.name} · ${item.address}`,
        url: base(item.address),
      });
    }

    return {
      enabled: true,
      port: this.port,
      urls,
    };
  }

  async start() {
    for (let attempt = 0; attempt < PORT_TRIES; attempt += 1) {
      const port = DEFAULT_PORT + attempt;
      try {
        this.server = await this.listen(port);
        this.port = port;
        this.error = null;
        break;
      } catch (error) {
        if (error.code !== 'EADDRINUSE') {
          this.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
    }

    if (!this.server) {
      this.error = `No hay ningún puerto libre entre ${DEFAULT_PORT} y ${DEFAULT_PORT + PORT_TRIES - 1}`;
      throw new Error(this.error);
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

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((error) => {
          console.error('Control remoto:', error);
          try {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('Error interno');
          } catch {
            // La respuesta ya estaba cerrada.
          }
        });
      });

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

    if (this.server) {
      this.server.close();
      this.server = null;
    }
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

    if (req.method !== 'GET' && req.method !== 'HEAD' && url.pathname !== '/api/command') {
      res.writeHead(405, { ...headers, allow: 'GET, HEAD, POST' });
      res.end();
      return;
    }

    if (url.pathname === '/api/events') {
      this.handleEvents(req, res, headers);
      return;
    }

    if (url.pathname === '/api/command') {
      await this.handleCommand(req, res, headers);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      await this.serveFile(res, 'index.html', headers);
      return;
    }

    if (url.pathname === '/remote.css' || url.pathname === '/remote.js') {
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

    const allowed = new Set(['toggle', 'mute', 'stop_all', 'reset', 'master_mute', 'master']);
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
