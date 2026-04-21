import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";

export interface LoggerInit {
  level?: LoggerOptions["level"];
  stream?: DestinationStream;
}

export function createLogger(init: LoggerInit = {}): Logger {
  const options: LoggerOptions = {
    level: init.level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["pin", "*.pin", "users[*].pin", "body.pin"],
      censor: "[Redacted]",
    },
  };
  return init.stream ? pino(options, init.stream) : pino(options);
}
