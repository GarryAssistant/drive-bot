import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../services/prisma.service';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Middleware: проверяет JWT и добавляет userId в request.
 * Telegram Mini App передаёт initData — в MVP используем упрощённую JWT-авторизацию.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as { userId: string };
    request.userId = payload.userId;
  } catch {
    reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or missing token' });
  }
}
