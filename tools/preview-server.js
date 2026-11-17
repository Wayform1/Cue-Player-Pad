'use strict';

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'renderer');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || process.argv[2] || 5173);

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

function resolvePath(urlPath) {
  let relative;
  try {
    relative = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!relative || relative === '/') relative = '/index.html';

  const filePath = path.normalize(path.join(ROOT, relative));
  const inside = path.relative(ROOT, filePath);
  if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return filePath;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' });
    response.end('Método no permitido');
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host || HOST}`).pathname;
  } catch {
    response.writeHead(400);
    response.end('Petición no válida');
    return;
  }

  const filePath = resolvePath(pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end('Prohibido');
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const data = await fsp.readFile(target);
    const type = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';

    response.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });

    if (request.method === 'HEAD') response.end();
    else response.end(data);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('No encontrado');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} está ocupado. Prueba con: npm run preview -- 5174`);
  } else {
    console.error('No se pudo iniciar la vista previa:', error);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  Vista previa: http://${HOST}:${PORT}/`);
  console.log('  Modo demostración: pistas sintéticas y configuración en localStorage.');
  console.log('  Pulsa Ctrl+C para detenerla.');
  console.log('');
});
