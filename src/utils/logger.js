import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';

// Logger principal (gera JSON puro ideal para Datadog/Splunk/ELK)
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'adp-payroll-api', env: 'local' }
});

// Middleware que loga automaticamente toda requisição HTTP (método, rota, status e tempo de resposta)
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-correlation-id'] || randomUUID()
});