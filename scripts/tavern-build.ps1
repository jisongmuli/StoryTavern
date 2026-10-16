param(
    [ValidateSet('android', 'windows', 'all')][string]$Target = 'android',
    [switch]$Offline,
    [switch]$SkipChecks,
    [string]$SdkPath = $env:ANDROID_SDK_ROOT,
    [string]$KeyStorePath,
    [string]$KeyAlias = 'storytavern'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location $taskRoot
$originalTarget = $env:CHATBOX_BUILD_TARGET
$originalPlatform = $env:CHATBOX_BUILD_PLATFORM
try {
    $localNode = Join-Path $taskRoot '.toolchain/node-v22.16.0-win-x64'
    if (Test-Path -LiteralPath (Join-Path $localNode 'node.exe')) {
        $env:PATH = "$taskRoot\.toolchain\bin;$localNode;" + $env:PATH
    }
    $env:NODE_OPTIONS = '--max-old-space-size=8192'
    function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
    }
    if (!$SkipChecks) {
        Invoke-Checked 'pnpm' @('run', 'check')
        Invoke-Checked 'pnpm' @('exec', 'vitest', 'run', 'src/renderer/tavern/importers.test.ts', 'src/shared/tavern/copy.test.ts', 'src/shared/tavern/memory.test.ts', 'src/shared/tavern/profiles.test.ts', 'src/shared/session/message-forks.test.ts', 'src/renderer/packages/backup/resources.test.ts', 'src/renderer/native/stream-http.test.ts', 'src/renderer/utils/desktop-direct-request.test.ts')
    }
    function Remove-RendererMaps {
        $rendererRoot = [IO.Path]::GetFullPath((Join-Path $taskRoot 'release/app/dist/renderer'))
        Get-ChildItem -LiteralPath $rendererRoot -Recurse -File -Filter '*.map' | ForEach-Object {
            if (!$_.FullName.StartsWith($rendererRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected source-map path' }
            Remove-Item -LiteralPath $_.FullName
        }
    }
    if ($Target -in @('windows', 'all')) {
        $env:CHATBOX_BUILD_TARGET = 'unknown'
        $env:CHATBOX_BUILD_PLATFORM = 'unknown'
        Invoke-Checked 'pnpm' @('run', 'build')
        Remove-RendererMaps
        Invoke-Checked 'pnpm' @('exec', 'electron-builder', '--config', 'electron-builder.tavern.yml', '--win', '--publish', 'never')
    }
    if ($Target -in @('android', 'all')) {
        if (!$SdkPath -and (Test-Path -LiteralPath 'android/local.properties')) {
            $sdkLine = Get-Content -LiteralPath 'android/local.properties' | Where-Object { $_ -match '^sdk.dir=' } | Select-Object -First 1
            if ($sdkLine) { $SdkPath = $sdkLine.Substring(8).Replace('\:', ':').Replace('\\', '\') }
        }
        if (!$SdkPath -or !(Test-Path -LiteralPath $SdkPath)) { throw 'Set ANDROID_SDK_ROOT or pass -SdkPath.' }
        $SdkPath = [IO.Path]::GetFullPath($SdkPath)
        $localJdk = Get-ChildItem -LiteralPath "$taskRoot/.toolchain/jdk21" -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/jlink.exe') } | Select-Object -First 1
        if ($localJdk) { $env:JAVA_HOME = $localJdk.FullName }
        if (!(Test-Path -LiteralPath "$env:JAVA_HOME/bin/jlink.exe")) { throw 'JAVA_HOME must point to a complete JDK 21, including jlink.' }
        $env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
        $env:ANDROID_HOME = $SdkPath
        $env:ANDROID_SDK_ROOT = $SdkPath
        $sdkProperty = 'sdk.dir=' + $SdkPath.Replace('\', '/')
        Set-Content -LiteralPath 'android/local.properties' -Value $sdkProperty -Encoding utf8NoBOM
        $env:CHATBOX_BUILD_TARGET = 'mobile_app'
        $env:CHATBOX_BUILD_PLATFORM = 'android'
        Invoke-Checked 'pnpm' @('run', 'build:renderer')
        Remove-RendererMaps
        Invoke-Checked 'pnpm' @('exec', 'cap', 'sync', 'android')
        $gradleArguments = @('-p', 'android', ':app:assembleRelease', '--console=plain')
        if ($Offline) { $gradleArguments += '--offline' }
        Invoke-Checked '.\android\gradlew.bat' $gradleArguments
        $version = (Get-Content -LiteralPath 'release/app/package.json' -Raw | ConvertFrom-Json).version
        $outputDirectory = Join-Path $taskRoot 'dist-tavern/android'
        New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
        if (!$KeyStorePath) { $KeyStorePath = Join-Path $taskRoot 'private/story-tavern-release.p12' }
        $localSigning = Join-Path $taskRoot 'private/android-signing.json'
        if (!$env:TAVERN_SIGN_PASSWORD -and (Test-Path -LiteralPath $localSigning)) {
            $signing = Get-Content -LiteralPath $localSigning -Raw | ConvertFrom-Json
            $env:TAVERN_SIGN_PASSWORD = $signing.password
            $KeyAlias = $signing.alias
        }
        if (!(Test-Path -LiteralPath $KeyStorePath) -or !$env:TAVERN_SIGN_PASSWORD) { throw 'Release built. Supply -KeyStorePath and TAVERN_SIGN_PASSWORD to sign it.' }
        $unsigned = Join-Path $taskRoot 'android/app/build/outputs/apk/release/app-release-unsigned.apk'
        $aligned = Join-Path $outputDirectory 'aligned.apk'
        $signed = Join-Path $outputDirectory "StoryTavern-$version.apk"
        $buildTools = Join-Path $SdkPath 'build-tools/35.0.0'
        Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-f', '-p', '4', $unsigned, $aligned)
        Invoke-Checked (Join-Path $buildTools 'apksigner.bat') @('sign', '--ks', $KeyStorePath, '--ks-key-alias', $KeyAlias, '--ks-pass', 'env:TAVERN_SIGN_PASSWORD', '--key-pass', 'env:TAVERN_SIGN_PASSWORD', '--out', $signed, $aligned)
        Invoke-Checked (Join-Path $buildTools 'apksigner.bat') @('verify', $signed)
        Write-Output "Signed APK: $signed"
    }
} finally {
    $env:TAVERN_SIGN_PASSWORD = $null
    $env:CHATBOX_BUILD_TARGET = $originalTarget
    $env:CHATBOX_BUILD_PLATFORM = $originalPlatform
    Pop-Location
}
