import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { createApiRouter } from "./api";
import {
  buildProtocolId,
  comparePassword,
  generateApiKeyValue,
  getBearerToken,
  hashPassword,
  isValidAddress,
  maskApiKey,
  validateEmail,
  validatePassword,
} from "./auth";

describe("auth helpers", () => {
  it("validates email format", () => {
    expect(validateEmail("ops@protocol.xyz")).toBe(true);
    expect(validateEmail("  ops@protocol.xyz  ")).toBe(true);
    expect(validateEmail("not-an-email")).toBe(false);
    expect(validateEmail("a@b")).toBe(false);
    expect(validateEmail("")).toBe(false);
    expect(validateEmail(undefined)).toBe(false);
  });

  it("enforces min 8 char passwords with boundary checks", () => {
    expect(validatePassword("12345678").valid).toBe(true);
    expect(validatePassword("1234567").valid).toBe(false);
    expect(validatePassword("short").valid).toBe(false);
    expect(validatePassword("").valid).toBe(false);
    expect(validatePassword(undefined).valid).toBe(false);
  });

  it("validates 0x contract addresses", () => {
    expect(isValidAddress("0x0a3f6849f78076aefaDf113F5BED87720274dDC0")).toBe(true);
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("")).toBe(false);
    expect(isValidAddress("not-an-address")).toBe(false);
  });

  it("masks API keys showing last 4 chars only", () => {
    const masked = maskApiKey("axon_live_abcdef1234567890");
    expect(masked).toBe("axon_live_...7890");
    expect(masked).not.toContain("abcdef");
    expect(maskApiKey("")).toBe("axon_live_...");
  });

  it("generates unique axon_live_ keys", () => {
    const a = generateApiKeyValue();
    const b = generateApiKeyValue();
    expect(a.startsWith("axon_live_")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("builds URL-safe protocol ids", () => {
    expect(buildProtocolId("Sky Protocol!")).toBe("sky-protocol");
    expect(buildProtocolId("")).toBe("protocol");
  });

  it("hashes and verifies passwords with bcrypt", async () => {
    const hash = await hashPassword("correct-horse-8");
    expect(hash).not.toBe("correct-horse-8");
    expect(await comparePassword("correct-horse-8", hash)).toBe(true);
    expect(await comparePassword("wrong-password", hash)).toBe(false);
  });

  it("salts hashes so identical passwords differ", async () => {
    const a = await hashPassword("same-password-1");
    const b = await hashPassword("same-password-1");
    expect(a).not.toBe(b);
    expect(await comparePassword("same-password-1", a)).toBe(true);
    expect(await comparePassword("same-password-1", b)).toBe(true);
  });

  it("comparePassword returns false for garbage hashes", async () => {
    expect(await comparePassword("anything", "not-a-hash")).toBe(false);
  });

  it("generates 32-hex-char suffixed keys", () => {
    expect(generateApiKeyValue()).toMatch(/^axon_live_[0-9a-f]{32}$/);
  });

  it("truncates protocol ids to 32 chars", () => {
    expect(buildProtocolId("a".repeat(50)).length).toBeLessThanOrEqual(32);
  });

  it("parses bearer tokens case-insensitively", () => {
    const req = (h?: string) => ({ headers: h ? { authorization: h } : {} }) as any;
    expect(getBearerToken(req("Bearer abc123"))).toBe("abc123");
    expect(getBearerToken(req("bearer abc123"))).toBe("abc123");
    expect(getBearerToken(req())).toBeNull();
    expect(getBearerToken(req(""))).toBeNull();
  });
});

describe("auth + watcher HTTP endpoints (no-DB paths)", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", createApiRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it("POST /auth/signup rejects missing org name with 400", async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.xyz", password: "password12" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/signup rejects bad email with 400", async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: "Test", email: "nope", password: "password12" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/signup rejects short password with 400", async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName: "Test", email: "a@b.xyz", password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/signup rejects bad contract address with 400", async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgName: "Test",
        email: "a@b.xyz",
        password: "password12",
        governanceContract: "0x123",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/login rejects empty body with 400", async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /auth/login rejects bogus apiKey with 401", async () => {
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "axon_live_doesnotexist000000" }),
    });
    expect(res.status).toBe(401);
  }, 45000);

  it("GET /auth/me rejects missing key with 401", async () => {
    const res = await fetch(`${base}/auth/me`);
    expect(res.status).toBe(401);
  });

  it("GET /auth/me rejects invalid key with 401", async () => {
    const res = await fetch(`${base}/auth/me`, {
      headers: { Authorization: "Bearer axon_live_invalid000000" },
    });
    expect(res.status).toBe(401);
  }, 45000);

  it("POST /auth/logout returns 200", async () => {
    const res = await fetch(`${base}/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("POST /internal/watch rejects missing body with 400", async () => {
    const res = await fetch(`${base}/internal/watch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("GET /watcher/status rejects unauthenticated with 401", async () => {
    const res = await fetch(`${base}/watcher/status`);
    expect(res.status).toBe(401);
  });

  it("GET /sync/status rejects unauthenticated with 401", async () => {
    const res = await fetch(`${base}/sync/status`);
    expect(res.status).toBe(401);
  });
});
