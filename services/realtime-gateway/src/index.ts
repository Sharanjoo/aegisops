import {
  Kafka,
  logLevel as kafkaLogLevel
} from "kafkajs";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { IncidentEventConsumer } from "./kafka/incident-consumer.js";
import { ConnectionHub } from "./websocket/connection-hub.js";

const config = loadConfig();
const connectionHub = new ConnectionHub();

const app = await buildApp(config, {
  connectionHub
});

const kafka = new Kafka({
  clientId: config.kafkaClientId,
  brokers: config.kafkaBrokers,
  logLevel: kafkaLogLevel.WARN
});

const incidentConsumer = new IncidentEventConsumer(
  kafka.consumer({
    groupId: config.kafkaGroupId
  }),
  config.incidentTopic,
  connectionHub,
  app.log
);

let shuttingDown = false;

async function shutdown(
  signal: NodeJS.Signals
): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  app.log.info(
    {
      signal
    },
    "shutdown requested"
  );

  const results = await Promise.allSettled([
    incidentConsumer.stop(),
    app.close()
  ]);

  const failures = results.filter(
    (result) => result.status === "rejected"
  );

  if (failures.length > 0) {
    app.log.error(
      {
        failures
      },
      "graceful shutdown failed"
    );

    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await incidentConsumer.start();

  await app.listen({
    host: config.host,
    port: config.port
  });

  app.log.info(
    {
      topic: config.incidentTopic,
      brokers: config.kafkaBrokers
    },
    "realtime gateway started"
  );
} catch (error) {
  app.log.error(
    {
      error
    },
    "realtime gateway failed to start"
  );

  await Promise.allSettled([
    incidentConsumer.stop(),
    app.close()
  ]);

  process.exitCode = 1;
}
