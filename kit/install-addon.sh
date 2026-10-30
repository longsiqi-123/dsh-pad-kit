#!/data/data/com.termux/files/usr/bin/bash
# 把编译好的 require_builtin.node 安装成 node-addon-require-builtin-android-arm64 可选包
# 用法：install-addon.sh <require_builtin.node 路径> <目标目录>
set -eu
BIN="${1:?需要 require_builtin.node 路径}"
TARGET="${2:?需要目标目录}"

[ -f "$BIN" ] || { echo "找不到 $BIN"; exit 1; }

rm -rf "$TARGET"
mkdir -p "$TARGET/prebuilt"
cp "$BIN" "$TARGET/prebuilt/android-arm64-napi-v9.node"
chmod 755 "$TARGET/prebuilt/android-arm64-napi-v9.node"

cat > "$TARGET/package.json" <<'EOF'
{
  "name": "node-addon-require-builtin-android-arm64",
  "version": "0.1.9",
  "description": "Locally built android-arm64 native addon package for node-addon-require-builtin.",
  "main": "./index.js",
  "os": ["android"],
  "cpu": ["arm64"],
  "engines": { "node": ">=20" },
  "files": ["index.js", "prebuilds.json", "prebuilt/"],
  "dependencies": { "node-addon-native-custom-loader": "*" },
  "license": "MIT"
}
EOF

cat > "$TARGET/prebuilds.json" <<'EOF'
{
  "platform": "android-arm64",
  "binaries": [
    {
      "backend": "napi",
      "abi": "napi-v9",
      "binaryTag": "napi-v9",
      "node": ">=20",
      "path": "prebuilt/android-arm64-napi-v9.node"
    }
  ]
}
EOF

cat > "$TARGET/index.js" <<'EOF'
'use strict';
const { loadPrebuild } = require('node-addon-native-custom-loader');
module.exports = loadPrebuild(__dirname);
EOF

echo "[install-addon] 已安装到 $TARGET"
node -e "
const addon = require(process.argv[1]);
console.log('[install-addon] requireBuiltin=' + typeof addon.requireBuiltin);
console.log('[install-addon] info=' + JSON.stringify(addon.getNativeBindingInfo()));
" "$TARGET" 2>&1 || true
