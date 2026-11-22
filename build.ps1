# Build OrangeDisk launcher + full installer + update package
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$csc  = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'csc.exe not found' }

$node = 'D:\xz\dsh-node\node.exe'
if (-not (Test-Path $node)) { $node = Join-Path $root 'node.exe' }
if (-not (Test-Path $node)) { throw 'node.exe not found' }

# version is read from the C# source so the two never drift
$version = (Select-String -Path (Join-Path $root 'src\OrangeDisk.cs') -Pattern 'const string Version = "([0-9.]+)"').Matches[0].Groups[1].Value
if (-not $version) { throw 'version not found in src\OrangeDisk.cs' }
Write-Host ('version: ' + $version)

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

function Compile-App {
  param([string]$Out, [string[]]$Defines, [string]$Resource)
  $cscArgs = @(
    '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/codepage:65001',
    ('/win32icon:' + (Join-Path $root 'icon.ico')),
    ('/out:' + $Out)
  ) + $refs
  foreach ($d in $Defines) { $cscArgs += ('/define:' + $d) }
  if ($Resource) { $cscArgs += ('/resource:' + $Resource) }
  $cscArgs += (Join-Path $root 'src\OrangeDisk.cs')
  & $csc @cscArgs
  if ($LASTEXITCODE -ne 0) { throw ('compile failed: ' + $Out) }
}

Write-Host '== compile launcher =='
Compile-App -Out (Join-Path $dist 'OrangeDisk.exe') -Defines @()

Write-Host '== stage full payload =='
$payload = Join-Path $dist 'payload'
New-Item -ItemType Directory -Path $payload | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payload 'app') | Out-Null

Copy-Item $node (Join-Path $payload 'node.exe')
Copy-Item (Join-Path $root 'icon.ico') (Join-Path $payload 'icon.ico')
Copy-Item (Join-Path $dist 'OrangeDisk.exe') (Join-Path $payload 'OrangeDisk.exe')
Copy-Item (Join-Path $root 'server.mjs') (Join-Path $payload 'app\server.mjs')
Copy-Item (Join-Path $root 'public') (Join-Path $payload 'app\public') -Recurse

Write-Host '== stage update payload (app files only) =='
$update = Join-Path $dist 'update'
New-Item -ItemType Directory -Path (Join-Path $update 'app') -Force | Out-Null
Copy-Item (Join-Path $root 'server.mjs') (Join-Path $update 'app\server.mjs')
Copy-Item (Join-Path $root 'public') (Join-Path $update 'app\public') -Recurse

Write-Host '== compress payloads =='
Add-Type -AssemblyName System.IO.Compression.FileSystem
$level = [System.IO.Compression.CompressionLevel]::Optimal
$zipFull = Join-Path $dist 'payload.zip'
$zipUpdate = Join-Path $dist 'update.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($payload, $zipFull, $level, $false)
[System.IO.Compression.ZipFile]::CreateFromDirectory($update, $zipUpdate, $level, $false)

Write-Host '== compile installer =='
$setup = Join-Path $dist ('OrangeDisk-Setup-' + $version + '.exe')
Compile-App -Out $setup -Defines @('INSTALLER') -Resource ($zipFull + ',payload.zip')

Write-Host '== compile update package =='
$updateExe = Join-Path $dist ('OrangeDisk-Update-1.1.0-to-' + $version + '.exe')
Compile-App -Out $updateExe -Defines @('INSTALLER', 'UPDATER') -Resource ($zipUpdate + ',payload.zip')

Get-ChildItem $dist -File | Where-Object { $_.Extension -eq '.exe' } |
  Select-Object Name, @{n = 'MB'; e = { [Math]::Round($_.Length / 1MB, 1) } } |
  Format-Table -AutoSize | Out-String | Write-Host

Write-Host ('setup  : ' + $setup)
Write-Host ('update : ' + $updateExe)
