# dsh-pad-kit

**在安卓平板上本地运行 DeepSeek Harness（DSH）**，用平板自己的浏览器打开。

它操作的是平板自己的文件、应用和命令 —— 不是在平板上远程操控电脑上的文件。

## 装这个插件

DSH 里 **插件 → 添加插件**，输入框里填下面任意一种，点「安装」，装完点「立即启用」：

| 来源 | 填什么 |
|---|---|
| npm 包 | `dsh-pad-kit` |
| GitHub | `github:longsiqi-123/dsh-pad-kit` |
| GitHub（完整地址） | `https://github.com/longsiqi-123/dsh-pad-kit` |
| 本地压缩包 | `…\dist\dsh-pad-kit.zip` 的绝对路径 |
| 本地目录 | 解压后那个文件夹的绝对路径 |

命令行等价：

```bash
dsh plugin add dsh-pad-kit
dsh plugin add github:longsiqi-123/dsh-pad-kit
```

装完**需要重启一次 DSH**，`tablet_*` 这 17 个工具才会出现在工具列表里（新增插件行不热加载）。

## 一、它是什么

| 谁 | 得到什么 |
|---|---|
| **平板** | 平板浏览器里的 **Web 网页**，打开就是 DSH 本体，重启后照样能用 |
| **电脑** | DSH 里多出 17 个 `tablet_*` 工具，负责安装和远程运维 |
| 安装方式 | 局域网私有部署，安装页形如 `http://<电脑IP>:8090/`（同一 Wi-Fi 内有效，不是公网网址） |

全程不用 adb、不用 root、不用数据线。电脑只是安装工，装完关掉也不影响平板使用。

## 二、平板上怎么用

1. 平板浏览器打开那个 **Web 网页**，收藏书签或加到桌面
2. 就是完整的 DSH Web 界面：新会话、插件、工作区都跑在平板本地
3. 平板重启后入口不变，自动跳到当次有效地址，不用重新找

打不开就是平板上的服务没起来，电脑侧跑一次 `tablet_kit_setup`。

---

## 三、为什么需要它（三个硬问题）

DSH 官方没有 Android 版，唯一能在平板本地跑的是 CLI + Web GUI（`npm i -g @deepseek-ai/dsh`）。
但直接装上有三处硬伤，本套件逐一补掉：

| # | 坑 | 直接装会看到 | 这里的处理 |
|---|---|---|---|
| 1 | 原生绑定没有 `android-arm64` 预编译包 | `dsh: host preparation failed: No usable native binding found for node-addon-require-builtin-android-arm64 (auto)` | 在平板现场用 `node-gyp` 编译 `require_builtin.node`（`narb_product=require-builtin`），包装成可选包塞进 dsh 的 `node_modules` |
| 2 | Android 没有 `flock` | 每轮对话报 `本轮运行失败 flock is not supported on android-arm64` | 给 `@deepseek-ai/node-addon-system/lib/flock.js` 放行 `android`，单实例运行直接跳过加锁 |
| 3 | Android 禁硬链接 | `EACCES: permission denied, link '...jsonl.zstd.tmp' -> '...jsonl.zstd'` | 会话持久化里的 `link()` 改成「失败就 `copyFile`」，保留原有的不覆盖语义 |

三个补丁都是**锚点匹配 + 幂等**：锚点对不上就退出、不写文件；已打过会打印「跳过」。所以反复执行无害。

---

## 四、前提条件

| # | 条件 | 怎么检查 | 不满足会怎样 |
|---|---|---|---|
| 1 | 平板是 **arm64/aarch64**、Android 7+ | Termux 里 `getprop ro.product.cpu.abi` → `arm64-v8a` | node 或编译产物跑不起来 |
| 2 | 电脑和平板**在同一 Wi-Fi、同一网段、双向能连 TCP**（未开 AP 隔离/访客网络） | 平板浏览器能打开 `http://<电脑IP>:8090/`；装完后电脑能 `ssh -p 8022` 到平板 | 平板连不上电脑→装不上；电脑连不上平板→远程工具全挂 |
| 3 | 电脑防火墙放行 **TCP 8090**（安装期间） | `curl` 一直转圈就是没放行 | 命令卡住或直接失败 |
| 4 | 平板允许**安装未知来源应用** | 设置 → 应用 → 特殊权限 | Termux 装不上，后面全断 |
| 5 | 平板能访问 **npm** | Termux 里 `curl -I https://registry.npmjs.org` | 装 dsh 失败 |
| 6 | 平板约 **1.5 GB** 空闲空间 | `df -h /data` | 编译到一半 No space |
| 7 | 安装那 1～3 分钟里**平板不锁屏**、Termux 在前台 | — | Termux 被冻结，编译中断 |
| 8 | 电脑有 **OpenSSH 客户端** | `ssh -V`（Win10 1809+ 自带） | 远程工具全部不可用 |
| 9 | 电脑侧 DSH **重启过一次** | 工具列表里出现 `tablet_*` | 新增插件行不热加载，工具不会出现 |
| 10 | 电脑侧 DSH **≥ 0.1.7-rc.2**（要支持用户插件机制） | DSH 版本号；插件启动时会自检 | 所有 `tablet_*` 工具直接返回「当前 DSH 版本不支持」 |

> 第 10 条的细节：版本依次从 `DSH_VERSION` 环境变量、`process.argv` 上级目录的 `package.json` 里取，
> 都识别不到时**放行**（避免误伤）。低于门槛时不会装到一半才失败，而是一开始就给结论。
> 只有第 7 条是"必须有人在平板前面"的。整个流程里人工只出现两次：**第一次装 Termux 并粘一行命令**、**Termux 被冻结后切回前台**。

---

## 五、连接是怎么建立的（不用数据线、不用 adb）

全程没有任何"直连"要求，靠的是**同一局域网内的三段访问**：

```
平板浏览器 ──① 打开安装页 ──▶ 电脑:8090            （平板主动，HTTP）
平板 Termux ──② 报到 ───────▶ 电脑:8090 /register  （平板主动，HTTP）
电脑 DSH ───③ SSH 运维 ────▶ 平板:8022            （电脑主动，SSH）
```

- ① ② 是**平板连电脑**：安装阶段的前置条件，平板必须能打开 `http://<电脑IP>:8090/`
- ③ 是**电脑连平板**：安装脚本会在平板上起 `sshd`（8022），之后大多数套件工具走这条
- 三段都只要求「同一网段 + TCP 能通」：不用数据线、不用 adb、不用 root、不用公网 IP

### 怎么确认连接成立

```bash
# ① 平板 → 电脑：平板浏览器打开 http://<电脑IP>:8090/ ，能看到安装页
# ② 报到：跑完那行 curl，电脑侧 tablet_targets 里冒出 u0_aXXX@<平板IP>:8022
# ③ 电脑 → 平板：ssh -p 8022 <termux用户>@<平板IP> echo ok   → 打印 ok
```

### 连不上的三种典型原因

| 现象 | 原因 |
|---|---|
| 平板打不开 8090 | 不在同一 Wi-Fi；路由器开了 AP 隔离/访客网络；电脑防火墙拦了 8090 |
| 能开安装页但没报到 | 平板没跑那行 curl；或平板走的是蜂窝流量（与电脑不同网段） |
| 报到了但 ssh 连不上 | Termux 被系统冻结（切前台 / `termux-wake-lock`）；或平板 DHCP 换了 IP |
## 六、安装：电脑端（五种方式）

### 方式 A：DSH「添加插件」（推荐，最简单）

DSH 界面里 **插件 → 添加插件**，填下面任意一种，点「安装」，再点「立即启用」：

```
dsh-pad-kit                                    # npm 包
github:longsiqi-123/dsh-pad-kit                # GitHub 仓库
https://github.com/longsiqi-123/dsh-pad-kit    # GitHub 完整地址
D:\某个目录\dsh-pad-kit.zip                     # 本地压缩包
D:\某个目录\dsh-pad-kit                         # 本地目录（解压后）
```

DSH 会用 `pluginManager.inspect` 先读一遍包（包名、简介、版本、有没有组合包 patch），再交给 pnpm 装进 profile。
这条路不需要提前建 junction、不需要手改 `package.json` 和 `cordis.patch.yml` —— 添加插件时 DSH 自己写。

装完**重启一次 DSH**，`tablet_*` 工具出现。

### 方式 B：一行命令

电脑上先把安装页开起来（`tablet_install_page`，或 `node installer-page.js`），然后在 **PowerShell** 里跑：

```powershell
irm http://<电脑IP>:8090/install.ps1 | iex
```

它会自己下载 `plugin.zip`（约 33 MB）→ 解压到临时目录 → 执行 `install-windows.ps1`，也就是下面方式 A 的全部步骤。跑完重启一次 DSH。

> 这条路和方式 A 的区别：方式 A 是 DSH 自己的「添加插件」把包装进 profile（会写 `package.json` 与激活行）；
> 方式 B 是让你在浏览器里点一下就把插件装好，适合手边没有 DSH 界面、或想装完直接看到「重启提示」的场景。

### 方式 C：丢给别人的 DSH，让它自己装

对方已经有电脑版 DSH、只是没有平板时，最省事的做法是：

1. 把这个压缩包发给他（微信 / 网盘 / 局域网都行）
2. 他在 DSH 对话里把压缩包拖进去，说一句：`把附件这个 dsh-pad-kit.zip 装成 DSH 插件，装完告诉我怎么重启`
3. 他的 agent 会照 `AGENT-INSTALL.md`（本包自带）执行：解压 → 复制 → 建 junction → 登记依赖 → 写激活行 → 校验 → 提示重启
4. 重启 DSH，`tablet_*` 工具出现

对方只需要**点一次提权允许**（写 `%USERPROFILE%\.dsh` 属于工作区外）+ **重启一次 DSH**。

### 方式 D：一键脚本

把压缩包解压，在解压出来的目录里执行：

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

```bash
# macOS / Linux
bash install-unix.sh
```

脚本做四件事（幂等，重复跑只补齐）：复制插件到 `~/.dsh/plugins/dsh-pad-kit`、建 junction/软链、在 `profiles/web/package.json` 登记 `link:` 依赖、在 `profiles/web/cordis.patch.yml` 追加激活行。会先备份 `package.json` 和 `cordis.patch.yml`。

### 方式 E：手工

1. 复制整个目录到 `%USERPROFILE%\.dsh\plugins\dsh-pad-kit\`
2. 建链接（让 Node 能按包名解析）：
   - Windows：`mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\@local\dsh-pad-kit" "%USERPROFILE%\.dsh\plugins\dsh-pad-kit"`
   - macOS/Linux：`ln -s ~/.dsh/plugins/dsh-pad-kit ~/.dsh/profiles/web/node_modules/@local/dsh-pad-kit`
3. `profiles/web/package.json` 的 `dependencies` 加：`"@local/dsh-pad-kit": "link:<插件的绝对路径>"`
4. `profiles/web/cordis.patch.yml` 末尾加：

```yaml
- insert:
    - id: pad-kit
      name: '@local/dsh-pad-kit'
      config:
        httpPort: 8090
        apkName: termux.apk
        timeoutMs: 120000
```

5. **重启 DSH**

### 平板端：安装页会自动分岔

打开 `http://<电脑IP>:8090/`，页面第一屏就问「平板有没有 Termux」：

| 平板状态 | 你要做的 | 之后 |
|---|---|---|
| **没有** Termux | 点「下载 Termux APK」→ 装 → 打开 | 再走下面「已有」那一行 |
| **已有** Termux | 在 Termux 里粘一行 | `curl -fL http://<电脑IP>:8090/bootstrap.sh \| bash` |

那一行命令进 Termux 后**先自检、再决定装什么**，任意一项不过就直接给结论：

| 自检项 | 不通过时做什么 |
|---|---|
| 是否在 Termux 里（`$PREFIX` + `/data/data/com.termux`） | 退出，提示先装 Termux |
| `pkg` 命令是否存在 | 判定为应用商店旧版（0.101），要求换 F-Droid/GitHub 版 |
| 架构是 arm64 | 非 arm64 直接退出 |
| Android ≥ 7.0（SDK 24） | 退出并说明 |
| `/data` 剩余 ≥ 1.5 GB | 退出并说出还差多少 |
| `curl` 能跑 | 自动 `apt update && apt full-upgrade` 修 libssl 符号；仍坏才退出 |
| 能连通电脑 `8090/healthz` | 退出，列出三个常见原因（不同 Wi-Fi / AP 隔离 / 防火墙） |
| `sshd` 存在 | 自动 `pkg install openssh`；缺包就切官方源重试 |

八项全过才动手装 DSH 本体 —— 环境不对会在几秒内给结论，不会装到一半才失败。

### 开机自启（Termux:Boot）

安装脚本会把开机脚本写好：

```
~/.termux/boot/start-dsh.sh      # wakelock → sleep 8 → bash ~/start-dsh.sh → 日志进 ~/dsh-boot.log
```

但 **Android 只认装了 Termux:Boot 应用的开机脚本**，否则这个目录没人读。所以：

| 状态 | 你要做的 |
|---|---|
| 还没装 Termux:Boot | 打开安装页点「下载 Termux:Boot APK（0.8.1）」，装完打开它一次 |
| 已装 | 不用管，重启平板后 DSH 会自己起来 |
| 验证 | 重启后平板浏览器打开那个网页地址，能开就是成功；不行看 `cat ~/dsh-boot.log` |

装 Termux:Boot 不需要 root，也不改任何系统设置 —— 它只是把自己注册成开机广播接收器。

---

## 七、全流程时间线

```
T0  电脑：调 tablet_install_page
        → 插件生成 SSH 密钥（%USERPROFILE%\.dsh\pad-kit\id_ed25519，没有才生成）
        → 起局域网安装页，返回 http://172.24.x.x:8090/

T1  平板：浏览器打开该地址（页面上有二维码）
        → 「下载 Termux APK」→ 允许未知来源 → 安装 Termux      ← 人工动作 1

T2  平板：打开 Termux，粘贴页面上那一行：
          curl -fL http://172.24.x.x:8090/bootstrap.sh | bash   ← 人工动作 2

T3  平板自动（约 10 秒）
        ├─ pkg install openssh curl
        ├─ 把电脑公钥写进 ~/.ssh/authorized_keys
        ├─ ssh-keygen -A ；nohup sshd（监听 8022）
        └─ curl /register?user=u0_aXXX&port=8022   → 向电脑报到

T4  电脑：插件收到报到，写 ~/.dsh/pad-kit/tablets.json
        到这里「通道 + 认证」都通了

T5  平板自动（1～3 分钟，最容易失败的一段）
        ├─ pkg install nodejs clang make python3 binutils
        ├─ npm i -g @deepseek-ai/dsh --ignore-scripts
        ├─ 编译 require_builtin.node 并装成 android-arm64 可选包
        ├─ 补丁 1：放行 android 的 flock
        ├─ 补丁 2：硬链接失败降级 copyFile
        └─ 起服务与固定入口，打印 FIXED_URL

T6  电脑：tablet_targets      → u0_aXXX@172.24.x.x:8022
        tablet_kit_status    → NODE / DSH / BINDING / FLOCK=patched / LINK=patched / HOME_3081=302

T7  平板：用平板自己的浏览器打开那个 Web 网页 → 就是平板上的 DSH 本体
```

---

## 八、每步谁做、失败怎么办

| 步骤 | 谁做 | 耗时 | 失败信号 | 处理 |
|---|---|---|---|---|
| 起安装页 | 插件（一条命令） | 1 秒 | `端口 8090 已被占用` | 改配置 `httpPort` 换端口 |
| 装 Termux | **人** | 1 分钟 | 提示"禁止安装" | 开未知来源权限 |
| 粘那一行 | **人** | 5 秒 | `curl: not found` | Termux 没装好，重来 |
| 建 SSH 通道 | 平板自动 | 10 秒 | 报到失败 | 仍可用 `tablet_targets` 手动登记 `host/user/port` |
| 装 node + dsh | 平板自动 | 1～2 分钟 | `E: Unable to locate package` | 换 termux 源（见故障排查） |
| 编译原生绑定 | 平板自动 | 1～2 分钟 | `CMake does not seem to be available` | `pkg install clang make python3` |
| 打补丁 | 平板自动 | 2 秒 | 锚点不匹配 → 直接退出不写文件 | dsh 升级后重跑 `tablet_kit_setup` |
| 起服务 | 平板自动 | 3 秒 | 网页返回 503 | `tablet_kit_setup` 重跑 |
| 日常控制 | 电脑（工具） | 毫秒级 | `banner exchange` 超时 | `tablet_wake`，或把 Termux 切前台 |

---

## 九、17 个工具

### 套件工具（`pad-kit`，管安装与状态）

| 工具 | 作用 |
|---|---|
| `tablet_install_page` | 起局域网安装页，返回可发给平板的地址 |
| `tablet_bootstrap` | 输出 `bootstrap.sh`；`sshonly: true` 只建 SSH 通道、不装 DSH |
| `tablet_targets` | 列出已报到平板；也能手动登记 |
| `tablet_kit_status` | 一条命令看全套健康度（版本 / 绑定 / 补丁 / 网页入口 / token） |
| `tablet_kit_setup` | 远程重跑安装脚本（升级、修复） |
| `tablet_kit_url` | 取固定入口 + token 直连地址 |
| `tablet_kit_apk` | Termux APK 的局域网下载地址 |

### 通用远程工具（`tablet-ssh`，管日常操作）

| 工具 | 作用 |
|---|---|
| `tablet_sh` | **主力**：执行任意 shell 命令 |
| `tablet_info` | 型号、Android 版本、ABI、内存、存储、运行时长 |
| `tablet_ls` / `tablet_read` / `tablet_write` | 列目录、读文件、写文件 |
| `tablet_push` / `tablet_pull` | 电脑 ⇄ 平板传文件（scp） |
| `tablet_install_apk` | 推 APK 并打开安装界面（**最后一下"安装"要人点**） |
| `tablet_launch` | 起 App（解析主 Activity 后 `am start`） |
| `tablet_wake` | `termux-wake-lock`，防冻结 |

**目标解析顺序**：调用参数 → 配置 `sshHost/sshUser` → 最近一次报到。第一次之后基本不用传参数。

---

## 十、做不到的事

| 想做的 | 能否 | 原因 |
|---|---|---|
| 看平板屏幕 | ❌ | Termux 无 `screencap`，无 adb，无 root |
| 模拟点击/滑动 | ❌ | 无 `input`，无 root，无 `termux-api` |
| 静默装 APK | ❌ | Android 要求用户点确认，无 root 没有例外 |
| 后台自动拉起浏览器 | ❌ | Android 10+ 禁后台启动 Activity，`am start` 静默失败（退出码仍 0） |
| 操作别的 App 的内部按钮 | ❌ | 只能启动，不能操控 UI |

结论：电脑侧那 17 个工具是**命令行级远程控制 + 文件通道**，不是远程桌面。

要分清两个界面，别混：

| 界面 | 跑在哪 | 操作的是谁的东西 |
|---|---|---|
| **平板浏览器里的 DSH**（装完就有，主角） | 平板本机 | **平板自己的**文件、目录、命令 —— 这才是本套件的目的 |
| 电脑 DSH 里的 `tablet_*` 工具（配角） | 电脑 | 通过 SSH 去动平板；只是安装和运维通道 |

**不会发生的事**：平板的 Web 界面读不到电脑的 `C:`、`D:` 盘，所有路径都在平板内；电脑关机后平板浏览器照样能用。

---

## 十一、已知问题与设计取舍

这些是刻意记下来的，不是待办清单的隐饰：

| 问题 | 现状 | 建议 |
|---|---|---|
| **报到是"最近一次优先"** | 同网段任何设备都能 `POST /register` 把自己登记成候选目标 | 只用可信网络；需要确定性时在配置里写死 `sshHost/sshUser` |
| **平板 IP 会变**（DHCP） | 变 IP 后旧记录连不上 | 重跑一次 bootstrap（会重新报到），或 `tablet_targets` 手动改 |
| **多台平板** | 只按最近报到选一台 | 显式传 `host`/`user`，或用配置固定 |
| **仅 IPv6 的网络** | 未适配（`/register` 只去掉 `::ffff:` 前缀，SSH 连 IPv6 需要方括号） | 用有 IPv4 的网络 |
| **Termux 签名冲突** | 平板上若已有 F-Droid 版 Termux，装我们这份 GitHub debug 版会签名冲突 | 先卸载旧版（会丢数据），或直接沿用旧版 Termux——`bootstrap.sh` 不挑来源 |
| **Google Play 版 Termux** | 早已停止维护，装不上新版包 | 不要用 |
| **npm 慢** | `setup.sh` 用默认源 | 平板能访问 `registry.npmmirror.com` 的话，可先 `npm config set registry https://registry.npmmirror.com` 再跑 |
| **dsh 升级后补丁失效** | `npm i -g` 会覆盖被补丁的文件 | 升级后跑一次 `tablet_kit_setup`；`tablet_kit_status` 会显示 `FLOCK/LINK=failed` 提示 |
| **node 大版本变化** | 编译产物按 napi-v9 打，跨大版本可能需重编 | 重跑 `tablet_kit_setup` |
| **安装期间锁屏** | 编译中途被冻结 → 半成品 | 安装时别锁屏，Termux 留前台 |
| **Windows 缺 ssh 客户端** | `ssh.exe` 不存在时报 `ssh 不存在` | 设置 → 应用 → 可选功能 → 添加 OpenSSH 客户端 |
| **macOS/Linux 路径** | 已按平台取 `ssh`/`ssh-keygen` | 无 |
| **安装页常驻** | 装完仍在监听 8090 | 可接受；不想开就在配置里换端口或重启 DSH |

---

## 十二、故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `还未认到平板` / 工具提示先装 | 平板没报到过 | 先 `tablet_install_page`，平板跑完那行命令 |
| `连不上 …: Termux 的 sshd 没应答` | Termux 被冻结 | 平板：`termux-wake-lock`；设置 → 电池 → 后台耗电管理 → Termux → 不受限制 |
| `SSH 公钥被拒绝` | 公钥没写进去 | 重跑 bootstrap，或把 `~/.dsh/pad-kit/id_ed25519.pub` 追加到平板 `~/.ssh/authorized_keys` |
| `E: Unable to locate package openssh` | pkg 镜像缺包 | `echo "deb https://packages.termux.dev/apt/termux-main stable main" > $PREFIX/etc/apt/sources.list && apt update` |
| `CMake does not seem to be available` | 缺编译工具链 | `pkg install -y clang make python3 binutils` |
| `flock is not supported` 又出现 | 补丁被 npm 覆盖 | `tablet_kit_setup` |
| 网页返回 503 | 平板上 dsh 没在跑 | `tablet_sh "bash ~/start-dsh.sh"` |
| 平板浏览器打不开安装页 | 不同网段 / AP 隔离 / 防火墙 | 检查同 Wi-Fi、放行 8090 |
| 工具列表里没有 `tablet_*` | 新增插件行不热加载 | 重启 DSH |

---

## 十三、安全与卸载

**安全**：安装页会把**公钥**暴露给同网段（公钥本身无害），但 `/register` 接受任意设备的报到，等于"最近报到的设备会被当作目标"。在不可信网络里务必显式配 `sshHost`；平板侧 sshd 只允许公钥登录，不要打开密码登录。

**卸载**

平板上：

```bash
pkill -f dsh
rm -rf ~/dsh-android-kit ~/dsh-home.js ~/start-dsh.sh ~/dshpad ~/.dsh-kit
npm rm -g @deepseek-ai/dsh
```

电脑上：删掉 `cordis.patch.yml` 里的 `- insert: id: pad-kit` 那段、删掉 `package.json` 里的 `@local/dsh-pad-kit`、删掉 `~/.dsh/plugins/dsh-pad-kit`，重启 DSH。

---

## 十四、目录结构

```
dsh-pad-kit/
├── install-windows.ps1     Windows 一键安装（幂等）
├── install-unix.sh         macOS/Linux 一键安装（幂等）
├── installer-page.js       不装插件也能用的独立安装页（node installer-page.js）
├── lib/plugin.js           插件本体（7 个工具 + 局域网安装页）
├── kit/                    推给平板的脚本
│   ├── setup.sh            平板侧一键脚本（6 步）
│   ├── install-addon.sh    安装编译出的原生绑定
│   ├── patch-flock.js      补丁 1
│   ├── patch-link.js       补丁 2
│   ├── narb-build.tgz      原生绑定源码包（binding.gyp 已设 require-builtin）
│   ├── dsh-home.js         固定入口跳转页
│   ├── start-dsh.sh        启动器（含 wake-lock）
│   └── termux.apk          Termux（arm64，GitHub debug 版，35,106,607 字节）
├── dsh-android-kit.tgz     上面 kit/ 的打包（不含 APK，避免重复）
├── package.json / cordis.patch.yml
└── README.md / 使用说明.md
```
