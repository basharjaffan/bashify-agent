import pino from 'pino';
export const logger = pino({
    level: 'debug',
    transport: process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: { colorize: true }
        }
});
