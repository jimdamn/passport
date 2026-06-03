type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  path?: string;
  userId?: string | number;
  error_code?: number;
  message: string;
  [key: string]: unknown;
}

export function createLogger(service: string) {
  return {
    info: (message: string, extra?: Partial<LogEntry>) =>
      log('info', service, message, extra),
    warn: (message: string, extra?: Partial<LogEntry>) =>
      log('warn', service, message, extra),
    error: (message: string, extra?: Partial<LogEntry>) =>
      log('error', service, message, extra),
  };
}

function log(level: LogLevel, service: string, message: string, extra?: Partial<LogEntry>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...extra,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export const logger = createLogger('passport');
