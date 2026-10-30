/**
 * dsh-pad-kit — 在任何电脑上装这个插件，就能把 DSH 装到平板并远程管起来
 *
 * 一条链路：
 *   1) 插件自己生成一对 SSH 钥匙（没有就生成）
 *   2) 插件起局域网安装页，页面给出「复制一行命令」
 *   3) 平板 Termux 里粘那一行 → 自动装 openssh + 写入公钥 + 起 sshd + 向电脑报到
 *      → 再自动装 node/clang/dsh/原生绑定/补丁 → 起固定入口
 *   4) 插件收到报到（IP + 用户名）后，后续全部走 SSH 远程操作：查状态、重装、取网址
 *
 * 为什么用「平板主动报到」：Termux 的用户名是随机的 u0_aXXX，电脑没法猜；
 * 报到请求会带上 Host 头与来源 IP，插件据此自动补齐 host/user/port。
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const name = 'pad-kit';
export const inject = ['tools'];

// ---- 宿主版本自检：不支持插件机制的旧版 DSH 直接给结论，不必等装完才发现 ----
const MIN_HOST_VERSION = '0.1.7-rc.2';

function parseVersion(text) {
  const m = String(text ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i] ? 1 : -1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  const n = Math.max(x.pre.length, y.pre.length);
  for (let i = 0; i < n; i += 1) {
    const a1 = x.pre[i];
    const b1 = y.pre[i];
    if (a1 === undefined) return -1;
    if (b1 === undefined) return 1;
    const an = /^\d+$/.test(a1);
    const bn = /^\d+$/.test(b1);
    if (an && bn) { if (Number(a1) !== Number(b1)) return Number(a1) > Number(b1) ? 1 : -1; continue; }
    if (an !== bn) return an ? -1 : 1;
    if (a1 !== b1) return a1 > b1 ? 1 : -1;
  }
  return 0;
}

function readDshPackage(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        const json = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof json.name === 'string' && json.name.startsWith('@deepseek-ai/dsh')) {
          return { name: json.name, version: json.version, file };
        }
      } catch { /* 坏 json 直接忽略 */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function detectHost() {
  let found = null;
  if (process.env.DSH_VERSION) found = { version: process.env.DSH_VERSION, source: 'env' };
  const entries = [process.argv[1], process.argv[0]].filter(Boolean);
  for (const entry of entries) {
    for (const start of [path.dirname(entry), process.cwd()]) {
      const pkg = readDshPackage(start);
      if (pkg && pkg.version) { found = { version: pkg.version, source: pkg.file }; break; }
    }
    if (found) break;
  }
  if (!found) return { version: '', source: '', supported: true, detected: false, message: '' };
  const okVersion = compareVersions(found.version, MIN_HOST_VERSION) >= 0;
  return {
    version: found.version,
    source: found.source,
    supported: okVersion,
    detected: true,
    message: okVersion
      ? ''
      : `当前 DSH 版本不支持（检测到 ${found.version}，需要 ≥ ${MIN_HOST_VERSION}）。` +
        '\n这个插件依赖 DSH 的用户插件机制与工具注册契约，旧版本没有。' +
        '\n请先升级 DSH 并重启，再重新调用这些工具。',
  };
}

const HOST = detectHost();

function hostSummary() {
  return `宿主 DSH：${HOST.version || '未识别'}${HOST.supported ? '' : `（低于 ${MIN_HOST_VERSION}，不支持）`}`;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.dirname(HERE);
const KIT_DIR = path.join(PKG_ROOT, 'kit');
// 状态目录可用 DSH_TABLET_KIT_STATE 覆盖（自测时避免污染真实登记）
const STATE_DIR = process.env.DSH_TABLET_KIT_STATE || path.join(os.homedir(), '.dsh', 'tablet-kit');
const TABLETS_FILE = path.join(STATE_DIR, 'tablets.json');

const DEFAULT_CONFIG = {
  sshHost: '',
  sshPort: 8022,
  sshUser: '',
  keyPath: path.join(STATE_DIR, 'id_ed25519'),
  sshPath: process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh',
  scpPath: process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\scp.exe' : 'scp',
  sshKeygenPath: process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe' : 'ssh-keygen',
  httpPort: 8090,
  apkName: 'termux.apk',
  timeoutMs: 120000,
};

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      text: { type: 'string' },
      path: { type: 'string' },
    },
    required: ['ok', 'text'],
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }];
  },
};

function defineTool(def) {
  const parameters = def.parameters ?? {};
  const properties = {};
  const required = [];
  for (const [key, spec] of Object.entries(parameters)) {
    const { required: isRequired, ...rest } = spec;
    properties[key] = rest;
    if (isRequired) required.push(key);
  }
  return {
    name: def.name,
    description: def.description,
    parameters: { type: 'object', properties, additionalProperties: false, required },
    output: OUTPUT,
    execute(args) {
      if (!HOST.supported) return { ok: false, text: HOST.message };
      for (const key of required) {
        if (args?.[key] === undefined || args?.[key] === '') throw new Error(`${def.name}: 缺少必需参数 "${key}"`);
      }
      return def.execute(args ?? {});
    },
  };
}

let currentConfig = {};
function cfgOf(overrides = {}) {
  return { ...DEFAULT_CONFIG, ...currentConfig, ...overrides };
}

// ------------------------------------------------------------- 钥匙 & 平板登记
function ensureStateDir() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`创建状态目录失败 ${STATE_DIR}: ${error.message}`);
  }
}

function ensureKeyPair(cfg) {
  ensureStateDir();
  if (existsSync(cfg.keyPath)) {
    const pubPath = `${cfg.keyPath}.pub`;
    return { privateKey: cfg.keyPath, publicKey: existsSync(pubPath) ? readFileSync(pubPath, 'utf8').trim() : '' };
  }
  const result = spawnSync(
    cfg.sshKeygenPath,
    ['-t', 'ed25519', '-N', '', '-C', 'dsh-pad-kit', '-f', cfg.keyPath],
    { encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  if (!existsSync(cfg.keyPath)) {
    throw new Error(`生成 SSH 钥匙失败：${(result.stderr || result.error?.message || '').trim()}`);
  }
  const pubPath = `${cfg.keyPath}.pub`;
  return { privateKey: cfg.keyPath, publicKey: existsSync(pubPath) ? readFileSync(pubPath, 'utf8').trim() : '' };
}

function readTablets() {
  try {
    if (!existsSync(TABLETS_FILE)) return [];
    const raw = JSON.parse(readFileSync(TABLETS_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    return [];
  }
}

function recordTablet(entry) {
  ensureStateDir();
  const list = readTablets().filter((item) => !(item.host === entry.host && item.user === entry.user));
  list.unshift(entry);
  writeFileSync(TABLETS_FILE, JSON.stringify(list.slice(0, 20), null, 2), 'utf8');
  return list;
}

/** 目标解析优先级：调用参数 > 最近一次报到 > 配置默认 */
function resolveTarget(args = {}) {
  const cfg = cfgOf();
  if (args.host) {
    return {
      ...cfg,
      sshHost: args.host,
      sshUser: args.user || cfg.sshUser || readTablets()[0]?.user || '',
      sshPort: Number(args.port || cfg.sshPort),
    };
  }
  if (cfg.sshHost) {
    return { ...cfg, sshHost: cfg.sshHost, sshUser: cfg.sshUser || readTablets()[0]?.user || '', sshPort: Number(cfg.sshPort) };
  }
  const latest = readTablets()[0];
  if (!latest) return null;
  return { ...cfg, sshHost: latest.host, sshUser: latest.user, sshPort: Number(latest.port || 8022) };
}

// ---------------------------------------------------------------- SSH 通道
const TRANSIENT = /timed out during banner exchange|Connection reset by peer|client_loop: send disconnect|Connection timed out|kex_exchange_identification|Operation timed out/i;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function explain(stderr) {
  if (TRANSIENT.test(stderr)) return '平板上的 Termux 被系统冻结了（vivo/ColorOS 常见）。把 Termux 切到前台、屏幕别锁，再试一次。';
  if (/Permission denied \(publickey\)/.test(stderr)) return '公钥被拒：平板上 ~/.ssh/authorized_keys 里没有本插件这把钥匙，重跑一次安装命令即可。';
  if (/Connection refused/i.test(stderr)) return '平板 SSH 端口没监听：Termux 里执行 nohup sshd 或重跑安装命令。';
  if (/Could not resolve hostname|nodename nor servname/i.test(stderr)) return '主机名/IP 解析不了，检查平板与电脑是否同一 Wi-Fi。';
  return '';
}

function ssh(target, command, { retries = 3 } = {}) {
  if (!target?.sshHost) return { ok: false, stdout: '', stderr: 'MISSING_TARGET' };
  if (!target.sshUser) return { ok: false, stdout: '', stderr: 'MISSING_USER' };
  let stderr = '';
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = spawnSync(
      target.sshPath,
      [
        '-i', target.keyPath,
        '-p', String(target.sshPort),
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=NUL',
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        `${target.sshUser}@${target.sshHost}`,
        command,
      ],
      { encoding: 'utf8', timeout: target.timeoutMs, windowsHide: true },
    );
    stderr = result.stderr ?? '';
    if (result.status === 0) return { ok: true, stdout: result.stdout ?? '', stderr };
    if (!TRANSIENT.test(stderr)) break;
    if (attempt < retries) sleep(2000);
  }
  return { ok: false, stdout: '', stderr };
}

function scp(target, local, remote) {
  const result = spawnSync(
    target.scpPath,
    [
      '-i', target.keyPath,
      '-P', String(target.sshPort),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=NUL',
      local,
      `${target.sshUser}@${target.sshHost}:${remote}`,
    ],
    { encoding: 'utf8', timeout: target.timeoutMs, windowsHide: true },
  );
  return { ok: result.status === 0, stderr: result.stderr ?? '' };
}

// ------------------------------------------------------------ 局域网安装页
let lanServer = null;
let lastServerError = null;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

function bootstrapScript(baseUrl, publicKey, sshOnly = false) {
  const template = readFileSync(path.join(KIT_DIR, 'bootstrap.tmpl'), 'utf8');
  const skip = sshOnly
    ? 'echo "[dsh-kit] SSH 通道已就绪，回电脑执行 tablet_targets 即可登记"\nexit 0\n'
    : '';
  return template
    .replace('__BASE__', baseUrl)
    .replace('__PUBKEY__', publicKey)
    .replace('__SKIP_DSH__', skip);
}

function pageHtml(baseUrl) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 平板端安装</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:20px;background:#0f1115;color:#e8eaed;line-height:1.7;max-width:760px}
h1{font-size:22px;margin:0 0 4px}
.sub{color:#9aa0a6;font-size:13px;margin-bottom:18px}
.card{background:#1a1d23;border:1px solid #2a2f38;border-radius:12px;padding:16px;margin-bottom:14px}
.step{font-size:15px;font-weight:600;margin-bottom:8px}
code{display:block;background:#0b0d11;border:1px solid #2a2f38;border-radius:8px;padding:10px;font-size:13px;word-break:break-all;color:#8ab4f8;user-select:all;margin:6px 0}
a.btn{display:inline-block;background:#2b6cff;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600}
.tip{color:#9aa0a6;font-size:12.5px;margin-top:8px}
.q{font-size:13px;color:#f9ab00;font-weight:600;margin:22px 0 8px}
b{color:#e8eaed}
</style></head>
<body>
<h1>DSH 平板端安装</h1>
<div class="sub">先分岔：平板有没有 Termux？两条路装的是同一个东西。</div>

<div class="q">① 平板「没有」Termux</div>
<div class="card">
  <div class="step">1.1 下载并安装 Termux</div>
  <a class="btn" href="/termux.apk">下载 Termux APK（0.118.3）</a>
  <div class="tip">安装时允许「安装未知应用」。装完打开 Termux，再走下面 ② 的那一行命令。</div>
  <div class="tip">别用应用商店的旧版（0.101）：它会被系统冻结、pkg 也会崩。</div>
</div>

<div class="q">② 平板「已经有」Termux</div>
<div class="card">
  <div class="step">2.1 打开 Termux，粘这一行</div>
  <code>curl -fL ${baseUrl}/bootstrap.sh | bash</code>
  <div class="tip">脚本自己判断环境：架构 / Android 版本 / 空间 → 修 curl → 装 openssh → 起 sshd → <b>向电脑报到</b> → 装 DSH 本体（node / dsh / 原生绑定 / 两个安卓补丁 / 起服务）。</div>
  <div class="tip">约 1～3 分钟，期间<b>别锁屏</b>，Termux 保持前台。</div>
</div>

<div class="card">
  <div class="step">装完以后</div>
  <div class="tip">安装脚本最后会打印一个地址，用<b>平板自己的浏览器</b>打开就是 DSH 网页。以后重启平板，在 Termux 里跑 <code>bash ~/start-dsh.sh</code> 再打开同一个地址。</div>
</div>

<div class="card">
  <div class="step">想开机自动起来</div>
  <a class="btn" href="/termux-boot.apk">下载 Termux:Boot APK（0.8.1）</a>
  <div class="tip">装它之前/之后都行，安装脚本已经把开机脚本放在 <code>~/.termux/boot/start-dsh.sh</code>；只要装了 Termux:Boot，下次开机就会自己把 DSH 起好。</div>
  <div class="tip">装 Termux:Boot 后打开它一次（让它启动一次服务），之后再重启平板验证。</div>
</div>

<div class="card">
  <div class="step">电脑端：一行装好插件（可选）</div>
  <div class="tip">在<b>电脑</b>的 PowerShell 里跑这一行，自动下载插件包、放到 <code>~\.dsh\plugins</code>、登记好、写激活行：</div>
  <code>irm ${baseUrl}/install.ps1 | iex</code>
  <div class="tip">跑完重启一次 DSH，7 个 <code>tablet_*</code> 工具就出现在工具列表里。已经有压缩包的话，直接跑里面的 <code>install-windows.ps1</code> 效果一样。</div>
</div>

<div class="card">
  <div class="step">卡住了怎么办</div>
  <div class="tip">如果 Termux 报 <code>CANNOT LINK EXECUTABLE "curl"</code>，先跑下面这条（它不依赖 curl），再重跑 2.1：</div>
  <code>apt update &amp;&amp; apt full-upgrade -y -o Dpkg::Options::="--force-confnew"</code>
  <div class="tip">如果报 <code>E: Unable to locate package openssh</code>，脚本会自己切官方源重试；仍失败就手动跑：</div>
  <code>echo "deb https://packages.termux.dev/apt/termux-main stable main" &gt; $PREFIX/etc/apt/sources.list &amp;&amp; apt update</code>
</div>
</body></html>`;
}

function ensureLanServer(cfg) {
  if (lanServer) return lanServer;
  const { publicKey } = ensureKeyPair(cfg);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const host = req.headers.host ?? `127.0.0.1:${cfg.httpPort}`;
    const baseUrl = `http://${host}`;

    const sendFile = (file, type) => {
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': type, 'content-length': String(statSync(file).size) });
      createReadStream(file).pipe(res);
    };

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = pageHtml(baseUrl);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (url.pathname === '/bootstrap.sh' || url.pathname === '/install.sh') {
      const body = bootstrapScript(baseUrl, publicKey, url.searchParams.get('sshonly') === '1');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (url.pathname === '/register') {
      const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      const user = url.searchParams.get('user') ?? '';
      const port = Number(url.searchParams.get('port') ?? 8022) || 8022;
      const entry = { host: remote, user, port, at: new Date().toISOString() };
      try {
        recordTablet(entry);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`OK ${user}@${remote}:${port}\n`);
      } catch (error) {
        res.writeHead(500);
        res.end(`register failed: ${error.message}`);
      }
      return;
    }
    if (url.pathname === '/kit.tgz') return sendFile(path.join(PKG_ROOT, 'dsh-android-kit.tgz'), 'application/gzip');
    if (url.pathname === '/termux.apk') return sendFile(path.join(KIT_DIR, cfg.apkName), 'application/vnd.android.package-archive');
    if (url.pathname === '/termux-boot.apk') return sendFile(path.join(KIT_DIR, 'termux-boot.apk'), 'application/vnd.android.package-archive');
    if (url.pathname === '/install.ps1') {
      const body = renderInstallScript(baseUrl);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (url.pathname === '/plugin.zip') {
      const zip = path.join(PKG_ROOT, 'dist', 'dsh-pad-kit.zip');
      if (existsSync(zip)) return sendFile(zip, 'application/zip');
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('这里没有 plugin.zip；请在电脑上运行 dist 目录里的 install-windows.ps1');
      return;
    }
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  server.on('error', (error) => {
    lastServerError = error;
  });
  server.listen(cfg.httpPort, '0.0.0.0');
  lanServer = { server, port: cfg.httpPort, publicKey };
  return lanServer;
}

function missingTargetText() {
  return [
    '还没认到平板。先做这一步：',
    '  tablet_install_page  → 拿到安装页地址',
    '  平板浏览器打开该地址 → 装 Termux → 在 Termux 里粘页面给的那一行命令',
    '那一行命令末尾会让平板向本机报到，之后这些工具才能远程操作它。',
  ].join('\n');
}

// ------------------------------------------------------------------- tools
const tools = [
  defineTool({
    name: 'tablet_install_page',
    description: '起局域网安装页（平板扫码/打开即可装 Termux 并一键安装 DSH + SSH 免密），返回地址与一行命令。',
    parameters: {},
    async execute() {
      const cfg = cfgOf();
      const { port } = ensureLanServer(cfg);
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (lastServerError) {
        const hint =
          lastServerError.code === 'EADDRINUSE'
            ? `端口 ${port} 已被占用。改配置 httpPort（例如 8091）再试，或先关掉占用该端口的程序。`
            : `安装页启动失败：${lastServerError.code || ''} ${lastServerError.message}`;
        return { ok: false, text: hint };
      }
      const addrs = lanAddresses();
      if (addrs.length === 0) return { ok: false, text: '本机没有局域网 IPv4 地址，平板无法访问。' };
      const urls = addrs.map((ip) => `http://${ip}:${port}/`);
      return {
        ok: true,
        text: [
          '安装页已启动（防火墙需放行一次）：',
          ...urls.map((line) => '  ' + line),
          '',
          '平板步骤：打开上面地址 → 下载并安装 Termux → 打开 Termux 粘这一行：',
          `  curl -fL ${urls[0]}bootstrap.sh | bash`,
          '',
          '这条命令会：装 openssh 免密 → 向本机报到 → 装 node/clang/dsh → 编译原生绑定 → 打补丁 → 起固定入口 `http://127.0.0.1:3081/`',
          '装完可运行 tablet_targets 看是否已认到平板，再用 tablet_kit_url 取地址。',
        ].join('\n'),
      };
    },
  }),

  defineTool({
    name: 'tablet_bootstrap',
    description: '只做「让电脑能远程登录平板」这件事：返回要粘进 Termux 的 SSH 配置命令与公钥（适用于已装 Termux 但没开 SSH 的平板）。',
    parameters: {},
    async execute() {
      const cfg = cfgOf();
      const { publicKey } = ensureKeyPair(cfg);
      const addrs = lanAddresses();
      const base = addrs.length ? `http://${addrs[0]}:${cfg.httpPort}` : 'http://<电脑IP>:8090';
      return {
        ok: true,
        path: `${cfg.keyPath}.pub`,
        text: [
          '在平板 Termux 里粘这一行（只建 SSH 通道，不装 DSH）：',
          '',
          `  curl -fsSL "${base}/bootstrap.sh?sshonly=1" | bash`,
          '',
          '或者手动执行这三条：',
          '  pkg install -y openssh && mkdir -p ~/.ssh && chmod 700 ~/.ssh',
          `  echo "${publicKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`,
          '  ssh-keygen -A && pkill sshd; nohup sshd >/dev/null 2>&1; echo "user=$(whoami) port=8022"',
          '',
          '执行完把最后打印的 user 和 IP 告诉 tablet_targets，或直接重跑完整安装命令让它自动报到。',
        ].join('\n'),
      };
    },
  }),

  defineTool({
    name: 'tablet_targets',
    description: '列出已经向本机报到过的平板（IP/用户名/端口/时间），可手动登记一台：tablet_targets(host, user, port)。',
    parameters: {
      host: { type: 'string', description: '手动登记：平板 IP' },
      user: { type: 'string', description: '手动登记：Termux 用户名（如 u0_a303）' },
      port: { type: 'number', description: '手动登记：SSH 端口，默认 8022' },
    },
    async execute(args) {
      if (args.host && args.user) {
        const list = recordTablet({ host: args.host, user: args.user, port: Number(args.port || 8022), at: new Date().toISOString() });
        return { ok: true, text: `已登记，共 ${list.length} 台：\n` + list.map((t) => `  ${t.user}@${t.host}:${t.port}`).join('\n') };
      }
      const list = readTablets();
      if (list.length === 0) return { ok: false, text: missingTargetText() };
      return {
        ok: true,
        text: list.map((t, i) => `${i === 0 ? '*' : ' '} ${t.user}@${t.host}:${t.port}   报到时间 ${t.at}`).join('\n'),
      };
    },
  }),

  defineTool({
    name: 'tablet_kit_status',
    description: '通过 SSH 检查平板上的 DSH 状态：node/dsh 版本、原生绑定、两个补丁、3080/3081 服务。',
    parameters: {
      host: { type: 'string', description: '平板 IP，省略用最近报到的平板' },
      user: { type: 'string', description: 'Termux 用户名，省略自动用报到的用户名' },
      port: { type: 'number', description: 'SSH 端口，默认 8022' },
    },
    async execute(args) {
      const target = resolveTarget(args);
      if (!target) return { ok: false, text: missingTargetText() };
      const cmd = [
        'echo NODE=$(node -v 2>/dev/null)',
        'echo NPM=$(npm -v 2>/dev/null)',
        'echo DSH=$(dsh --version 2>/dev/null || echo none)',
        'PKG=$(npm root -g 2>/dev/null)',
        'echo BINDING=$(ls "$PKG/@deepseek-ai/dsh/node_modules/node-addon-require-builtin-android-arm64/prebuilt/android-arm64-napi-v9.node" 2>/dev/null || echo none)',
        'grep -q PATCHED-ANDROID-FLOCK "$PKG/@deepseek-ai/dsh/node_modules/@deepseek-ai/node-addon-system/lib/flock.js" 2>/dev/null && echo FLOCK=patched || echo FLOCK=no',
        'grep -q "COPYFILE_EXCL" "$PKG/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js" 2>/dev/null && echo LINK=patched || echo LINK=no',
        'echo HOME_3081=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:3081/ 2>/dev/null)',
        'echo WEB_3080=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:3080/ 2>/dev/null)',
        'echo URL=$(cat ~/dshpad/url.txt 2>/dev/null)',
      ].join('; ');
      const result = ssh(target, cmd);
      if (!result.ok) {
        return { ok: false, text: `连不上 ${target.sshUser}@${target.sshHost}:${target.sshPort}：${explain(result.stderr) || result.stderr.trim() || '未知错误'}` };
      }
      return { ok: true, text: hostSummary() + "\n" + `${target.sshUser}@${target.sshHost}:${target.sshPort}\n` + result.stdout.trim() };
    },
  }),

  defineTool({
    name: 'tablet_kit_setup',
    description: '通过 SSH 把安装包推到平板并执行 setup.sh（幂等：已装的跳过，只重启服务），返回固定网址。',
    parameters: {
      host: { type: 'string', description: '平板 IP，省略用最近报到的平板' },
      user: { type: 'string', description: 'Termux 用户名，省略自动用报到的用户名' },
      port: { type: 'number', description: 'SSH 端口，默认 8022' },
    },
    async execute(args) {
      const target = resolveTarget(args);
      if (!target) return { ok: false, text: missingTargetText() };
      const archive = path.join(PKG_ROOT, 'dsh-android-kit.tgz');
      if (!existsSync(archive)) return { ok: false, text: `缺少安装包：${archive}` };
      const pushed = scp(target, archive, '~/dsh-android-kit.tgz');
      if (!pushed.ok) {
        return { ok: false, text: `推包失败：${explain(pushed.stderr) || pushed.stderr.trim()}` };
      }
      const cmd = 'cd ~ && rm -rf dsh-android-kit && tar -xzf dsh-android-kit.tgz && bash dsh-android-kit/setup.sh 2>&1 | tail -n 40';
      const result = ssh({ ...target, timeoutMs: 900000 }, cmd, { retries: 2 });
      if (!result.ok) {
        return { ok: false, text: `安装脚本失败：${explain(result.stderr) || '见输出'}\n${result.stdout}\n${result.stderr}` };
      }
      return { ok: true, text: result.stdout.trim() };
    },
  }),

  defineTool({
    name: 'tablet_kit_url',
    description: '读取平板当前的 DSH 入口地址（固定入口 3081 + 本次 token 直连地址）。',
    parameters: {
      host: { type: 'string', description: '平板 IP，省略用最近报到的平板' },
      user: { type: 'string', description: 'Termux 用户名，省略自动用报到的用户名' },
      port: { type: 'number', description: 'SSH 端口，默认 8022' },
    },
    async execute(args) {
      const target = resolveTarget(args);
      if (!target) return { ok: false, text: missingTargetText() };
      const result = ssh(target, 'cat ~/dshpad/url.txt 2>/dev/null; echo; curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:3081/ 2>/dev/null', { retries: 2 });
      if (!result.ok) return { ok: false, text: `连不上 ${target.sshUser}@${target.sshHost}：${explain(result.stderr) || result.stderr.trim()}` };
      const lines = result.stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean);
      const urlLine = lines.find((line) => line.startsWith('http')) ?? '';
      const code = lines.filter((line) => /^\d{3}$/.test(line)).pop() ?? '?';
      return {
        ok: true,
        text: [
          `平板：${target.sshUser}@${target.sshHost}`,
          `固定入口：http://127.0.0.1:3081/  （当前返回 ${code}）`,
          urlLine ? `token 直连：${urlLine}` : 'token 直连：未取到（服务可能没起，跑 tablet_kit_setup 或平板上 bash ~/start-dsh.sh）',
        ].join('\n'),
      };
    },
  }),

  defineTool({
    name: 'tablet_kit_apk',
    description: '返回 Termux APK 的局域网下载地址与本地路径（平板上点一下即可安装）。',
    parameters: {},
    async execute() {
      const cfg = cfgOf();
      const apk = path.join(KIT_DIR, cfg.apkName);
      if (!existsSync(apk)) return { ok: false, text: `缺少 Termux APK：${apk}` };
      const { port } = ensureLanServer(cfg);
      const addrs = lanAddresses();
      const url = addrs.length ? `http://${addrs[0]}:${port}/termux.apk` : '（本机没有局域网地址）';
      return { ok: true, path: apk, text: `Termux APK：${apk}\n下载地址：${url}\n大小：${(statSync(apk).size / 1048576).toFixed(1)} MB` };
    },
  }),
];

export function apply(ctx, config = {}) {
  currentConfig = config ?? {};
  for (const tool of tools) ctx.tools.register(tool);
}



// ---- 供独立安装页复用同一份渲染逻辑（installer-page.js 会 import 这几个）----
export function renderPage(baseUrl) { return pageHtml(baseUrl); }
export function renderBootstrap(baseUrl, publicKey, sshOnly = false) { return bootstrapScript(baseUrl, publicKey, sshOnly); }

/**
 * 电脑端「一条命令安装」脚本：下载本机的 plugin.zip → 解压 → 跑里面的 install-windows.ps1。
 * 用法（Windows PowerShell）：irm http://<电脑IP>:8090/install.ps1 | iex
 */
export function renderInstallScript(baseUrl) {
  const base = String(baseUrl).replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$base = '${base}'`,
    'Write-Host "==> 从 $base 安装 dsh-pad-kit" -ForegroundColor Cyan',
    "$tmp = Join-Path $env:TEMP ('dsh-pad-kit-' + [guid]::NewGuid().ToString('N').Substring(0,8))",
    'New-Item -ItemType Directory -Path $tmp -Force | Out-Null',
    "$zip = Join-Path $tmp 'dsh-pad-kit.zip'",
    "Write-Host '    下载插件包…'",
    'Invoke-WebRequest "$base/plugin.zip" -OutFile $zip -UseBasicParsing',
    "Write-Host ('    已下载 ' + [math]::Round((Get-Item $zip).Length/1MB,2) + ' MB')",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp)',
    "$installer = Get-ChildItem -Path $tmp -Recurse -Filter 'install-windows.ps1' | Select-Object -First 1",
    "if (-not $installer) { throw '压缩包里找不到 install-windows.ps1' }",
    'Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force',
    '& $installer.FullName',
    '',
    "Write-Host ''",
    "Write-Host '重启 DSH 后，7 个 tablet_* 工具就会出现。' -ForegroundColor Yellow",
  ].join('\r\n');
}