export type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

export interface AppConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaGroupId: string;
  incidentTopic: string;
}

const logLevels: ReadonlySet<string> = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent"
]);

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8081");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      "AEGISOPS_GATEWAY_PORT must be an integer between 1 and 65535"
    );
  }

  return port;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const logLevel = value ?? "info";

  if (!logLevels.has(logLevel)) {
    throw new Error(`Unsupported log level: ${logLevel}`);
  }

  return logLevel as LogLevel;
}

function parseBrokers(value: string | undefined): string[] {
  const brokers = (value ?? "localhost:9092")
    .split(",")
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0);

  if (brokers.length === 0) {
    throw new Error(
      "AEGISOPS_KAFKA_BROKERS must contain at least one broker"
    );
  }

  return brokers;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): AppConfig {
  return {
    host: env.AEGISOPS_GATEWAY_HOST ?? "0.0.0.0",
    port: parsePort(env.AEGISOPS_GATEWAY_PORT),
    logLevel: parseLogLevel(env.AEGISOPS_LOG_LEVEL),
    kafkaBrokers: parseBrokers(env.AEGISOPS_KAFKA_BROKERS),
    kafkaClientId:
      env.AEGISOPS_KAFKA_CLIENT_ID ?? "aegisops-realtime-gateway",
    kafkaGroupId:
      env.AEGISOPS_KAFKA_GROUP_ID ?? "aegisops-realtime-gateway-v1",
    incidentTopic:
      env.AEGISOPS_INCIDENT_TOPIC ??
      "aegisops.incident.events.v1"
  };
}