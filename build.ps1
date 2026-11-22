# Build OrangeDisk launcher + self-extracting installer
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$csc  = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'csc.exe not found' }

$node = 'D:\xz\dsh-node\node.exe'
if (-not (Test-Path $node)) { $node = Join-Path $root 'node.exe' }
if (-not (Test-Path $node)) { throw 'node.exe not found' }

Write-Host '== clean =='
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

$refs = @(
  '/r:System.dll',
  '/r:System.Core.dll',
  '/r:System.Drawing.dll',
  '/r:System.Windows.Forms.dll',
  '/r:System.Management.dll',
  '/r:System.IO.Compression.dll',
  '/r:System.IO.Compression.FileSystem.dll'
)

Write-Host '== compile launcher =='
$launcherArgs = @(
  '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/codepage:65001',
  ('/win32icon:' + (Join-Path $root 'icon.ico')),
  ('/out:' + (Join-Path $dist 'OrangeDisk.exe'))
) + $refs + @(Join-Path $root 'src\OrangeDisk.cs')

& $csc @launcherArgs
if ($LASTEXITCODE -ne 0) { throw 'launcher compile failed' }

Write-Host '== stage payload =='
$payload = Join-Path $dist 'payload'
New-Item -ItemType Directory -Path $payload | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payload 'app') | Out-Null

Copy-Item $node (Join-Path $payload 'node.exe')
Copy-Item (Join-Path $root 'icon.ico') (Join-Path $payload 'icon.ico')
Copy-Item (Join-Path $dist 'OrangeDisk.exe') (Join-Path $payload 'OrangeDisk.exe')
Copy-Item (Join-Path $root 'server.mjs') (Join-Path $payload 'app\server.mjs')
Copy-Item (Join-Path $root 'public') (Join-Path $payload 'app\public') -Recurse

Write-Host '== compress payload =='
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $dist 'payload.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $payload, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '== compile installer =='
$setup = Join-Path $dist ('OrangeDisk-Setup-' + '1.1.0' + '.exe')
$installerArgs = @(
  '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/codepage:65001',
  '/define:INSTALLER',
  ('/win32icon:' + (Join-Path $root 'icon.ico')),
  ('/resource:' + $zipPath + ',payload.zip'),
  ('/out:' + $setup)
) + $refs + @(Join-Path $root 'src\OrangeDisk.cs')

& $csc @installerArgs
if ($LASTEXITCODE -ne 0) { throw 'installer compile failed' }

Get-ChildItem $dist -File | Where-Object { $_.Extension -eq '.exe' -or $_.Extension -eq '.zip' } |
  Select-Object Name, @{n = 'MB'; e = { [Math]::Round($_.Length / 1MB, 1) } } |
  Format-Table -AutoSize | Out-String | Write-Host

Write-Host ('installer: ' + $setup)
