import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import express from "express";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { createApiRouter } from "./server/api";

function axonApiPlugin(): Plugin {
  return {
    name: "axon-api-server",
    configureServer(server: ViteDevServer) {
      const app = express();
      app.use(express.json());
      app.use("/api", createApiRouter());
      server.middlewares.use(app);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), axonApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    host: true,
  },
});
