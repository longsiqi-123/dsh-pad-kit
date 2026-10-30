#!/data/data/com.termux/files/usr/bin/node
/*
 * Android 兼容补丁 2/2：硬链接
 *
 * Android 的 /data 分区禁止 hardlink()（实测：ln 返回 Permission denied），
 * 而 DSH 的会话持久化用 link() 做原子发布。这里把 link() 包成
 * 「先试 link，遇到 EACCES/EPERM/ENOSYS/ENOTSUP/EOPNOTSUPP 就退化成 copyFile(...,1)」，
 * 1 = COPYFILE_EXCL，保持原来「目标已存在就 EEXIST」的语义。
 *
 * 幂等：已打过就跳过。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const MARK = 'COPYFILE_EXCL: Android forbids hard links';
const REL = 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib';

function dshRoot() {
  const cands = [];
  if (process.env.PREFIX) cands.push(path.join(process.env.PREFIX, 'lib/node_modules/@deepseek-ai/dsh'));
  try {
    const root = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (root) cands.push(path.join(root, '@deepseek-ai/dsh'));
  } catch (e) { /* 忽略，用下面的候选 */ }
  cands.push('/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh');
  for (const candidate of cands) {
    if (candidate && fs.existsSync(path.join(candidate, REL))) return candidate;
  }
  return null;
}

function fallback(ind, srcExpr, dstExpr, copyExpr) {
  const t = ind + '\t';
  const codes = ['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'];
  const cond = codes.map((c) => '__dshCode !== "' + c + '"').join(' && ');
  return [
    ind + 'try {',
    t + 'await internals.fs.link(' + srcExpr + ', ' + dstExpr + ');',
    ind + '} catch (__dshLinkError) {',
    t + 'const __dshCode = __dshLinkError && __dshLinkError.code;',
    t + 'if (' + cond + ') throw __dshLinkError;',
    t + 'await ' + copyExpr + '(' + srcExpr + ', ' + dstExpr + ', 1); // ' + MARK,
    ind + '}',
  ].join('\n');
}

const root = dshRoot();
if (!root) {
  console.error('[patch-link] 找不到 dsh-session-persistence-jsonl，先装好 @deepseek-ai/dsh');
  process.exit(1);
}
const BASE = path.join(root, REL);
const IDX = path.join(BASE, 'index.js');
const WRK = path.join(BASE, 'worker.cjs');

let failed = false;
const report = [];

// ---- index.js ----
try {
  let src = fs.readFileSync(IDX, 'utf8');
  if (src.includes(MARK)) {
    report.push('index.js 已打过补丁，跳过');
  } else {
    const notes = [];
    if (src.includes('import { link, lstat,')) {
      src = src.replace('import { link, lstat,', 'import { copyFile, link, lstat,');
      notes.push('补上 copyFile 导入');
    } else if (src.includes('import { copyFile, link, lstat,')) {
      notes.push('copyFile 导入已存在');
    } else {
      throw new Error('找不到 import { link, lstat, 锚点');
    }

    const site1 = /^([ \t]*)await internals\.fs\.link\(staged, currentPath\);$/m;
    if (site1.test(src)) {
      src = src.replace(site1, (m, ind) => fallback(ind, 'staged', 'currentPath', 'copyFile'));
      notes.push('publishCurrentExclusive 已打补丁');
    }

    const site2 = /^([ \t]*)await link\(tmp, finalPath\);$/m;
    if (site2.test(src)) {
      src = src.replace(site2, (m, ind) => {
        const t = ind + '\t';
        const codes = ['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'];
        const cond = codes.map((c) => '__dshCode !== "' + c + '"').join(' && ');
        return [
          ind + 'try {',
          t + 'await link(tmp, finalPath);',
          ind + '} catch (__dshLinkError) {',
          t + 'const __dshCode = __dshLinkError && __dshLinkError.code;',
          t + 'if (' + cond + ') throw __dshLinkError;',
          t + 'await copyFile(tmp, finalPath, 1); // ' + MARK,
          ind + '}',
        ].join('\n');
      });
      notes.push('materializePosix 已打补丁');
    }

    if (notes.length === 0) throw new Error('两处 link 锚点都没找到');
    fs.writeFileSync(IDX, src, 'utf8');
    report.push('index.js：' + notes.join('，') + '（' + Buffer.byteLength(src) + ' 字节）');
  }
} catch (e) {
  report.push('index.js 失败：' + e.message);
  failed = true;
}

// ---- worker.cjs（可能不存在）----
try {
  if (!fs.existsSync(WRK)) {
    report.push('worker.cjs 不存在，跳过');
  } else {
    let src = fs.readFileSync(WRK, 'utf8');
    if (src.includes(MARK)) {
      report.push('worker.cjs 已打过补丁，跳过');
    } else {
      const site1 = /^([ \t]*)await internals\.fs\.link\(staged, currentPath\);$/m;
      if (!site1.test(src)) throw new Error('找不到 link(staged, currentPath) 锚点');
      src = src.replace(site1, (m, ind) => fallback(ind, 'staged', 'currentPath', 'node_fs_promises.copyFile'));
      fs.writeFileSync(WRK, src, 'utf8');
      report.push('worker.cjs 已打补丁（' + Buffer.byteLength(src) + ' 字节）');
    }
  }
} catch (e) {
  report.push('worker.cjs 失败：' + e.message);
  failed = true;
}

for (const line of report) console.log('[patch-link] ' + line);
process.exit(failed ? 1 : 0);
