import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHmac } from 'crypto';
import { prisma } from '../services/prisma.service';

const TelegramAuthSchema = z.object({
  initData: z.string().min(1),
});

const DevAuthSchema = z.object({
  username: z.string().min(1),
});

/**
 * Validates Telegram Mini App initData HMAC signature.
 * Returns parsed user object or throws on invalid data.
 */
function validateTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing hash');

  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (expectedHash !== hash) throw new Error('Invalid hash');

  const authDate = parseInt(params.get('auth_date') ?? '0', 10);
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age > 86400) throw new Error('initData expired');

  const userJson = params.get('user');
  if (!userJson) throw new Error('Missing user');
  return JSON.parse(userJson) as { id: number; username?: string; first_name?: string };
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /auth/telegram
   * Авторизация через Telegram Mini App.
   * Принимает initData, валидирует HMAC подпись через бот-токен.
   */
  app.post('/auth/telegram', async (request, reply) => {
    const { initData } = TelegramAuthSchema.parse(request.body);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return reply.code(503).send({ error: 'Telegram bot token not configured' });
    }

    let tgUser: { id: number; username?: string; first_name?: string };
    try {
      tgUser = validateTelegramInitData(initData, botToken);
    } catch (err: any) {
      return reply.code(401).send({ error: `Invalid initData: ${err.message}` });
    }

    const telegramId = String(tgUser.id);

    let user = await prisma.user.findUnique({
      where: { telegramId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          username: tgUser.username,
          firstName: tgUser.first_name,
        },
      });
    } else if (tgUser.username && user.username !== tgUser.username) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { username: tgUser.username, firstName: tgUser.first_name },
      });
    }

    const token = app.jwt.sign(
      { userId: user.id },
      { expiresIn: '30d' }
    );

    return reply.send({
      token,
      user: {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
      },
    });
  });

  /**
   * POST /auth/dev
   * Упрощённая авторизация для разработки и тестирования без Telegram
   */
  app.post('/auth/dev', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.code(403).send({ error: 'Not available in production' });
    }

    const body = DevAuthSchema.parse(request.body);

    let user = await prisma.user.findFirst({
      where: { username: body.username },
    });

    if (!user) {
      user = await prisma.user.create({
        data: { username: body.username, firstName: body.username },
      });
    }

    const token = app.jwt.sign(
      { userId: user.id },
      { expiresIn: '7d' }
    );

    return reply.send({
      token,
      user: { id: user.id, username: user.username },
    });
  });
}
