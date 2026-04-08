import 'dotenv/config';
import http from 'http';
import { startBot } from './services/bot.service';
import { prisma } from './services/prisma.service';
import { scheduleDailyReminder, scheduleWeeklyReport } from './services/notification.service';

const PORT = parseInt(process.env.PORT || '3000', 10);
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://your-app.up.railway.app

console.log('🤖 DriveGoal Bot starting...');

async function main() {
  const bot = await startBot();

  if (!bot) {
    console.log('[Bot] Bot not started (no token)');
    startHealthServer();
    return;
  }

  scheduleDailyReminder();
  scheduleWeeklyReport();

  if (WEBHOOK_URL) {
    // ─── Webhook mode (production) ──────────────────────────────────────────
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const webhookPath = `/webhook/${token}`;
    const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;

    await bot.telegram.setWebhook(fullWebhookUrl);
    console.log(`[Bot] Webhook set: ${fullWebhookUrl}`);

    const server = http.createServer(async (req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
        return;
      }

      if (req.method === 'POST' && req.url === webhookPath) {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', async () => {
          try {
            await bot.handleUpdate(JSON.parse(body));
            res.writeHead(200);
            res.end('OK');
          } catch (e) {
            console.error('[Webhook] Error handling update:', e);
            res.writeHead(200); // Always 200 so Telegram does not retry
            res.end('OK');
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(PORT, () => {
      console.log(`[Bot] HTTP server listening on port ${PORT}`);
    });
  } else {
    // ─── Polling mode (local dev fallback) ─────────────────────────────────
    console.log('[Bot] WEBHOOK_URL not set — using polling mode');
    startHealthServer();
    bot.launch({ dropPendingUpdates: true }).catch((err) => {
      console.error('[Bot] Launch error:', err);
    });
  }
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.round(process.uptime()) }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(PORT, () => {
    console.log(`[Bot] Health server on port ${PORT}`);
  });
}

main().catch(console.error);

process.once('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.once('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
