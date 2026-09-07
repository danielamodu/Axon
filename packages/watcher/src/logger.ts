import pino from 'pino'

export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'UTC:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      sync: true,
    },
  },
  level: process.env.LOG_LEVEL ?? 'info',
})
