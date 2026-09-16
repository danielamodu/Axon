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

  return project("Axon", {
    resources: [Axon],
  });
});
