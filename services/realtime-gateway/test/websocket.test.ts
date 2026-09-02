import { once } from "node:events";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { ConnectionHub } from "../src/websocket/connection-hub.js";

const testConfig: AppConfig = {
  host: "127.0.0.1",
  port: 8081,
  logLevel: "silent",
  kafkaBrokers: ["localhost:9092"],
  kafkaClientId: "realtime-gateway-test",
  kafkaGroupId: "realtime-gateway-test",
  incidentTopic: "aegisops.incident.events.v1"
};

describe("incident WebSocket endpoint", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("broadcasts incident events to connected clients", async () => {
    const connectionHub = new ConnectionHub();

    app = await buildApp(testConfig, {
      logger: false,
      connectionHub
    });

    await app.ready();

    const client = await app.injectWS("/ws/incidents");

    expect(connectionHub.size).toBe(1);

    const event = {
      eventType: "incident.created",
      incidentId: "incident-test-1",
      status: "OPEN"
    };

    const receivedMessage = once(client, "message");

    const delivered = connectionHub.broadcast(event);
    const [data] = await receivedMessage;

    expect(delivered).toBe(1);
    expect(JSON.parse(data.toString())).toEqual(event);

    const closed = once(client, "close");

    client.terminate();
    await closed;

    await expect
      .poll(
        () => connectionHub.size,
        {
          timeout: 2_000
        }
      )
      .toBe(0);
  });
});