// Vitest setup: unit tests must be hermetic. Live credentials that happen to
// sit in .env files (repo root or package dir, auto-loaded by vitest) would
// otherwise turn pure unit tests into integration tests that hit real
// networks — slow, flaky, and (for writes) dangerous.
for (const key of [
  'KEEPERHUB_API_KEY',
  'BASE_REGISTRY_PRIVATE_KEY',
  'DEPLOYER_PRIVATE_KEY',
  'DISCORD_WEBHOOK_URL',
  'AXON_REGISTRY_ENDPOINT',
  'X402_GATEWAY_URL',
  'X402_FACILITATOR_URL',
]) {
  delete process.env[key]
}
