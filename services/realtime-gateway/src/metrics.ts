import { Counter, Gauge, Registry } from "@prometheus-io/client";

export interface RealtimeMetrics {
  registry: Registry;
  kafkaEventsConsumed: Counter<"event_type">;
  kafkaMessagesRejected: Counter<"reason">;
  kafkaProcessingFailures: Counter;
  websocketBroadcastAttempts: Counter;
  websocketDeliveries: Counter;
  websocketClients: Gauge;
}

/**
 * A fresh Registry per call - never the package's shared default export -
 * so building the app multiple times (once per test) never hits Prometheus
 * client's "metric already registered" error.
 */
export function createMetrics(): RealtimeMetrics {
  const registry = new Registry();

  const kafkaEventsConsumed = new Counter({
    name: "aegisops_realtime_gateway_kafka_events_consumed_total",
    help: "Valid Kafka incident events consumed and broadcast, by event type.",
    labelNames: ["event_type"],
    registers: [registry]
  });

  const kafkaMessagesRejected = new Counter({
    name: "aegisops_realtime_gateway_kafka_messages_rejected_total",
    help: "Kafka messages rejected as empty or invalid, by reason.",
    labelNames: ["reason"],
    registers: [registry]
  });

  const kafkaProcessingFailures = new Counter({
    name: "aegisops_realtime_gateway_kafka_processing_failures_total",
    help: "Unexpected errors while processing a Kafka message, outside normal validation rejection.",
    registers: [registry]
  });

  const websocketBroadcastAttempts = new Counter({
    name: "aegisops_realtime_gateway_websocket_broadcast_attempts_total",
    help: "Attempts to broadcast a valid incident event to connected WebSocket clients.",
    registers: [registry]
  });

  const websocketDeliveries = new Counter({
    name: "aegisops_realtime_gateway_websocket_deliveries_total",
    help: "Individual WebSocket client deliveries that succeeded.",
    registers: [registry]
  });

  const websocketClients = new Gauge({
    name: "aegisops_realtime_gateway_websocket_clients",
    help: "Currently connected WebSocket clients.",
    registers: [registry]
  });

  // Registers every bounded label value at 0 immediately, rather than
  // only after that event type/reason first occurs - so these counters
  // are visible on the very first Prometheus scrape.
  for (const eventType of [
    "INCIDENT_CREATED",
    "INCIDENT_STATUS_CHANGED"
  ]) {
    kafkaEventsConsumed.inc({ event_type: eventType }, 0);
  }

  for (const reason of ["empty_value", "invalid_payload"]) {
    kafkaMessagesRejected.inc({ reason }, 0);
  }

  return {
    registry,
    kafkaEventsConsumed,
    kafkaMessagesRejected,
    kafkaProcessingFailures,
    websocketBroadcastAttempts,
    websocketDeliveries,
    websocketClients
  };
}
