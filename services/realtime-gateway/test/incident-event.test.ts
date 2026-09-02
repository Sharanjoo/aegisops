import { describe, expect, it } from "vitest";

import {
  parseIncidentEvent
} from "../src/kafka/incident-event.js";

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

describe("incident event parser", () => {
  it("parses a valid version-one incident event", () => {
    const result = parseIncidentEvent(
      JSON.stringify(validEvent)
    );

    expect(result).toEqual(validEvent);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseIncidentEvent("{invalid")).toThrow(
      "Kafka message contains invalid JSON"
    );
  });

  it("rejects an unsupported event version", () => {
    expect(() =>
      parseIncidentEvent(
        JSON.stringify({
          ...validEvent,
          eventVersion: 2
        })
      )
    ).toThrow();
  });

  it("rejects an unsupported event type", () => {
    expect(() =>
      parseIncidentEvent(
        JSON.stringify({
          ...validEvent,
          eventType: "INCIDENT_DELETED"
        })
      )
    ).toThrow();
  });
});