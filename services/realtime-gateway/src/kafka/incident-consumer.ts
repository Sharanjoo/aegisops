import type {
  Consumer,
  EachMessagePayload
} from "kafkajs";

import { parseIncidentEvent } from "./incident-event.js";
import type { RealtimeMetrics } from "../metrics.js";

export interface EventBroadcaster {
  broadcast(payload: unknown): number;
}

export interface ConsumerLogger {
  info(
    context: Record<string, unknown>,
    message: string
  ): void;

  warn(
    context: Record<string, unknown>,
    message: string
  ): void;

  error(
    context: Record<string, unknown>,
    message: string
  ): void;
}

/** Only the meters this consumer actually touches - a RealtimeMetrics satisfies this. */
export type ConsumerMetrics = Pick<
  RealtimeMetrics,
  | "kafkaEventsConsumed"
  | "kafkaMessagesRejected"
  | "kafkaProcessingFailures"
  | "websocketBroadcastAttempts"
  | "websocketDeliveries"
>;

export class IncidentEventConsumer {
  private started = false;

  constructor(
    private readonly consumer: Consumer,
    private readonly topic: string,
    private readonly broadcaster: EventBroadcaster,
    private readonly logger: ConsumerLogger,
    private readonly metrics?: ConsumerMetrics
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.consumer.connect();

    try {
      await this.consumer.subscribe({
        topic: this.topic,
        fromBeginning: false
      });

      await this.consumer.run({
        eachMessage: async (
          payload: EachMessagePayload
        ): Promise<void> => {
          this.handleMessage(payload);
        }
      });

      this.started = true;

      this.logger.info(
        {
          topic: this.topic
        },
        "Kafka incident consumer started"
      );
    } catch (error) {
      try {
        await this.consumer.disconnect();
      } catch (disconnectError) {
        this.logger.error(
          {
            error: disconnectError
          },
          "Kafka consumer cleanup failed"
        );
      }

      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    try {
      await this.consumer.disconnect();

      this.logger.info(
        {
          topic: this.topic
        },
        "Kafka incident consumer stopped"
      );
    } finally {
      this.started = false;
    }
  }

  private handleMessage({
    topic,
    partition,
    message
  }: EachMessagePayload): void {
    // Outer boundary: unexpected errors outside normal validation
    // rejection (e.g. a broadcaster failure) - a distinct metric from the
    // expected-rejection path below, and never silently swallowed.
    try {
      if (message.value === null) {
        this.metrics?.kafkaMessagesRejected.inc({
          reason: "empty_value"
        });

        this.logger.warn(
          {
            topic,
            partition,
            offset: message.offset
          },
          "Ignoring Kafka message with an empty value"
        );

        return;
      }

      let event;

      try {
        event = parseIncidentEvent(
          message.value.toString("utf8")
        );
      } catch (error) {
        this.metrics?.kafkaMessagesRejected.inc({
          reason: "invalid_payload"
        });

        this.logger.warn(
          {
            error,
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString("utf8")
          },
          "Ignoring invalid incident event"
        );

        return;
      }

      this.metrics?.kafkaEventsConsumed.inc({
        event_type: event.eventType
      });
      this.metrics?.websocketBroadcastAttempts.inc();

      const clientCount =
        this.broadcaster.broadcast(event);

      this.metrics?.websocketDeliveries.inc(clientCount);

      this.logger.info(
        {
          eventId: event.eventId,
          eventType: event.eventType,
          incidentId: event.incidentId,
          topic,
          partition,
          offset: message.offset,
          clientCount
        },
        "Incident event broadcast to WebSocket clients"
      );
    } catch (error) {
      this.metrics?.kafkaProcessingFailures.inc();

      this.logger.error(
        {
          error,
          topic,
          partition,
          offset: message.offset
        },
        "Unexpected error while processing Kafka message"
      );
    }
  }
}
