# dsh-pad-kit 电脑端安装器（Windows）
# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里：
#   powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
# 作用：把插件放到 %USERPROFILE%\.dsh\plugins\、建 junction、在 profile 里登记、追加激活行。
# 幂等：重复运行只做补齐，不会重复写入。

param(
  [string]$Profile = 'web',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh')
)

$ErrorActionPreference = 'Stop'
$pkgName = '@local/dsh-pad-kit'
$pluginDirName = 'dsh-pad-kit'
$src = $PSScriptRoot

function Say($msg) { Write-Host $msg }
function Fail($msg) { Write-Host "错误：$msg" -ForegroundColor Red; exit 1 }

Say "==> 1/5 检查来源目录"
$needed = @('package.json', 'cordis.patch.yml', 'lib\plugin.js', 'dsh-android-kit.tgz', 'kit\termux.apk')
foreach ($f in $needed) {
  if (-not (Test-Path (Join-Path $src $f))) { Fail "来源里缺少 $f（请在解压后的 dsh-pad-kit 目录里运行本脚本）" }
}
Say "    来源 OK：$src"

Say "==> 2/5 复制到 $DshHome\plugins\$pluginDirName"
$pluginsRoot = Join-Path $DshHome 'plugins'
$target = Join-Path $pluginsRoot $pluginDirName
New-Item -ItemType Directory -Force -Path $pluginsRoot | Out-Null
if (Test-Path $target) {
  foreach ($f in $needed) {
    $dstFile = Join-Path $target $f
    New-Item -ItemType Directory -Force -Path (Split-Path $dstFile) | Out-Null
    Copy-Item (Join-Path $src $f) $dstFile -Force
  }
  Say "    已存在，已就地更新关键文件"
} else {
  Copy-Item $src $target -Recurse -Force
  Say "    已复制"
}

Say "==> 3/5 建 junction（让 node 能按包名解析）"
$profileDir = Join-Path $DshHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) { Fail "找不到 profile 目录：$profileDir（DSH 至少启动过一次吗？）" }
$linkDir = Join-Path $profileDir 'node_modules\@local'
New-Item -ItemType Directory -Force -Path $linkDir | Out-Null
$link = Join-Path $linkDir $pluginDirName
if (Test-Path $link) {
  (Get-Item $link).Delete()
  Say "    旧链接已移除"
}
cmd /c mklink /J "`"$link`"" "`"$target`"" | Out-Null
if (-not (Test-Path $link)) { Fail "junction 创建失败：$link" }
Say "    OK：$link"

Say "==> 4/5 在 profile package.json 里登记依赖"
$pkgFile = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgFile)) { Fail "找不到 $pkgFile" }
$backup = "$pkgFile.bak-pad-kit"
Copy-Item $pkgFile $backup -Force
$json = Get-Content $pkgFile -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $json.dependencies) { $json | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
$wanted = "link:$($target -replace '\\', '/')"
if ($json.dependencies.PSObject.Properties.Name -contains $pkgName) {
  $json.dependencies.$pkgName = $wanted
} else {
  $json.dependencies | Add-Member -NotePropertyName $pkgName -NotePropertyValue $wanted
}
$out = ConvertTo-Json -InputObject $json -Depth 20
[System.IO.File]::WriteAllText($pkgFile, $out, (New-Object System.Text.UTF8Encoding($false)))
Say "    OK（备份：$backup）"

Say "==> 5/5 在 cordis.patch.yml 追加激活行"
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
if (-not (Test-Path $patchFile)) { Fail "找不到 $patchFile" }
Copy-Item $patchFile "$patchFile.bak-pad-kit" -Force
$text = [System.IO.File]::ReadAllText($patchFile)
if ($text -match '(?m)^\s*-\s*id:\s*pad-kit\s*$') {
  Say "    已存在 pad-kit 行，跳过"
} else {
  $block = @"

# dsh-pad-kit：平板上跑 DSH + 电脑 SSH 远程管理
- insert:
    - id: pad-kit
      name: '$pkgName'
      config:
        httpPort: 8090
        apkName: termux.apk
        timeoutMs: 120000
"@
  [System.IO.File]::WriteAllText($patchFile, ($text.TrimEnd() + $block + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Say "    已追加"
}

Write-Host ''
Write-Host '完成。还有两步是必须人工做的：' -ForegroundColor Green
Write-Host '  1) 重启 DSH（新增插件行不会热加载），重启后工具列表里会出现 17 个 tablet_* 工具'
Write-Host '  2) 首次装平板时，防火墙要放行一次 8090（会弹窗，选「允许」）'
Write-Host ''
Write-Host '下一步：在 DSH 里调用 tablet_install_page，按返回的地址在平板上操作。'
