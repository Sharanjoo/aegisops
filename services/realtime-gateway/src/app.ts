import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";
import { createMetrics, type RealtimeMetrics } from "./metrics.js";
import { ConnectionHub } from "./websocket/connection-hub.js";

export interface BuildAppOptions {
  logger?: boolean;
  connectionHub?: ConnectionHub;
  metrics?: RealtimeMetrics;
}

export async function buildApp(
  config: AppConfig,
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app =
    options.logger === false
      ? Fastify({ logger: false })
      : Fastify({
          logger: {
            level: config.logLevel
          }
        });

  const connectionHub =
    options.connectionHub ?? new ConnectionHub();
  const metrics = options.metrics ?? createMetrics();

  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576,
      perMessageDeflate: false
    }
  });

  app.get("/health", async () => {
    return {
      status: "UP",
      service: "realtime-gateway"
    };
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.get(
    "/ws/incidents",
    {
      websocket: true
    },
    (socket, request) => {
      connectionHub.add(socket);
      metrics.websocketClients.set(connectionHub.size);

      app.log.info(
        {
          clientCount: connectionHub.size,
          remoteAddress: request.ip
        },
        "WebSocket client connected"
      );

      socket.once("close", () => {
        metrics.websocketClients.set(connectionHub.size);

        app.log.info(
          {
            clientCount: connectionHub.size
          },
          "WebSocket client disconnected"
        );
      });

      socket.once("error", (error) => {
        metrics.websocketClients.set(connectionHub.size);

        app.log.warn(
          {
            error,
            clientCount: connectionHub.size
          },
          "WebSocket client error"
        );
      });
    }
  );

  return app;
}