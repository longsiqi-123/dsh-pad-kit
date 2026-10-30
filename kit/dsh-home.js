const http = require('http');
const fs = require('fs');

const DIR = '/data/data/com.termux/files/home/dshpad';

function currentUrl() {
  try {
    const t = fs.readFileSync(DIR + '/url.txt', 'utf8').trim();
    if (t.startsWith('http')) return t;
  } catch (e) {}
  try {
    const log = fs.readFileSync(DIR + '/web.log', 'utf8');
    const m = log.match(/http:\/\/127\.0\.0\.1:3080\/\?token=[A-Za-z0-9_-]+/g);
    if (m && m.length) return m[m.length - 1];
  } catch (e) {}
  return null;
}

http.createServer((req, res) => {
  if (req.url.startsWith('/healthz')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  const target = currentUrl();
  if (!target) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:20px sans-serif;padding:24px">DSH 还没有启动。<br>请在 Termux 里运行：<br><code>bash ~/start-dsh.sh</code></body>');
    return;
  }
  res.writeHead(302, { location: target, 'cache-control': 'no-store' });
  res.end();
}).listen(3081, '127.0.0.1', () => console.log('HOME LISTENING 3081'));
