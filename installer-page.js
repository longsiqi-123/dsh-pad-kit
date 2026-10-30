// 独立版局域网安装页 —— 与插件 dsh-pad-kit 共用同一份渲染逻辑，避免两处漂移
// 用途：插件还没被 DSH 加载时，先把平板装起来；装完平板会向本机报到。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const PD = process.env.DSH_PAD_KIT_DIR || 'C:\\Users\\Administrator\\.dsh\\plugins\\dsh-pad-kit';
const PLUGIN_JS = path.join(PD, 'lib', 'plugin.js');
const KIT_DIR = path.join(PD, 'kit');
const TGZ = path.join(PD, 'dsh-android-kit.tgz');
const STATE = path.join(os.homedir(), '.dsh', 'tablet-kit');
const PUB = path.join(STATE, 'id_ed25519.pub');
const TABLETS = path.join(STATE, 'tablets.json');
const PORT = Number(process.env.DSH_PAD_KIT_PORT || 8090);
const DIST_ZIP = process.env.DSH_PAD_KIT_ZIP || 'E:\\dsh workspace\\winlator\\dist\\dsh-pad-kit.zip';

function pubkey() {
  try {
    return fs.readFileSync(PUB, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

function record(entry) {
  let list = [];
  try {
    const raw = JSON.parse(fs.readFileSync(TABLETS, 'utf8'));
    list = Array.isArray(raw) ? raw : [];
  } catch (e) {
    list = [];
  }
  list = list.filter((t) => !(t.host === entry.host && t.user === entry.user));
  list.unshift(entry);
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(TABLETS, JSON.stringify(list.slice(0, 20), null, 2), 'utf8');
}

function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) if (it.family === 'IPv4' && !it.internal) out.push(it.address);
  }
  return out;
}

function sendFile(res, file, type) {
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': type, 'content-length': String(fs.statSync(file).size) });
  fs.createReadStream(file).pipe(res);
}

(async () => {
  if (!fs.existsSync(PLUGIN_JS)) {
    console.error('plugin.js not found: ' + PLUGIN_JS);
    process.exit(1);
  }
  const mod = await import(pathToFileURL(PLUGIN_JS).href);
  const renderPage = mod.renderPage;
  const renderBootstrap = mod.renderBootstrap;
  const renderInstallScript = mod.renderInstallScript;
  if (typeof renderPage !== 'function' || typeof renderBootstrap !== 'function') {
    console.error('plugin.js 没导出 renderPage / renderBootstrap');
    process.exit(1);
  }

  http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const base = 'http://' + (req.headers.host || '127.0.0.1:' + PORT);

    if (u.pathname === '/') {
      const b = renderPage(base);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(b) });
      res.end(b);
      return;
    }
    if (u.pathname === '/bootstrap.sh' || u.pathname === '/install.sh') {
      const b = renderBootstrap(base, pubkey(), u.searchParams.get('sshonly') === '1');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(b) });
      res.end(b);
      return;
    }
    if (u.pathname === '/register') {
      const host = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const user = u.searchParams.get('user') || '';
      const port = Number(u.searchParams.get('port') || 8022) || 8022;
      record({ host, user, port, at: new Date().toISOString() });
      console.log('REGISTER ' + user + '@' + host + ':' + port);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('OK ' + user + '@' + host + ':' + port + '\n');
      return;
    }
    if (u.pathname === '/kit.tgz') return sendFile(res, TGZ, 'application/gzip');
    if (u.pathname === '/termux.apk') return sendFile(res, path.join(KIT_DIR, 'termux.apk'), 'application/vnd.android.package-archive');
    if (u.pathname === '/termux-boot.apk') return sendFile(res, path.join(KIT_DIR, 'termux-boot.apk'), 'application/vnd.android.package-archive');
    if (u.pathname === '/plugin.zip') return sendFile(res, DIST_ZIP, 'application/zip');
    if (u.pathname === '/install.ps1') {
      const body = renderInstallScript(base);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (u.pathname === '/healthz') { res.writeHead(200); res.end('ok'); return; }
    res.writeHead(404); res.end('not found');
  }).listen(PORT, '0.0.0.0', () => {
    for (const ip of lanAddrs()) console.log('PAGE http://' + ip + ':' + PORT + '/');
    console.log('READY pubkey=' + (pubkey() ? 'yes' : 'MISSING') + ' kit=' + (fs.existsSync(TGZ) ? fs.statSync(TGZ).size : 'MISSING') + ' apk=' + (fs.existsSync(path.join(KIT_DIR, 'termux.apk')) ? fs.statSync(path.join(KIT_DIR, 'termux.apk')).size : 'MISSING'));
  });
})().catch((e) => {
  console.error('FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
