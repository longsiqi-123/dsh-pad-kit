// 验证宿主版本自检：旧版本 → 工具直接返回「当前 DSH 版本不支持」；新版本 → 正常执行。
// 用法：node guard-test.mjs <plugin.js 绝对路径>
const file = process.argv[2];
if (!file) {
  console.error('需要插件路径');
  process.exit(2);
}

async function load(version) {
  if (version) process.env.DSH_VERSION = version;
  else delete process.env.DSH_VERSION;
  // 每次用不同的查询串强制重新加载模块
  const url = 'file:///' + file.replace(/\\/g, '/') + '?v=' + encodeURIComponent(version ?? 'none');
  const mod = await import(url);
  const registry = new Map();
  mod.apply({ tools: { register: (t) => registry.set(t.name, t) } }, {});
  return { mod, registry };
}

const cases = [
  { label: '旧版本 0.1.6', version: '0.1.6', expectBlocked: true },
  { label: '同版本 0.1.7-rc.2', version: '0.1.7-rc.2', expectBlocked: false },
  { label: '新版 0.1.7-rc.10', version: '0.1.7-rc.10', expectBlocked: false },
  { label: '正式版 0.2.0', version: '0.2.0', expectBlocked: false },
  { label: '极老 0.0.9', version: '0.0.9', expectBlocked: true },
];

let failed = 0;
for (const c of cases) {
  const { registry } = await load(c.version);
  const tool = registry.get('tablet_targets');
  if (!tool) {
    console.log(`FAIL ${c.label}: 没有注册 tablet_targets`);
    failed += 1;
    continue;
  }
  const res = await tool.execute({});
  const blocked = res.ok === false && /当前 DSH 版本不支持/.test(res.text || '');
  const pass = blocked === c.expectBlocked;
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c.label}: blocked=${blocked} first="${String(res.text).split('\n')[0]}"`);
}

// 未识别版本（没有 DSH_VERSION、也找不到 package.json）时应放行
{
  delete process.env.DSH_VERSION;
  const { registry } = await load('');
  const res = await registry.get('tablet_targets').execute({});
  const blocked = /当前 DSH 版本不支持/.test(res.text || '');
  const pass = blocked === false;
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} 未识别版本: blocked=${blocked}`);
}

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
