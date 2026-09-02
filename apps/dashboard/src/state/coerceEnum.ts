/**
 * The realtime gateway only validates severity/status as non-empty strings
 * (see services/realtime-gateway/src/kafka/incident-event.ts), not as
 * members of the incident service's enums. This keeps an out-of-range value
 * from ever reaching a component that assumes a known IncidentSeverity or
 * IncidentStatus, instead falling back to the incident's current value.
 */
export function coerceEnum<T extends string>(
  allowed: readonly T[],
  candidate: string,
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(candidate)
    ? (candidate as T)
    : fallback
}
