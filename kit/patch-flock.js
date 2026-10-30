#!/data/data/com.termux/files/usr/bin/node
/*
 * Android 兼容补丁 1/2：flock
 *
 * 官方 @deepseek-ai/node-addon-system 没有发布 android-arm64 的编译产物，
 * 源码里写死 platform !== 'linux' && platform !== 'darwin' 就抛错。
 * 这里把 Android 视为支持平台，并把锁降级为无操作（单实例本地运行不需要跨进程锁）。
 *
 * 幂等：已打过就跳过。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const MARK = 'PATCHED-ANDROID-FLOCK';

function dshRoot() {
  const cands = [];
  if (process.env.PREFIX) cands.push(path.join(process.env.PREFIX, 'lib/node_modules/@deepseek-ai/dsh'));
  try {
    const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (root) cands.push(path.join(root, '@deepseek-ai/dsh'));
  } catch (e) { /* npm 不可用就靠下面的候选 */ }
  cands.push('/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh');
  for (const candidate of cands) {
    if (candidate && fs.existsSync(path.join(candidate, 'node_modules/@deepseek-ai/node-addon-system'))) return candidate;
  }
  return null;
}

const root = dshRoot();
if (!root) {
  console.error('[patch-flock] 找不到 dsh 安装目录');
  process.exit(1);
}

const file = path.join(root, 'node_modules/@deepseek-ai/node-addon-system/lib/flock.js');
if (!fs.existsSync(file)) {
  console.error('[patch-flock] 找不到 ' + file);
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');
if (src.includes(MARK)) {
  console.log('[patch-flock] 已打过补丁，跳过');
  process.exit(0);
}

const anchorGuard = "if (platform !== 'linux' && platform !== 'darwin') {";
const anchorLock = 'export async function tryLockExclusive(fd) {';

if (!src.includes(anchorGuard) || !src.includes(anchorLock)) {
  console.error('[patch-flock] 代码结构变了，找不到锚点，请手动检查 ' + file);
  process.exit(1);
}

src = src.replace(anchorGuard, "if (platform !== 'linux' && platform !== 'darwin' && platform !== 'android') {");

const lockHead = anchorLock + '\n    const errno = await new Promise((resolve) => {';
if (src.includes(lockHead)) {
  src = src.replace(
    lockHead,
    anchorLock + '\n'
      + '    // ' + MARK + ': Android 没有官方 flock 原生绑定，单实例本地运行下退化为无锁。\n'
      + "    if (process.platform === 'android')\n        return;\n"
      + '    const errno = await new Promise((resolve) => {',
  );
} else {
  console.error('[patch-flock] tryLockExclusive 结构不匹配，请手动检查');
  process.exit(1);
}

fs.writeFileSync(file, src, 'utf8');
console.log('[patch-flock] 已打补丁：' + file + ' (' + Buffer.byteLength(src) + ' bytes)');
