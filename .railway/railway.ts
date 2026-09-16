import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const Axon = service("Axon", {
    // Source of truth: GitHub. Root Dockerfile is picked up automatically.
    source: github("danielamodu/Axon", { branch: "main" }),
    start: "npm --workspace=@axon/dashboard run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 300,
    replicas: { "ams": 1 },
    networking: { privateNetworkEndpoint: "axon" },
    env: { AXON_REGISTRY_ADDRESS: preserve(), BASE_REGISTRY_CHAIN_ID: preserve(), BASE_REGISTRY_PRIVATE_KEY: preserve(), BASE_RPC_URL: preserve(), BASE_SEPOLIA_RPC_URL: preserve(), DATABASE_URL: preserve(), DEPLOYER_PRIVATE_KEY: preserve(), ETH_RPC_URL: preserve(), KEEPERHUB_API_KEY: preserve(), SKY_CHIEF_ADDRESS: preserve(), WEBHOOK_SERVER_PORT: preserve() },
  });

  // Watcher: full pipeline (watch + project + conflict + execute + webhooks).
  // OBSERVE MODE: no KEEPERHUB_API_KEY, so execution is simulation-only
  // (dry-run rows, no onchain txs, no registry proofs). Add the key to go live.
  // PORT/WEBHOOK_SERVER_PORT pinned to 3001 so the public domain reaches the
  // webhook server (KeeperHub callbacks + /health).
  const AxonWatcher = service("AxonWatcher", {
    source: github("danielamodu/Axon", { branch: "main" }),
    start: "npm --workspace=packages/watcher run start",
    healthcheck: "/health",
    healthcheckTimeout: 300,
    replicas: { "ams": 1 },
    networking: { privateNetworkEndpoint: "axon-watcher" },
    env: {
      DATABASE_URL: preserve(),
      ETH_RPC_URL: preserve(),
      BASE_RPC_URL: preserve(),
      BASE_SEPOLIA_RPC_URL: preserve(),
      SKY_CHIEF_ADDRESS: preserve(),
      AXON_REGISTRY_ADDRESS: preserve(),
      BASE_REGISTRY_CHAIN_ID: preserve(),
      BASE_REGISTRY_PRIVATE_KEY: preserve(),
      DEPLOYER_PRIVATE_KEY: preserve(),
      DISCORD_WEBHOOK_URL: preserve(),
      AXON_WEBHOOK_BASE_URL: preserve(),
      KEEPERHUB_API_KEY: preserve(),
      PORT: "3001",
      WEBHOOK_SERVER_PORT: "3001",
    },
  });

  return project("Axon", {
    resources: [Axon, AxonWatcher],
  });
});
