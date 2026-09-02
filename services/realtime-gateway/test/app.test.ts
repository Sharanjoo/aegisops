import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";

const testConfig: AppConfig = {
  host: "127.0.0.1",
  port: 8081,
  logLevel: "silent",
  kafkaBrokers: ["localhost:9092"],
  kafkaClientId: "realtime-gateway-test",
  kafkaGroupId: "realtime-gateway-test",
  incidentTopic: "aegisops.incident.events.v1"
};

describe("realtime gateway", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns a successful health response", async () => {
    app = await buildApp(testConfig, {
      logger: false
    });

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "UP",
      service: "realtime-gateway"
    });
  });
});