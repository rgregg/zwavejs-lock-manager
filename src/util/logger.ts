import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

export interface LoggerInit {
  level?: LoggerOptions["level"];
  stream?: DestinationStream;
}

export function createLogger(init: LoggerInit = {}): Logger {
  // Treat an empty/whitespace LOG_LEVEL as unset: e.g. the HA add-on's
  // `bashio::config` can resolve to "" and pino rejects a blank level.
  const envLevel = process.env.LOG_LEVEL?.trim() || undefined;
  const options: LoggerOptions = {
    level: init.level ?? envLevel ?? "info",
    redact: {
      paths: ["pin", "*.pin", "users[*].pin", "body.pin"],
      censor: "[Redacted]",
    },
  };
  return init.stream ? pino(options, init.stream) : pino(options);
}
