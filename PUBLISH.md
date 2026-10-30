# 发布指南（GitHub + npm）

这个目录就是**可直接推送的仓库根目录**：`package.json`、`LICENSE`、`.gitignore` 都按公开发布准备好，`lib/`、`kit/`、`dsh-android-kit.tgz` 是运行时必需的文件。

- 仓库地址（计划）：`https://github.com/longsiqi-123/dsh-pad-kit`
- npm 包名（已查过，**未被占用**）：`dsh-pad-kit`

---

## 一、推到 GitHub

### 1. 先在网页上建空仓库

打开 <https://github.com/new>：

| 字段 | 填什么 |
|---|---|
| Repository name | `dsh-pad-kit` |
| Description | `Run DeepSeek Harness on an Android tablet (Termux) — installer page, SSH setup, fixed web entry` |
| Public / Private | **Public**（DSH 从 GitHub 装插件需要能公开拉取） |
| Add a README / .gitignore / license | **全部不勾**（本地已经有，勾了会冲突） |

点 **Create repository**，拿到地址 `https://github.com/longsiqi-123/dsh-pad-kit.git`。

### 2. 打开 PowerShell，在本目录执行

```powershell
cd "E:\dsh workspace\winlator\repo\dsh-pad-kit"

git init -b main
git add -A
git -c user.name="LongSiQi" -c user.email="2443854298@qq.com" commit -m "feat: dsh-pad-kit 1.0.0 — run DSH on Android tablet via Termux"
git remote add origin https://github.com/longsiqi-123/dsh-pad-kit.git
git push -u origin main
```

`git push` 会弹出浏览器让你登录 GitHub（你已经登录过，通常点一下授权就好）。
如果弹出的是要 **token** 而不是浏览器：

1. 打开 <https://github.com/settings/tokens> → **Generate new token (classic)**
2. 勾选 `repo` 权限 → 生成 → 复制那串 `ghp_...`
3. 密码框里**粘 token**（不是账号密码）

> 仓库里有 `kit\termux.apk`（35 MB）和 `kit\termux-boot.apk`（0.7 MB），
> 单文件都在 GitHub 的 100 MB 限制内，正常推送即可。

### 3. 验证

浏览器打开 `https://github.com/longsiqi-123/dsh-pad-kit`，确认能看到 `lib/`、`kit/`、`package.json`、`README.md`。

然后在 DSH 里 **插件 → 添加插件** 填：

```
github:longsiqi-123/dsh-pad-kit
```

---

## 二、发布到 npm

### 1. 注册 / 登录

```powershell
# 没有账号先去 https://www.npmjs.com/signup 注册（用户名随便，包名已经是 dsh-pad-kit 不需要作用域）
npm login
```

`npm login` 会开浏览器授权，或者输入 用户名 / 密码 / 邮箱一次性验证码。

验证登录状态：

```powershell
npm whoami
```

### 2. 先干跑一遍，确认要上传哪些文件

```powershell
cd "E:\dsh workspace\winlator\repo\dsh-pad-kit"
npm pack --dry-run
```

应该看到 `lib/`、`kit/`、`cordis.patch.yml`、`dsh-android-kit.tgz`、`README.md`、`LICENSE` 等条目，总大小约 36 MB（大部分是 Termux 的 APK）。

### 3. 正式发布

```powershell
npm publish
```

包名就是 `dsh-pad-kit`（无作用域、首次发布无需 `--access public`）。

发完验证：

```powershell
npm view dsh-pad-kit version
```

### 4. 以后再发新版本

```powershell
npm version patch        # 1.0.0 → 1.0.1，同时打 tag
git push --follow-tags
npm publish
```

---

## 三、发完之后：用户怎么装

| 用户情况 | 让他填 |
|---|---|
| 有 npm 网络 | `dsh-pad-kit` |
| 只想走 GitHub | `github:longsiqi-123/dsh-pad-kit` |
| 你直接发了 zip | zip 的绝对路径 |

装完都要**重启一次 DSH**，`tablet_*` 的 17 个工具才会出现。

---

## 四、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `npm publish` 报 `403 You do not have permission` | 包名被别人占了（`npm view dsh-pad-kit` 看是否存在）；改 scoped 名 `@你的用户名/dsh-pad-kit` 再发，然后 `--access public` |
| `git push` 报 `remote: Permission to ... denied` | 用的是别人的凭据；`git credential-manager` 里清掉旧的，或改走 token |
| `npm pack` 里没有 `kit/termux.apk` | `files` 字段漏了 `kit`；检查 `package.json` |
| DSH 添加插件报「没有组合包 patch」 | `package.json` 的 `dsh.bundle.patch` 丢了，或 `cordis.patch.yml` 不在包内 |
| 装完 `tablet_*` 不出现 | 没重启 DSH（新增插件行不热加载） |

---

## 五、这个包里哪些文件是必须的

| 路径 | 作用 | 缺了会怎样 |
|---|---|---|
| `package.json` | DSH 靠它找入口与 patch | 装不上 |
| `cordis.patch.yml` | 激活行（`id: pad-kit`） | 装上了但不生效 |
| `lib/plugin.js` | 17 个工具 + 安装页 + bootstrap 渲染 | 装上没有工具 |
| `kit/bootstrap.tmpl` | 平板端那一行命令的模板 | 安装页 500 |
| `kit/termux.apk` | 给没装 Termux 的平板 | 「下载 Termux」按钮 404 |
| `kit/termux-boot.apk` | 开机自启 | 自启按钮 404 |
| `kit/setup.sh` 等 | 平板端装 dsh + 编译绑定 + 打补丁 | 平板端装不起来 |
| `dsh-android-kit.tgz` | 上面这些脚本的打包（安装时下发） | 平板端装不起来 |
| `install-windows.ps1` / `install-unix.sh` | 电脑端拷贝安装 | 只能用方式 A 装 |
