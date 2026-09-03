import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { createMetrics } from "../src/metrics.js";

const testConfig: AppConfig = {
  host: "127.0.0.1",
  port: 8081,
  logLevel: "silent",
  kafkaBrokers: ["localhost:9092"],
  kafkaClientId: "realtime-gateway-test",
  kafkaGroupId: "realtime-gateway-test",
  incidentTopic: "aegisops.incident.events.v1"
};

describe("metrics endpoint", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("serves Prometheus-formatted metrics with the correct content type", async () => {
    const metrics = createMetrics();

    app = await buildApp(testConfig, {
      logger: false,
      metrics
    });

    const response = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      metrics.registry.contentType
    );
    expect(response.body).toContain(
      "aegisops_realtime_gateway_websocket_clients"
    );
  });

  it("does not throw when two apps are built in the same process", async () => {
    const first = await buildApp(testConfig, { logger: false });
    const second = await buildApp(testConfig, { logger: false });

    await first.close();
    await second.close();

    app = undefined;
  });
});

describe("createMetrics", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("tracks connected WebSocket clients as a gauge", async () => {
    const metrics = createMetrics();

    app = await buildApp(testConfig, {
      logger: false,
      metrics
    });

    await app.ready();

    const client = await app.injectWS("/ws/incidents");

    const connected = await metrics.websocketClients.get();
    expect(connected.values[0]?.value).toBe(1);

    client.terminate();

    await expect
      .poll(async () => {
        const afterClose = await metrics.websocketClients.get();
        return afterClose.values[0]?.value;
      })
      .toBe(0);
  });

  it("counts Kafka events, rejections, broadcasts, and deliveries", async () => {
    const metrics = createMetrics();

    metrics.kafkaEventsConsumed.inc({
      event_type: "INCIDENT_CREATED"
    });
    metrics.kafkaMessagesRejected.inc({
      reason: "invalid_payload"
    });
    metrics.websocketBroadcastAttempts.inc();
    metrics.websocketDeliveries.inc(3);

    const [consumed, rejected, attempts, deliveries] =
      await Promise.all([
        metrics.kafkaEventsConsumed.get(),
        metrics.kafkaMessagesRejected.get(),
        metrics.websocketBroadcastAttempts.get(),
        metrics.websocketDeliveries.get()
      ]);

    // Both event types/reasons are pre-registered at 0 (see metrics.ts),
    // so find the specific label combination rather than assuming index 0.
    expect(
      consumed.values.find(
        (value) => value.labels.event_type === "INCIDENT_CREATED"
      )?.value
    ).toBe(1);
    expect(
      consumed.values.find(
        (value) => value.labels.event_type === "INCIDENT_STATUS_CHANGED"
      )?.value
    ).toBe(0);
    expect(
      rejected.values.find(
        (value) => value.labels.reason === "invalid_payload"
      )?.value
    ).toBe(1);
    expect(attempts.values[0]?.value).toBe(1);
    expect(deliveries.values[0]?.value).toBe(3);
  });
});
