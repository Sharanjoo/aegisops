import { z } from "zod";

export const incidentEventSchema = z
  .object({
    eventId: z.string().uuid(),
    eventType: z.enum([
      "INCIDENT_CREATED",
      "INCIDENT_STATUS_CHANGED"
    ]),
    eventVersion: z.literal(1),
    occurredAt: z.string().datetime({
      offset: true
    }),
    incidentId: z.string().uuid(),
    serviceName: z.string().min(1),
    severity: z.string().min(1),
    status: z.string().min(1),
    previousStatus: z.string().min(1).nullable()
  })
  .strict();

export type IncidentEvent = z.infer<
  typeof incidentEventSchema
>;

export function parseIncidentEvent(
  value: string
): IncidentEvent {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Kafka message contains invalid JSON");
  }

  return incidentEventSchema.parse(parsed);
}