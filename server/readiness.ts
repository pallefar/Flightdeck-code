import type { FastifyInstance } from 'fastify';
import type { RequestAdmission } from './request-admission';

/** Process lifecycle only: this is not provider, identity or deployment verification. */
export function registerReadinessRoute(app: FastifyInstance, admission: RequestAdmission): void {
  app.get('/api/studio/ready', async (_request, reply) => {
    const ready = admission.snapshot().accepting;
    if (!ready) reply.header('Retry-After', '1');
    return reply.header('Cache-Control', 'no-store').code(ready ? 200 : 503).send({
      ready,
      scope: 'request-admission',
    });
  });
}
