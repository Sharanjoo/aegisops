import type {
    Consumer,
    EachMessagePayload
  } from "kafkajs";
  import {
    beforeEach,
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    IncidentEventConsumer
  } from "../src/kafka/incident-consumer.js";

  const topic = "aegisops.incident.events.v1";

  const validEvent = {
    eventId: "531bb2bd-5d6f-49c8-8348-455d8fcbe43a",
    eventType: "INCIDENT_CREATED",
    eventVersion: 1,
    occurredAt: "2026-09-02T20:00:00Z",
    incidentId: "cb28d76e-c55a-4b18-aeda-1af5c2e181bf",
    serviceName: "cluster-agent-demo",
    severity: "HIGH",
    status: "OPEN",
    previousStatus: null
  };

  function createPayload(
    value: string | null
  ): EachMessagePayload {
    return {
      topic,
      partition: 1,
      message: {
        key: Buffer.from(validEvent.incidentId),
        value:
          value === null
            ? null
            : Buffer.from(value),
        timestamp: "1788380000000",
        attributes: 0,
        offset: "42"
      }
    } as EachMessagePayload;
  }

  describe("Kafka incident consumer", () => {
    let eachMessageHandler:
      | ((
          payload: EachMessagePayload
        ) => Promise<void>)
      | undefined;

    const connect = vi.fn();
    const subscribe = vi.fn();
    const run = vi.fn();
    const disconnect = vi.fn();
    const broadcast = vi.fn();

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    beforeEach(() => {
      vi.clearAllMocks();

      eachMessageHandler = undefined;

      connect.mockResolvedValue(undefined);
      subscribe.mockResolvedValue(undefined);
      disconnect.mockResolvedValue(undefined);
      broadcast.mockReturnValue(2);

      run.mockImplementation(
        async (config: {
          eachMessage?: (
            payload: EachMessagePayload
          ) => Promise<void>;
        }) => {
          eachMessageHandler = config.eachMessage;
        }
      );
    });

    function createConsumer(): IncidentEventConsumer {
      const kafkaConsumer = {
        connect,
        subscribe,
        run,
        disconnect
      } as unknown as Consumer;

      return new IncidentEventConsumer(
        kafkaConsumer,
        topic,
        {
          broadcast
        },
        logger
      );
    }

    it("subscribes and broadcasts valid events", async () => {
      const consumer = createConsumer();

      await consumer.start();

      expect(connect).toHaveBeenCalledOnce();
      expect(subscribe).toHaveBeenCalledWith({
        topic,
        fromBeginning: false
      });

      if (eachMessageHandler === undefined) {
        throw new Error(
          "Kafka eachMessage handler was not registered"
        );
      }

      await eachMessageHandler(
        createPayload(JSON.stringify(validEvent))
      );

      expect(broadcast).toHaveBeenCalledWith(validEvent);

      await consumer.stop();

      expect(disconnect).toHaveBeenCalledOnce();
    });

    it("ignores invalid events without broadcasting", async () => {
      const consumer = createConsumer();

      await consumer.start();

      if (eachMessageHandler === undefined) {
        throw new Error(
          "Kafka eachMessage handler was not registered"
        );
      }

      await eachMessageHandler(
        createPayload("{invalid")
      );

      expect(broadcast).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("ignores messages with empty values", async () => {
      const consumer = createConsumer();

      await consumer.start();

      if (eachMessageHandler === undefined) {
        throw new Error(
          "Kafka eachMessage handler was not registered"
        );
      }

      await eachMessageHandler(createPayload(null));

      expect(broadcast).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });