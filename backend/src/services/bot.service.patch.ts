// Патч для временного отключения загрузки сессий из БД
export function patchBotService() {
  // Находим функцию ensureSessionsLoaded и модифицируем её
  const fs = require('fs');
  const path = require('path');
  
  const filePath = path.join(__dirname, 'bot.service.ts');
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Заменяем блок загрузки сессий
  const oldCode = `async function ensureSessionsLoaded() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    const users = await prisma.user.findMany({
      where: { sessionData: { not: null } },
      select: { telegramId: true, sessionData: true }
    });
    for (const user of users) {
      if (user.telegramId && user.sessionData) {
        try {
          const session = JSON.parse(user.sessionData as string);
          bot.contexts.set(Number(user.telegramId), session);
        } catch (e) {
          console.warn(\`[Bot] Failed to parse session for user \${user.telegramId}\`, e);
        }
      }
    }
    console.log(\`[Bot] Loaded \${users.length} sessions from DB\`);
  } catch (error) {
    console.error('[Bot] Failed to load sessions from DB:', error);
  }
}`;

  const newCode = `async function ensureSessionsLoaded() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  console.log('[Bot] Session loading disabled (dev mode)');
  // Временно отключаем загрузку из БД для разработки
  return;
}`;

  content = content.replace(oldCode, newCode);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Патч применён: отключена загрузка сессий из БД');
}
