# 让别人的 DSH 自己装这个插件（@ 一下就装）

> 这段是写给 **DSH 里的 agent** 看的。用户把压缩包拖进对话、或者说一句「按 AGENT-INSTALL.md 装这个插件」，agent 照下面做即可。

## 用户要说的那一句话（模板）

```
把附件这个 dsh-pad-kit.zip 装成 DSH 插件，装完告诉我怎么重启
```

或者（已经解压到本地时）：

```
把 D:\下载\dsh-pad-kit 装成 DSH 插件
```

---

## Agent 执行清单

前提：DSH 的 home 是 `%USERPROFILE%\.dsh`（下文记作 `<dsh>`），profile 是 `web`。
写入 `<dsh>` 属于工作区之外，需要提权 —— 用户会看到一次确认弹窗，点允许即可。

### 1. 解压 / 定位插件目录

压缩包里应当有这些条目（缺任何一个都不能装）：

```
package.json
cordis.patch.yml
lib\plugin.js
dsh-android-kit.tgz
kit\termux.apk
install-windows.ps1
```

解压到一个临时目录，记作 `<src>`。

### 2. 复制到插件目录

```
<dsh>\plugins\dsh-pad-kit\
```

目标已存在时不要整个覆盖，只覆盖上面那几个关键文件（避免把用户的 `tablets.json` 状态搞乱 —— 状态实际不在插件目录里，但仍建议保守）。

### 3. 建 junction（让 Node 按包名解析）

```
cmd /c mklink /J "<dsh>\profiles\web\node_modules\@local\dsh-pad-kit" "<dsh>\plugins\dsh-pad-kit"
```

macOS / Linux 用 `ln -s`。

### 4. 在 profile 里登记依赖

编辑 `<dsh>\profiles\web\package.json`：

```json
"dependencies": {
  "@local/dsh-pad-kit": "link:C:/Users/<用户>/.dsh/plugins/dsh-pad-kit"
}
```

- 先备份成 `package.json.bak-pad-kit`
- 路径用正斜杠
- **保持 UTF-8 无 BOM**
- 不要用 `Set-Content`（会把中文写坏），用 `[System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))`

### 5. 追加激活行

在 `<dsh>\profiles\web\cordis.patch.yml` 末尾追加（先备份成 `.bak-pad-kit`）：

```yaml
# dsh-pad-kit：平板上跑 DSH + 电脑 SSH 远程管理
- insert:
    - id: pad-kit
      name: '@local/dsh-pad-kit'
      config:
        httpPort: 8090
        apkName: termux.apk
        timeoutMs: 120000
```

幂等：文件里已经有 `- id: pad-kit` 就不要重复追加。

### 6. 校验（不重启也能查）

```powershell
node --check "<dsh>\plugins\dsh-pad-kit\lib\plugin.js"
node --input-type=module -e "const m = await import('file:///<dsh>/plugins/dsh-pad-kit/lib/plugin.js'); console.log(m.name, Object.keys(m));"
```

应当打印 `pad-kit`，且导出里包含 `renderPage`、`renderBootstrap`、`renderInstallScript`。

### 7. 告诉用户重启

**新增插件行不会热加载**，必须重启 DSH。重启后工具列表里会出现 17 个 `tablet_*` 工具：

```
tablet_install_page  tablet_bootstrap   tablet_targets     tablet_kit_status
tablet_kit_setup     tablet_kit_url     tablet_kit_apk     tablet_info
tablet_sh            tablet_ls          tablet_read        tablet_write
tablet_pull          tablet_push        tablet_install_apk tablet_launch
tablet_wake
```

---

## 装完怎么用（给用户看的三句话）

1. 在 DSH 里调用 `tablet_install_page`，拿到一个 `http://<电脑IP>:8090/` 地址
2. 平板上打开这个地址，按页面走（没有 Termux 就下 APK，有就直接粘一行命令）
3. 装完平板会打印一个网址，用平板自己的浏览器打开就是 DSH Web

---

## 常见失败

| 现象 | 原因 | 处理 |
|---|---|---|
| 提权被拒 | 沙箱不允许写 `%USERPROFILE%\.dsh` | 重新跑一次并点允许；或手动把 `<src>` 拷到 `<dsh>\plugins\dsh-pad-kit` |
| 找不到 `profiles\web` | DSH 从没启动过 | 先启动一次 DSH（会生成 profile），再装 |
| 重启后没有 `tablet_*` | 激活行没写进去 / 依赖没登记 | 检查 `cordis.patch.yml` 有没有 `- id: pad-kit`，`package.json` 有没有 `@local/dsh-pad-kit` |
| 工具报「当前 DSH 版本不支持」 | 宿主 DSH 低于 `0.1.7-rc.2` | 升级 DSH 后重启 |
| `node --check` 报 `Invalid or unexpected token` | 文件被按 GBK 重写坏了 | 从解压目录重新复制 `lib\plugin.js`，不要用 `Set-Content` 改它 |
