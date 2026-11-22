$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# rounded square background
$r = 58
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
$path.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
$path.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
$path.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
$path.CloseFigure()

$c1 = [System.Drawing.Color]::FromArgb(255, 255, 186, 120)
$c2 = [System.Drawing.Color]::FromArgb(255, 243, 105, 16)
$p1 = New-Object System.Drawing.Point 0, 0
$p2 = New-Object System.Drawing.Point $size, $size
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $p1, $p2, $c1, $c2
$g.FillPath($brush, $path)

# white ring
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 26
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($pen, 62, 62, 132, 132, -90, 292)

# center dot
$dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.FillEllipse($dot, 114, 114, 28, 28)

$g.Dispose()

$png = Join-Path $env:TEMP 'orange-disk-icon.png'
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# pack PNG into ICO
$pngBytes = [System.IO.File]::ReadAllBytes($png)
$icoPath = Join-Path $PSScriptRoot 'icon.ico'
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Close()

"icon written: $icoPath ($([Math]::Round((Get-Item $icoPath).Length / 1KB, 1)) KB)"
