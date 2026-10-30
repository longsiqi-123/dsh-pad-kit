#!/usr/bin/env bash
# dsh-pad-kit 电脑端安装器（macOS / Linux）
# 用法：
#   bash install-unix.sh
#   DSH_HOME=~/.dsh PROFILE=web bash install-unix.sh
# 作用：放插件 → 建软链 → 在 profile 登记依赖 → 追加激活行。幂等。
set -euo pipefail

PKG_NAME='@local/dsh-pad-kit'
PLUGIN_DIR_NAME='dsh-pad-kit'
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
TARGET="$DSH_HOME/plugins/$PLUGIN_DIR_NAME"

say() { printf '%s\n' "$*"; }
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }

say "==> 1/5 检查来源目录"
for f in package.json cordis.patch.yml lib/plugin.js dsh-android-kit.tgz kit/termux.apk; do
  [ -f "$SRC/$f" ] || fail "来源里缺少 $f（请在解压后的 $PLUGIN_DIR_NAME 目录里运行本脚本）"
done
say "    来源 OK：$SRC"

say "==> 2/5 安装到 $TARGET"
mkdir -p "$DSH_HOME/plugins"
if [ -d "$TARGET" ]; then
  for f in package.json cordis.patch.yml dsh-android-kit.tgz; do cp -f "$SRC/$f" "$TARGET/$f"; done
  mkdir -p "$TARGET/lib" "$TARGET/kit"
  cp -f "$SRC/lib/"*.js "$TARGET/lib/" 2>/dev/null || true
  cp -f "$SRC/kit/"* "$TARGET/kit/" 2>/dev/null || true
  say "    已存在，已就地更新关键文件"
else
  cp -R "$SRC" "$TARGET"
  say "    已复制"
fi

say "==> 3/5 建软链（让 node 能按包名解析）"
[ -d "$PROFILE_DIR" ] || fail "找不到 profile 目录：$PROFILE_DIR（DSH 至少启动过一次吗？）"
mkdir -p "$PROFILE_DIR/node_modules/@local"
rm -f "$PROFILE_DIR/node_modules/@local/$PLUGIN_DIR_NAME"
ln -s "$TARGET" "$PROFILE_DIR/node_modules/@local/$PLUGIN_DIR_NAME"
say "    OK：$PROFILE_DIR/node_modules/@local/$PLUGIN_DIR_NAME"

say "==> 4/5 在 profile package.json 里登记依赖"
PKG_FILE="$PROFILE_DIR/package.json"
[ -f "$PKG_FILE" ] || fail "找不到 $PKG_FILE"
cp -f "$PKG_FILE" "$PKG_FILE.bak-pad-kit"
node -e '
const fs = require("fs");
const [file, name, value] = process.argv.slice(1);
const json = JSON.parse(fs.readFileSync(file, "utf8"));
json.dependencies = json.dependencies || {};
json.dependencies[name] = value;
fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
' "$PKG_FILE" "$PKG_NAME" "link:$TARGET"
say "    OK（备份：$PKG_FILE.bak-pad-kit）"

say "==> 5/5 在 cordis.patch.yml 追加激活行"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
[ -f "$PATCH_FILE" ] || fail "找不到 $PATCH_FILE"
cp -f "$PATCH_FILE" "$PATCH_FILE.bak-pad-kit"
if grep -qE '^[[:space:]]*-[[:space:]]*id:[[:space:]]*pad-kit[[:space:]]*$' "$PATCH_FILE"; then
  say "    已存在 pad-kit 行，跳过"
else
  cat >> "$PATCH_FILE" <<EOF

# dsh-pad-kit：平板上跑 DSH + 电脑 SSH 远程管理
- insert:
    - id: pad-kit
      name: '$PKG_NAME'
      config:
        httpPort: 8090
        apkName: termux.apk
        timeoutMs: 120000
EOF
  say "    已追加"
fi

say ""
say "完成。还有两步是必须人工做的："
say "  1) 重启 DSH（新增插件行不会热加载），重启后会出现 17 个 tablet_* 工具"
say "  2) 首次装平板时，防火墙放行一次 TCP 8090"
say ""
say "下一步：在 DSH 里调用 tablet_install_page，按返回的地址在平板上操作。"
