#!/data/data/com.termux/files/usr/bin/bash
# ---------------------------------------------------------------------------
# DSH Android (Termux) 一键安装器
#   在平板的 Termux 里执行：bash setup.sh
#   作用：装 node → 装 dsh → 编译 android-arm64 原生绑定 → 打 3 个补丁
#        → 起服务（3080）+ 固定入口（3081）→ 打印可打开的网址
# ---------------------------------------------------------------------------
set -u
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"

LOGDIR="$HOME_DIR/.dsh-kit/logs"
mkdir -p "$LOGDIR" 2>/dev/null

log() { printf '\n[kit] %s\n' "$*"; }
warn() { printf '[kit] ! %s\n' "$*"; }
fail() { printf '\n[kit] 失败：%s\n' "$*"; exit 1; }

log "DSH Android 安装器"
log "kit 目录：$KIT_DIR"
log "HOME：$HOME_DIR"

ARCH="$(uname -m 2>/dev/null || echo unknown)"
case "$ARCH" in
  aarch64|arm64) ;;
  *) fail "只支持 arm64/aarch64 平板，当前是 $ARCH" ;;
esac

# ---------------------------------------------------------------------------
# 1. 基础依赖
# ---------------------------------------------------------------------------
log "1/6 检查并安装依赖：nodejs clang make python3 binutils tar"
if command -v pkg >/dev/null 2>&1; then
  pkg install -y nodejs clang make python3 binutils tar >$LOGDIR/kit-pkg.log 2>&1 || warn "pkg install 有警告，见 $LOGDIR/kit-pkg.log"
else
  warn "没有 pkg 命令，假定依赖已手动装好"
fi

command -v node >/dev/null 2>&1 || fail "node 没装上"
command -v npm >/dev/null 2>&1 || fail "npm 没装上"
log "    node $(node -v) / npm $(npm -v)"
command -v clang >/dev/null 2>&1 || warn "没有 clang，编译原生绑定大概率失败"

# ---------------------------------------------------------------------------
# 2. 安装 DSH CLI
# ---------------------------------------------------------------------------
log "2/6 检查 DSH CLI"
if command -v dsh >/dev/null 2>&1; then
  log "    已安装：$(dsh --version 2>&1 | head -n 1)"
else
  log "    正在安装 @deepseek-ai/dsh（--ignore-scripts，跳过 koffi 的 cmake 编译）"
  npm i -g @deepseek-ai/dsh --ignore-scripts --no-audit --no-fund >$LOGDIR/kit-npm.log 2>&1 \
    || { tail -n 20 $LOGDIR/kit-npm.log; fail "npm 安装 dsh 失败（见 $LOGDIR/kit-npm.log）"; }
  command -v dsh >/dev/null 2>&1 || fail "dsh 装完但不在 PATH"
fi

PKG_ROOT="$(npm root -g 2>/dev/null)"
DSH_DIR="$PKG_ROOT/@deepseek-ai/dsh"
[ -d "$DSH_DIR" ] || fail "找不到 dsh 安装目录：$DSH_DIR"

# ---------------------------------------------------------------------------
# 3. 编译 android-arm64 原生绑定（官方没发布）
# ---------------------------------------------------------------------------
log "3/6 检查 node-addon-require-builtin 的 android-arm64 绑定"
ADDON_DIR="$(find "$PKG_ROOT" -type d -name 'node-addon-require-builtin' -not -path '*-android-arm64*' 2>/dev/null | head -n 1)"
[ -n "${ADDON_DIR:-}" ] || fail "找不到 node-addon-require-builtin 包"
TARGET_DIR="$(dirname "$ADDON_DIR")/node-addon-require-builtin-android-arm64"
BINDING="$TARGET_DIR/prebuilt/android-arm64-napi-v9.node"

if [ -f "$BINDING" ]; then
  log "    已存在，跳过编译：$BINDING"
else
  log "    开始编译（1～3 分钟，取决于平板性能）"
  WORK="$HOME_DIR/.dsh-kit/narb"
  rm -rf "$WORK"; mkdir -p "$WORK"
  tar -xzf "$KIT_DIR/narb-build.tgz" -C "$WORK" || fail "解压 narb-build.tgz 失败"
  ( cd "$WORK" \
      && npm install --no-audit --no-fund >$LOGDIR/kit-narb-npm.log 2>&1 \
      && ./node_modules/.bin/node-gyp rebuild --nodedir="$PREFIX_DIR" \
           --python="$(command -v python3)" -j 4 >$LOGDIR/kit-narb-build.log 2>&1 ) \
    || { tail -n 30 $LOGDIR/kit-narb-build.log 2>/dev/null; fail "原生绑定编译失败（见 $LOGDIR/kit-narb-build.log）"; }
  [ -f "$WORK/build/Release/require_builtin.node" ] || fail "编译没产出 require_builtin.node"
  bash "$KIT_DIR/install-addon.sh" "$WORK/build/Release/require_builtin.node" "$TARGET_DIR" \
    || fail "安装原生绑定包失败"
fi

# ---------------------------------------------------------------------------
# 4. 打补丁（flock / 硬链接）
# ---------------------------------------------------------------------------
log "4/6 打 Android 兼容补丁"
node "$KIT_DIR/patch-flock.js" || fail "flock 补丁失败"
node "$KIT_DIR/patch-link.js"  || fail "硬链接补丁失败"

# ---------------------------------------------------------------------------
# 5. 安装启动脚本与固定入口
# ---------------------------------------------------------------------------
log "5/6 安装启动脚本"
install -m 644 "$KIT_DIR/dsh-home.js"  "$HOME_DIR/dsh-home.js"  || fail "安装 dsh-home.js 失败"
install -m 755 "$KIT_DIR/start-dsh.sh" "$HOME_DIR/start-dsh.sh" || fail "安装 start-dsh.sh 失败"
mkdir -p "$HOME_DIR/dshpad"

# ---------------------------------------------------------------------------
# 6. 启动
# ---------------------------------------------------------------------------
log "6/6 启动 DSH 与固定入口"
bash "$HOME_DIR/start-dsh.sh"

# ---------------------------------------------------------------------------
# 附加：Termux:Boot（开机自启的注册方，装完必须打开一次才生效）
# ---------------------------------------------------------------------------
# 开机自启脚本（Termux:Boot 的入口；bootstrap 里也会写，这里保证「远程修」也能补上）
BOOT_DIR="$HOME/.termux/boot"
BOOT_SH="$BOOT_DIR/start-dsh.sh"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_SH.new" <<'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/bash
export HOME=/data/data/com.termux/files/home
export PREFIX=/data/data/com.termux/files/usr
export PATH=$PREFIX/bin:$PATH
{
  echo "=== boot $(date '+%Y-%m-%d %H:%M:%S') ==="
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
  sleep 8
  [ -x "$HOME/start-dsh.sh" ] && bash "$HOME/start-dsh.sh" || echo "missing $HOME/start-dsh.sh"
} >> "$HOME/dsh-boot.log" 2>&1
BOOTEOF
chmod +x "$BOOT_SH.new"
if [ -f "$BOOT_SH" ] && command -v cmp >/dev/null 2>&1 && cmp -s "$BOOT_SH" "$BOOT_SH.new"; then
  rm -f "$BOOT_SH.new"
  log "开机脚本已是最新：$BOOT_SH"
else
  mv -f "$BOOT_SH.new" "$BOOT_SH"
  log "开机脚本已写入：$BOOT_SH"
fi

log "附加：检查 Termux:Boot"
BOOT_MARK=""
PM_BIN=/system/bin/pm
[ -x "$PM_BIN" ] || PM_BIN=pm
if $PM_BIN list packages 2>/dev/null | grep -q 'com\.termux\.boot'; then
  BOOT_MARK="已安装（重启平板后 DSH 会自动起来）"
else
  BOOT_APK=""
  for candidate in "/sdcard/Download/termux-boot.apk" \
                   "$HOME/storage/downloads/termux-boot.apk" \
                   "/storage/emulated/0/Download/termux-boot.apk"; do
    if [ -f "$candidate" ]; then BOOT_APK="$candidate"; break; fi
  done
  if [ -z "$BOOT_APK" ]; then
    BOOT_MARK="未安装，也没找到 termux-boot.apk（先去安装页点「下载 Termux:Boot APK」；读不到 /sdcard 时先 termux-setup-storage 再重跑）"
  elif command -v termux-open >/dev/null 2>&1; then
    termux-open --content-type application/vnd.android.package-archive "$BOOT_APK" >/dev/null 2>&1
    BOOT_MARK="已请求拉起安装界面（$BOOT_APK）。没弹出就是被 Android 拦了后台启动：把 Termux 切到前台重跑本脚本，或用文件管理器点开这个 APK 手动装；装完务必点一次「打开」"
  else
    BOOT_MARK="缺 termux-open，跳过自动拉起：$BOOT_APK"
  fi
fi
log "Termux:Boot：$BOOT_MARK"

FIXED="http://127.0.0.1:3081/"
TOKEN_URL="$(cat "$HOME_DIR/dshpad/url.txt" 2>/dev/null)"
cat <<EOF

============================================================
 安装完成
------------------------------------------------------------
 固定网址（以后只记这个，重启后仍可用）：$FIXED
 当前 token 直连：${TOKEN_URL:-（未取到，见 ~/dshpad/web.log）}
 Termux:Boot：$BOOT_MARK

 在平板浏览器打开后：
   菜单 → 添加到主屏幕，以后一点就进

 平板重启 / Termux 被杀后重新拉起：
   bash ~/start-dsh.sh
============================================================
EOF
