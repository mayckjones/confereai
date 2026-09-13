const http = require('http');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) && target !== root) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
