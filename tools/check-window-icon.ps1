param([string]$Label = 'installed')
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class AlleyWindowIcon {
 [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint msg, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
 [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr window, int index);
}
'@
$targetExe = Join-Path $env:LOCALAPPDATA 'Programs/雨巷来信/雨巷来信.exe'
$target = Get-Process | Where-Object { $_.Path -eq $targetExe -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $target) { throw 'Installed application window not found' }
$outputDir = Join-Path $PSScriptRoot '../release'
$result = @()
foreach ($kind in @(0,1,2)) {
 $iconHandle = [IntPtr]::Zero
 [void][AlleyWindowIcon]::SendMessageTimeout($target.MainWindowHandle,0x7F,[IntPtr]$kind,[IntPtr]::Zero,2,1000,[ref]$iconHandle)
 if ($iconHandle -eq [IntPtr]::Zero) { $iconHandle = [AlleyWindowIcon]::GetClassLongPtr($target.MainWindowHandle, $(if ($kind -eq 1) {-14} else {-34})) }
 if ($iconHandle -eq [IntPtr]::Zero) { $result += [pscustomobject]@{Kind=$kind;Found=$false}; continue }
 $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
 $bitmap = $icon.ToBitmap()
 $file = Join-Path $outputDir ($Label + '-window-icon-' + $kind + '.png')
 $bitmap.Save($file)
 $result += [pscustomobject]@{Kind=$kind;Found=$true;Width=$bitmap.Width;Height=$bitmap.Height;Path=$file}
 $bitmap.Dispose()
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputDir ($Label + '-window-icons.json')) -Encoding utf8
$result | Format-List
