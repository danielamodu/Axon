#!/usr/bin/env pwsh
# deploy-registry.ps1
# Usage: .\deploy-registry.ps1 [-Network sepolia|base]

param(
    [ValidateSet('sepolia','base')]
    [string]$Network = 'sepolia'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Load .env
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            $key   = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"')
            [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
    Write-Host "[OK] Loaded .env" -ForegroundColor Green
}

if (-not $env:DEPLOYER_PRIVATE_KEY) {
    Write-Host "[ERROR] DEPLOYER_PRIVATE_KEY is not set in .env. Please set it and rerun." -ForegroundColor Red
    exit 1
}

if (-not $env:DEPLOYER_PRIVATE_KEY.StartsWith('0x')) {
    $env:DEPLOYER_PRIVATE_KEY = "0x$($env:DEPLOYER_PRIVATE_KEY)"
}

$contractsDir = Join-Path $root 'packages\contracts'
$forge = "$env:USERPROFILE\.foundry\bin\forge.exe"

if ($Network -eq 'sepolia') {
    $rpc = if ($env:BASE_SEPOLIA_RPC_URL) { $env:BASE_SEPOLIA_RPC_URL } else { 'https://sepolia.base.org' }
    $chainId = 84532
} else {
    $rpc = if ($env:BASE_RPC_URL) { $env:BASE_RPC_URL } else { 'https://mainnet.base.org' }
    $chainId = 8453
}

Write-Host ""
Write-Host "Deploying AxonRegistry to Base ($Network)" -ForegroundColor Cyan
Write-Host "  RPC:     $rpc"
Write-Host "  Chain:   $chainId"
Write-Host ""

$verifyArgs = @()
if ($env:BASESCAN_API_KEY) {
    $verifyArgs = @('--verify', '--etherscan-api-key', $env:BASESCAN_API_KEY)
    Write-Host "  Verification: enabled" -ForegroundColor Green
} else {
    Write-Host "  Verification: skipped (set BASESCAN_API_KEY to enable)" -ForegroundColor Yellow
}

Push-Location $contractsDir
try {
    $out = & $forge script script/Deploy.s.sol:Deploy --rpc-url $rpc --chain-id $chainId --broadcast @verifyArgs 2>&1
} finally {
    Pop-Location
}

$out | ForEach-Object { Write-Host $_ }

$addressLine = $out | Select-String 'AxonRegistry deployed at:'
if ($addressLine) {
    $addr = ($addressLine -split ':')[-1].Trim()
    Write-Host ""
    Write-Host "[SUCCESS] Deployed AxonRegistry: $addr" -ForegroundColor Green
    Write-Host ""
    Write-Host "Add to .env:" -ForegroundColor Cyan
    Write-Host "  AXON_REGISTRY_ADDRESS=$addr"
    Write-Host "  BASE_REGISTRY_CHAIN_ID=$chainId"
}
