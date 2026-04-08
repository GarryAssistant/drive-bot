import { Telegraf, Markup, Context } from 'telegraf';
import { prisma } from './prisma.service';
import { analyzeEntry, suggestSubcategories, generateWeeklyReport, SuggestedSubcategory } from './ai.service';
import { updateStreak } from './streak.service';

// Admin Telegram IDs (добавь своё)
const ADMIN_IDS: string[] = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean);

// ─── Session (in-memory) ───────────────────────────────────────────────────

interface SessionData {
  state: 'idle'
    | 'awaiting_about'
    | 'awaiting_car_model'
    | 'awaiting_car_price'
    | 'awaiting_income'
    | 'awaiting_life_areas'
    | 'awaiting_strategy'
    | 'awaiting_goal_title'
    | 'awaiting_goal_deadline'
    | 'awaiting_custom_deadline'
    | 'confirming_subcategories'
    | 'awaiting_edit_subcategories'
    | 'awaiting_entry_text'
    | 'awaiting_feedback';
  goalTitle?: string;
  goalDeadline?: Date;
  suggestedSubcategories?: SuggestedSubcategory[];
  // Онбординг
  about?: string;
  carModel?: string;
  carPrice?: string;
  income?: string;
  lifeAreas?: string[];
  strategy?: string;
}

const sessions = new Map<number, SessionData>();

// Load all sessions from DB on startup (runs once)
let sessionsLoaded = false;
async function ensureSessionsLoaded() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  try {
    const users = await prisma.user.findMany({
      select: { telegramId: true, sessionData: true },
    });
    for (const u of users) {
      if (u.telegramId && u.sessionData) {
        const tgId = parseInt(u.telegramId, 10);
        if (!isNaN(tgId)) sessions.set(tgId, u.sessionData as unknown as SessionData);
      }
    }
    console.log(`[Bot] Loaded ${users.length} sessions from DB`);
  } catch (e) {
    console.error('[Bot] Failed to load sessions from DB:', e);
  }
}

function getSession(userId: number): SessionData {
  if (!sessions.has(userId)) sessions.set(userId, { state: 'idle' });
  return sessions.get(userId)!;
}

function setSession(userId: number, data: Partial<SessionData>): void {
  const updated = { ...getSession(userId), ...data };
  sessions.set(userId, updated);
  // Persist to DB async (fire-and-forget)
  prisma.user.updateMany({
    where: { telegramId: String(userId) },
    data: { sessionData: updated as any },
  }).catch((e: Error) => console.error('[Bot] Session persist error:', e));
}

// ─── DB helpers ────────────────────────────────────────────────────────────

async function getOrCreateUser(ctx: Context) {
  const tg = ctx.from!;
  return prisma.user.upsert({
    where: { telegramId: String(tg.id) },
    update: { username: tg.username, firstName: tg.first_name },
    create: { telegramId: String(tg.id), username: tg.username, firstName: tg.first_name },
  });
}

async function getActiveGoal(userId: string) {
  return prisma.goal.findFirst({
    where: { userId, isActive: true },
    include: { subcategories: { orderBy: { weight: 'desc' } } },
  });
}

// ─── Formatting helpers ────────────────────────────────────────────────────

function progressBar(pct: number, len = 10): string {
  const filled = Math.round((pct / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

function streakWord(n: number): string {
  if (n === 0) return 'нет стрика';
  const last = n % 10;
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 19) return `${n} дней`;
  if (last === 1) return `${n} день`;
  if (last >= 2 && last <= 4) return `${n} дня`;
  return `${n} дней`;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const MAIN_KEYBOARD = Markup.keyboard([
  ['✍️ Записать день', '📊 Прогресс'],
  ['📈 Статистика', '📅 Отчёт за неделю'],
  ['🎯 Новая цель', '⚙️ Настройки'],
  ['❓ Помощь'],
]).resize();

const KEYBOARD_BUTTON_TEXTS = [
  '🎯 Поставить цель', '🎯 Новая цель',
  '✍️ Записать день', '📊 Прогресс',
  '📈 Статистика', '📅 Отчёт за неделю',
  '⚙️ Настройки', '❓ Помощь',
];

// ─── Парсинг срока ────────────────────────────────────────────────────────
function parseDeadline(input: string): Date | null {
  const s = input.trim().toLowerCase();
  const dmyMatch = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmyMatch) {
    const d = new Date(+dmyMatch[3], +dmyMatch[2] - 1, +dmyMatch[1]);
    if (!isNaN(d.getTime()) && d > new Date()) return d;
  }
  const monthMatch = s.match(/(\d+)\s*мес/);
  if (monthMatch) {
    const d = new Date();
    d.setMonth(d.getMonth() + parseInt(monthMatch[1]));
    return d;
  }
  const yearMatch = s.match(/(\d+)\s*(год|лет|г\b)/);
  if (yearMatch) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + parseInt(yearMatch[1]));
    return d;
  }
  const daysMatch = s.match(/через\s+(\d+)\s*дн/);
  if (daysMatch) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(daysMatch[1]));
    return d;
  }
  const months: Record<string, number> = {
    'январ': 0, 'феврал': 1, 'март': 2, 'апрел': 3, 'май': 4, 'мая': 4,
    'июн': 5, 'июл': 6, 'август': 7, 'сентябр': 8, 'октябр': 9, 'ноябр': 10, 'декабр': 11
  };
  for (const [key, monthIdx] of Object.entries(months)) {
    const re = new RegExp(key + String.raw`.*?(\d{4})`);
    const m = s.match(re);
    if (m) {
      const d = new Date(+m[1], monthIdx, 1);
      if (d > new Date()) return d;
    }
  }
  const yearOnly = s.match(/^(202[5-9]|203\d)$/);
  if (yearOnly) {
    const d = new Date(+yearOnly[1], 11, 31);
    if (d > new Date()) return d;
  }
  return null;
}

function getGoalTitle(sess: SessionData): string {
  if (sess.goalTitle && sess.goalTitle !== 'undefined' && sess.goalTitle.trim() !== '') {
    return sess.goalTitle;
  }
  if (sess.carModel && sess.carModel !== 'undefined' && sess.carModel.trim() !== '') {
    return `Купить ${sess.carModel}`;
  }
  return 'Купить машину';
}

// ─── Settings keyboard ─────────────────────────────────────────────────────
async function sendSettingsMenu(ctx: Context, user: any) {
  const notifyStatus = user.notifyEnabled ? `✅ ВКЛ (${user.notifyHour}:00 МСК)` : '❌ ВЫКЛ';
  return ctx.reply(
    `⚙️ *Настройки*\n\n🔔 Уведомления: ${notifyStatus}\n\n` +
    `Выбери действие:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔔 Изменить время уведомления', 'settings_notify_time')],
        [Markup.button.callback(user.notifyEnabled ? '🔕 Отключить уведомления' : '🔔 Включить уведомления', 'settings_notify_toggle')],
        [Markup.button.callback('✏️ Редактировать категории цели', 'settings_edit_categories')],
        [Markup.button.callback('💬 Оставить отзыв', 'settings_feedback')],
      ]),
    }
  );
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handleStart(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  const goal = await getActiveGoal(user.id);
  const name = ctx.from!.first_name || ctx.from!.username || 'друг';

  // Сбрасываем состояние онбординга если цель уже есть
  if (goal) {
    setSession(ctx.from!.id, { state: 'idle' });
    const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
    const progress = stats?.progressPercent ?? 0;
    const streak = stats?.currentStreak ?? 0;
    return ctx.reply(
      `С возвращением, ${name}! 🔥\n\n` +
      `📌 Цель: *${goal.title}*\n` +
      `${progressBar(progress)} ${progress.toFixed(0)}%\n` +
      `🔥 Стрик: ${streakWord(streak)}\n` +
      `📝 Записей: ${stats?.totalEntries ?? 0}`,
      { parse_mode: 'Markdown', ...MAIN_KEYBOARD },
    );
  }

  setSession(ctx.from!.id, { state: 'awaiting_about' });
  return ctx.reply(
    `Привет, ${name}! 👋\n\n` +
    `Я Drive — твой AI-трекер на пути к большой цели.\n\n` +
    `Прежде чем начать, хочу узнать тебя чуть лучше.\n` +
    `*Расскажи о себе — чем занимаешься, сколько тебе лет?*`,
    { parse_mode: 'Markdown', ...Markup.removeKeyboard() },
  );
}

async function handleGoal(ctx: Context) {
  setSession(ctx.from!.id, { state: 'awaiting_goal_title' });
  return ctx.reply(
    `🎯 *Постановка новой цели*\n\n` +
    `Напиши свою большую цель, например:\n` +
    `• Купить машину\n• Накопить на квартиру\n• Запустить стартап\n• Выучить английский\n\n` +
    `✏️ Введи название:`,
    { parse_mode: 'Markdown', ...Markup.removeKeyboard() },
  );
}

async function handleEntry(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  const goal = await getActiveGoal(user.id);
  if (!goal) return ctx.reply('У тебя ещё нет цели. Создай её командой /goal 🎯');

  const existing = await prisma.entry.findUnique({
    where: { userId_goalId_date: { userId: user.id, goalId: goal.id, date: todayUTC() } },
  });
  if (existing) {
    return ctx.reply(
      `✅ Сегодня уже записано!\n\n📊 Оценка дня: *${existing.totalScore}/100*\n💬 ${existing.aiComment || ''}\n\nВозвращайся завтра 💪`,
      { parse_mode: 'Markdown', ...MAIN_KEYBOARD },
    );
  }

  setSession(ctx.from!.id, { state: 'awaiting_entry_text' });
  return ctx.reply(
    `✍️ *Записать день*\n\nЦель: *${goal.title}*\n\nРасскажи что ты сделал сегодня для достижения цели.\nПиши свободно — AI сам разберёт и оценит 👇`,
    { parse_mode: 'Markdown', ...Markup.removeKeyboard() },
  );
}

async function handleProgress(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  const goal = await getActiveGoal(user.id);
  if (!goal) return ctx.reply('Нет активной цели. Используй /goal 🎯');

  const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
  const progress = stats?.progressPercent ?? 0;
  const entries = await prisma.entry.findMany({
    where: { userId: user.id, goalId: goal.id },
    orderBy: { date: 'desc' },
    take: 7,
  });

  let text = `📊 *Прогресс*\n\n📌 *${goal.title}*\n${progressBar(progress)} ${progress.toFixed(0)}%\n\n`;
  text += `🔥 Стрик: *${streakWord(stats?.currentStreak ?? 0)}*\n`;
  text += `🏆 Лучший стрик: ${streakWord(stats?.longestStreak ?? 0)}\n`;
  text += `📝 Всего записей: ${stats?.totalEntries ?? 0}\n`;
  if (goal.deadline) {
    const daysLeft = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000);
    text += `⏳ До дедлайна: ${daysLeft > 0 ? `${daysLeft} дн.` : '⚠️ просрочено'}\n`;
  }
  if (entries.length > 0) {
    text += `\n📅 *Последние записи:*\n`;
    for (const e of entries) {
      const emoji = e.totalScore >= 70 ? '🟢' : e.totalScore >= 40 ? '🟡' : '🔴';
      text += `${emoji} ${fmtDate(e.date)} — ${e.totalScore}/100\n`;
    }
  }
  return ctx.reply(text, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
}

async function handleStats(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  const goal = await getActiveGoal(user.id);
  const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
  if (!goal || !stats) return ctx.reply('Ещё нет данных. Поставь цель (/goal) и добавь первую запись!');

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const recentScores = await prisma.entryScore.findMany({
    where: { entry: { userId: user.id, goalId: goal.id, date: { gte: sevenDaysAgo } } },
    include: { subcategory: true },
  });
  const catMap: Record<string, { total: number; count: number; emoji: string }> = {};
  for (const s of recentScores) {
    const name = s.subcategory.name;
    if (!catMap[name]) catMap[name] = { total: 0, count: 0, emoji: s.subcategory.emoji || '' };
    catMap[name].total += s.score;
    catMap[name].count += 1;
  }

  let text = `📈 *Статистика*\n\n📌 Цель: *${goal.title}*\n\n`;
  text += `🔥 Стрик: ${streakWord(stats.currentStreak)}\n`;
  text += `🏆 Лучший стрик: ${streakWord(stats.longestStreak)}\n`;
  text += `📝 Всего записей: ${stats.totalEntries}\n`;
  text += `📊 Прогресс: ${stats.progressPercent.toFixed(0)}%\n`;
  if (Object.keys(catMap).length > 0) {
    text += `\n*За последние 7 дней:*\n`;
    for (const [name, data] of Object.entries(catMap)) {
      const avg = (data.total / data.count).toFixed(1);
      text += `${data.emoji} ${name}: ${avg}/10\n`;
    }
  }
  return ctx.reply(text, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
}

async function handleWeeklyReport(ctx: Context) {
  const user = await getOrCreateUser(ctx);
  const goal = await getActiveGoal(user.id);
  if (!goal) return ctx.reply('Нет активной цели. Используй /goal 🎯');

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const entries = await prisma.entry.findMany({
    where: { userId: user.id, goalId: goal.id, date: { gte: sevenDaysAgo } },
    include: { entryScores: { include: { subcategory: true } } },
    orderBy: { date: 'asc' },
  });
  if (entries.length === 0) return ctx.reply('За эту неделю нет записей. Добавь первую через /entry!');

  await ctx.reply('🤖 Генерирую AI-отчёт...');
  const summary = entries.map((e) => ({
    date: fmtDate(e.date),
    totalScore: e.totalScore,
    topCategories: e.entryScores.sort((a, b) => b.score - a.score).slice(0, 2).map((s) => s.subcategory.name),
  }));
  const report = await generateWeeklyReport(goal.title, summary);
  const trendEmoji = report.trend === 'improving' ? '📈' : report.trend === 'declining' ? '📉' : '➡️';

  let text = `📅 *Отчёт за неделю*\n\n${report.summary}\n\n`;
  text += `${trendEmoji} Тренд: ${report.trend === 'improving' ? 'растём' : report.trend === 'declining' ? 'падаем' : 'стабильно'}\n`;
  text += `🏆 Лучшая категория: ${report.topCategory}\n⚠️ Слабая категория: ${report.weakCategory}\n\n`;
  text += `*Инсайты:*\n`;
  for (const insight of report.insights) text += `• ${insight}\n`;
  text += `\n🎯 *Фокус на следующей неделе:*\n${report.nextWeekFocus}`;

  return ctx.reply(text, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
}

// ─── Admin analytics ───────────────────────────────────────────────────────

async function handleAnalytics(ctx: Context) {
  const tgId = String(ctx.from!.id);
  if (!ADMIN_IDS.includes(tgId)) {
    return ctx.reply('❌ Только для администраторов');
  }

  const now = new Date();
  const day1 = new Date(now.getTime() - 1 * 86400000);
  const day7 = new Date(now.getTime() - 7 * 86400000);
  const day30 = new Date(now.getTime() - 30 * 86400000);

  const [
    totalUsers,
    usersWithGoal,
    usersDAU,
    usersWAU,
    usersMAU,
    totalEntries,
    entriesLast7,
    totalFeedbacks,
    avgScoreResult,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { goals: { some: { isActive: true } } } }),
    prisma.user.count({ where: { entries: { some: { createdAt: { gte: day1 } } } } }),
    prisma.user.count({ where: { entries: { some: { createdAt: { gte: day7 } } } } }),
    prisma.user.count({ where: { entries: { some: { createdAt: { gte: day30 } } } } }),
    prisma.entry.count(),
    prisma.entry.count({ where: { createdAt: { gte: day7 } } }),
    prisma.feedback.count(),
    prisma.entry.aggregate({ _avg: { totalScore: true } }),
  ]);

  // Retention: сколько из зарегистрировавшихся >7 дней назад вернулись за последние 7 дней
  const usersOlderThan7d = await prisma.user.count({ where: { createdAt: { lte: day7 } } });
  const returnedOld = usersOlderThan7d > 0
    ? await prisma.user.count({
        where: {
          createdAt: { lte: day7 },
          entries: { some: { createdAt: { gte: day7 } } },
        },
      })
    : 0;
  const retention7d = usersOlderThan7d > 0 ? ((returnedOld / usersOlderThan7d) * 100).toFixed(1) : 'N/A';

  const avgScore = avgScoreResult._avg.totalScore?.toFixed(1) ?? 'N/A';
  const conversionRate = totalUsers > 0 ? ((usersWithGoal / totalUsers) * 100).toFixed(1) : '0';

  let text = `📊 *Аналитика бота*\n\n`;
  text += `👥 *Пользователи*\n`;
  text += `• Всего: ${totalUsers}\n`;
  text += `• С активной целью: ${usersWithGoal} (${conversionRate}%)\n`;
  text += `• DAU (24ч): ${usersDAU}\n`;
  text += `• WAU (7 дней): ${usersWAU}\n`;
  text += `• MAU (30 дней): ${usersMAU}\n\n`;
  text += `🔄 *Retention*\n`;
  text += `• 7d retention: ${retention7d}%\n\n`;
  text += `📝 *Записи*\n`;
  text += `• Всего: ${totalEntries}\n`;
  text += `• За 7 дней: ${entriesLast7}\n`;
  text += `• Средний балл: ${avgScore}/100\n\n`;
  text += `💬 *Обратная связь*\n`;
  text += `• Отзывов: ${totalFeedbacks}\n`;

  return ctx.reply(text, { parse_mode: 'Markdown' });
}

// ─── Feedback handler ──────────────────────────────────────────────────────

async function handleFeedbackCommand(ctx: Context) {
  setSession(ctx.from!.id, { state: 'awaiting_feedback' });
  return ctx.reply(
    '💬 *Обратная связь*\n\nНапиши свой отзыв, предложение или что не нравится.\nМы обязательно прочитаем! 🙏',
    { parse_mode: 'Markdown', ...Markup.removeKeyboard() },
  );
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function startBot(): Promise<import('telegraf').Telegraf | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Bot] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return null;
  }

  await ensureSessionsLoaded();

  const bot = new Telegraf(token);

  // Commands
  bot.start(handleStart);
  bot.command('goal', handleGoal);
  bot.command('entry', handleEntry);
  bot.command('progress', handleProgress);
  bot.command('stats', handleStats);
  bot.command('week', handleWeeklyReport);
  bot.command('feedback', handleFeedbackCommand);
  bot.command('analytics', handleAnalytics);
  bot.command('notify', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const hourStr = args[1];
    const hour = parseInt(hourStr || '');
    if (isNaN(hour) || hour < 0 || hour > 23) {
      return ctx.reply(
        '🕐 Укажи час уведомления (0-23) по МСК.\n\nПример: `/notify 21` — буду напоминать в 21:00',
        { parse_mode: 'Markdown' },
      );
    }
    const user = await getOrCreateUser(ctx);
    await prisma.user.update({
      where: { id: user.id },
      data: { notifyHour: hour, notifyEnabled: true },
    });
    return ctx.reply(`✅ Буду напоминать в *${hour}:00 МСК* каждый день`, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
  });
  bot.help((ctx) =>
    ctx.reply(
      `📖 *Команды DriveGoal*\n\n` +
      `/start — главное меню\n` +
      `/goal — поставить новую цель\n` +
      `/entry — записать день\n` +
      `/progress — прогресс и стрик\n` +
      `/stats — полная статистика\n` +
      `/week — AI-отчёт за неделю\n` +
      `/notify <час> — настроить напоминание (0-23 МСК)\n` +
      `/feedback — оставить отзыв\n` +
      `/help — эта справка`,
      { parse_mode: 'Markdown' },
    ),
  );

  // Keyboard buttons
  bot.hears('🎯 Поставить цель', async (ctx) => {
    setSession(ctx.from!.id, { state: 'awaiting_about' });
    return ctx.reply('Расскажи о себе — чем занимаешься, сколько тебе лет?', { ...Markup.removeKeyboard() });
  });
  bot.hears('🎯 Новая цель', handleGoal);
  bot.hears('✍️ Записать день', handleEntry);
  bot.hears('📊 Прогресс', handleProgress);
  bot.hears('📈 Статистика', handleStats);
  bot.hears('📅 Отчёт за неделю', handleWeeklyReport);
  bot.hears('⚙️ Настройки', async (ctx) => {
    const user = await getOrCreateUser(ctx);
    return sendSettingsMenu(ctx, user);
  });
  bot.hears('❓ Помощь', (ctx) =>
    ctx.reply(
      '/entry — записать день\n/progress — прогресс\n/stats — статистика\n/week — отчёт\n/goal — новая цель\n/notify <час> — настроить уведомление\n/feedback — отзыв',
    ),
  );

  // Callback queries
  bot.on('callback_query', async (ctx) => {
    const data = (ctx.callbackQuery as any).data as string;
    const userId = ctx.from!.id;
    await ctx.answerCbQuery();

    // ── Settings callbacks ──────────────────────────────────────────────────
    if (data === 'settings_notify_time') {
      return ctx.reply(
        '🕐 В какое время напоминать? (час по МСК, 0-23)\n\nОтправь команду: `/notify <час>`\nНапример: `/notify 20`',
        { parse_mode: 'Markdown' },
      );
    }

    if (data === 'settings_notify_toggle') {
      const user = await getOrCreateUser(ctx);
      const newVal = !user.notifyEnabled;
      await prisma.user.update({ where: { id: user.id }, data: { notifyEnabled: newVal } });
      await ctx.reply(newVal ? '🔔 Уведомления включены' : '🔕 Уведомления отключены', MAIN_KEYBOARD);
      return;
    }

    if (data === 'settings_edit_categories') {
      const user = await getOrCreateUser(ctx);
      const goal = await getActiveGoal(user.id);
      if (!goal) return ctx.reply('У тебя нет активной цели. Создай через /goal');

      let text = `✏️ *Текущие категории цели "${goal.title}":*\n\n`;
      for (const s of goal.subcategories) {
        text += `${s.emoji} *${s.name}* — ${Math.round(s.weight * 100)}%\n`;
      }
      text += `\nОтправь новые категории (каждую с новой строки):\n`;
      text += `Формат: *Название — описание*\n\nПример:\nДоход — работа и бизнес\nНакопления — откладываю деньги\nНавыки — учусь`;

      setSession(userId, { state: 'awaiting_edit_subcategories' });
      return ctx.reply(text, { parse_mode: 'Markdown' });
    }

    if (data === 'settings_feedback') {
      return handleFeedbackCommand(ctx);
    }

    // ── Car unknown ─────────────────────────────────────────────────────────
    if (data === 'car_unknown') {
      setSession(userId, { carModel: undefined, state: 'awaiting_car_price' });
      return ctx.reply('💰 Окей! Примерная стоимость машины, которую хочешь? Или напиши "не знаю"');
    }

    // ── Life areas ──────────────────────────────────────────────────────────
    const areaMap: Record<string, string> = {
      'area_career': '💼 Карьера',
      'area_finance': '💰 Финансы',
      'area_health': '💪 Здоровье',
      'area_growth': '📚 Саморазвитие',
      'area_relations': '❤️ Отношения',
      'area_travel': '🌍 Путешествия',
    };
    if (data in areaMap) {
      const s = getSession(userId);
      if (s.state === 'awaiting_life_areas') {
        const areas = s.lifeAreas || [];
        const area = areaMap[data];
        const updated = areas.includes(area) ? areas.filter(a => a !== area) : [...areas, area];
        setSession(userId, { lifeAreas: updated });
        const selected = updated.length ? updated.join(', ') : 'ничего не выбрано';
        await ctx.editMessageText(
          `🎯 Выбрано: ${selected}\n\nДобавь ещё или нажми *Готово*`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('💼 Карьера / бизнес', 'area_career'), Markup.button.callback('💰 Финансы', 'area_finance')],
              [Markup.button.callback('💪 Здоровье', 'area_health'), Markup.button.callback('📚 Саморазвитие', 'area_growth')],
              [Markup.button.callback('❤️ Отношения', 'area_relations'), Markup.button.callback('🌍 Путешествия', 'area_travel')],
              [Markup.button.callback('✅ Готово', 'areas_done')],
            ]),
          }
        );
      }
      return;
    }

    // ── Areas done ──────────────────────────────────────────────────────────
    if (data === 'areas_done') {
      setSession(userId, { state: 'awaiting_strategy' });
      await ctx.reply(
        `💡 *Как планируешь достичь цели?*\n\nВыбери стратегию:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💰 Копить постепенно', 'strategy_save')],
            [Markup.button.callback('🚀 Увеличить доход', 'strategy_income')],
            [Markup.button.callback('🏗 Построить бизнес', 'strategy_business')],
            [Markup.button.callback('⚡️ Запустить проект / стартап', 'strategy_startup')],
            [Markup.button.callback('🎯 Комбо-стратегия', 'strategy_combo')],
          ]),
        },
      );
      return;
    }

    // ── Strategy ────────────────────────────────────────────────────────────
    const strategyMap: Record<string, string> = {
      'strategy_save': '💰 Постепенное накопление',
      'strategy_income': '🚀 Рост дохода',
      'strategy_business': '🏗 Построить бизнес',
      'strategy_startup': '⚡️ Проект / стартап',
      'strategy_combo': '🎯 Комбо-стратегия',
    };
    if (data in strategyMap) {
      const s = getSession(userId);
      const strategy = strategyMap[data];
      // Устанавливаем goalTitle из carModel если не задан
      const resolvedTitle = getGoalTitle(s);
      setSession(userId, { strategy, goalTitle: resolvedTitle, state: 'awaiting_goal_deadline' });
      const summary = [
        s.about ? `👤 ${s.about}` : null,
        s.carModel ? `🚗 ${s.carModel}` : null,
        s.carPrice ? `💰 Цена: ${s.carPrice}` : null,
        s.income ? `📊 Доход: ${s.income}` : null,
        s.lifeAreas?.length ? `🎯 Сферы: ${s.lifeAreas.join(', ')}` : null,
        `📌 Стратегия: ${strategy}`,
      ].filter(Boolean).join('\n');
      await ctx.reply(
        `📋 *Отлично! Вот что я знаю о тебе:*\n\n${summary}\n\n⏳ На какой срок ставим цель?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('3 месяца', 'deadline_3'), Markup.button.callback('6 месяцев', 'deadline_6')],
            [Markup.button.callback('1 год', 'deadline_12'), Markup.button.callback('3 года', 'deadline_36')],
            [Markup.button.callback('✏️ Свой срок', 'deadline_custom')],
          ]),
        },
      );
      return;
    }

    // ── Custom deadline ──────────────────────────────────────────────────────
    if (data === 'deadline_custom') {
      setSession(userId, { state: 'awaiting_custom_deadline' });
      return ctx.reply(
        '📅 Напиши срок в удобном формате:\n\n• *5 месяцев*\n• *1 год*\n• *декабрь 2026*\n• *31.12.2026*',
        { parse_mode: 'Markdown' },
      );
    }

    // ── Deadline selected ───────────────────────────────────────────────────
    if (data.startsWith('deadline_')) {
      const months = parseInt(data.replace('deadline_', ''));
      if (isNaN(months)) return;
      const deadline = new Date();
      deadline.setMonth(deadline.getMonth() + months);

      const sess = getSession(userId);
      // Убеждаемся что goalTitle всегда заполнен
      const resolvedTitle = getGoalTitle(sess);
      setSession(userId, { goalDeadline: deadline, goalTitle: resolvedTitle, state: 'confirming_subcategories' });

      await ctx.reply('🤖 AI подбирает подкатегории...');
      try {
        const userContext = [
          sess.about, sess.carModel, sess.carPrice,
          sess.income ? `доход ${sess.income}` : null,
          sess.lifeAreas?.length ? `приоритеты: ${sess.lifeAreas.join(', ')}` : null,
          sess.strategy ? `стратегия: ${sess.strategy}` : null,
        ].filter(Boolean).join('; ');

        let suggested: SuggestedSubcategory[];
        try {
          suggested = await suggestSubcategories(resolvedTitle, userContext || undefined);
        } catch {
          suggested = [
            { name: 'Доход', emoji: '💼', weight: 0.4, color: '#10b981', description: 'Действия, влияющие на заработок' },
            { name: 'Накопления', emoji: '💰', weight: 0.3, color: '#6366f1', description: 'Откладываю и инвестирую' },
            { name: 'Навыки', emoji: '📚', weight: 0.2, color: '#f59e0b', description: 'Учусь, расту, развиваюсь' },
            { name: 'Здоровье', emoji: '💪', weight: 0.1, color: '#ef4444', description: 'Физическое и ментальное состояние' },
          ];
        }
        setSession(userId, { suggestedSubcategories: suggested });

        let text = `✨ AI предлагает направления для цели *"${resolvedTitle}"*:\n\n`;
        for (const s of suggested) {
          text += `${s.emoji} *${s.name}* — ${Math.round(s.weight * 100)}%\n`;
          text += `   _${s.description}_\n\n`;
        }
        text += `Создать цель с этими категориями?`;

        await ctx.reply(text, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Создать цель', 'confirm_goal')],
            [Markup.button.callback('✏️ Изменить категории', 'edit_subcategories')],
            [Markup.button.callback('🔄 Другие варианты', `deadline_${months}`)],
          ]),
        });
      } catch (err) {
        console.error('[Bot] suggestSubcategories error:', err);
        await ctx.reply('Ошибка AI. Попробуй заново /goal');
        setSession(userId, { state: 'idle' });
      }
      return;
    }

    // ── Edit subcategories ───────────────────────────────────────────────────
    if (data === 'edit_subcategories') {
      const sess = getSession(userId);
      let text = `✏️ *Редактирование категорий*\n\n`;
      if (sess.suggestedSubcategories?.length) {
        text += `Текущие категории:\n`;
        for (const s of sess.suggestedSubcategories) {
          text += `${s.emoji} ${s.name} — ${Math.round(s.weight * 100)}%\n`;
        }
        text += `\n`;
      }
      text += `Напиши свои категории — каждую с новой строки.\n`;
      text += `Формат: *Название — описание*\n\n`;
      text += `Пример:\nДоход — работа и подработки\nЭкономия — урезаю расходы\nНавыки — учусь новому`;
      setSession(userId, { state: 'awaiting_edit_subcategories' });
      return ctx.reply(text, { parse_mode: 'Markdown' });
    }

    // ── Confirm goal ─────────────────────────────────────────────────────────
    if (data === 'confirm_goal') {
      const sess = getSession(userId);
      const title = getGoalTitle(sess);
      if (!title || title === 'Купить машину' && !sess.goalTitle && !sess.carModel) {
        // нет данных — только если совсем пусто
      }
      if (!sess.suggestedSubcategories?.length) {
        return ctx.reply('Что-то пошло не так. Начни заново: /goal');
      }

      const user = await getOrCreateUser(ctx);
      await prisma.goal.updateMany({
        where: { userId: user.id, isActive: true },
        data: { isActive: false },
      });

      const total = sess.suggestedSubcategories.reduce((sum, s) => sum + s.weight, 0);
      await prisma.goal.create({
        data: {
          userId: user.id,
          title: title,
          deadline: sess.goalDeadline,
          isActive: true,
          subcategories: {
            create: sess.suggestedSubcategories.map((s) => ({
              name: s.name,
              emoji: s.emoji,
              weight: parseFloat((s.weight / total).toFixed(4)),
              color: s.color,
            })),
          },
        },
      });

      setSession(userId, { state: 'idle', goalTitle: undefined, goalDeadline: undefined, suggestedSubcategories: undefined, about: undefined, carModel: undefined, carPrice: undefined, income: undefined, lifeAreas: undefined, strategy: undefined });

      await ctx.reply(
        `🎉 Цель поставлена!\n\n📌 *${title}*\n` +
        (sess.goalDeadline ? `⏳ Дедлайн: ${fmtDate(sess.goalDeadline)}\n` : '') +
        `\nКаждый день пиши что сделал — /entry\nПо умолчанию буду напоминать в 21:00 💪\n_(сменить время: /notify <час>)_`,
        { parse_mode: 'Markdown', ...MAIN_KEYBOARD },
      );
      return;
    }

    // ── Feedback rating ──────────────────────────────────────────────────────
    if (data.startsWith('feedback_rate_')) {
      const rating = parseInt(data.replace('feedback_rate_', ''));
      const user = await getOrCreateUser(ctx);
      // Обновляем последний отзыв без рейтинга
      const lastFeedback = await prisma.feedback.findFirst({
        where: { userId: user.id, rating: null },
        orderBy: { createdAt: 'desc' },
      });
      if (lastFeedback) {
        await prisma.feedback.update({ where: { id: lastFeedback.id }, data: { rating } });
      }
      const stars = '⭐'.repeat(rating);
      await ctx.reply(`${stars} Спасибо за оценку! Это очень помогает нам развиваться 🙏`, MAIN_KEYBOARD);
      return;
    }
  });

  // Text messages → state machine
  bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const sess = getSession(userId);
    const text = ctx.message.text;

    if (text.startsWith('/') || KEYBOARD_BUTTON_TEXTS.includes(text)) return;

    // ── Feedback ─────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_feedback') {
      if (text.length < 3) return ctx.reply('Напиши хотя бы пару слов 🙏');
      const user = await getOrCreateUser(ctx);
      await prisma.feedback.create({ data: { userId: user.id, text } });
      setSession(userId, { state: 'idle' });
      await ctx.reply(
        '💬 Спасибо за отзыв! Как бы ты оценил бот?',
        {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('1 ⭐', 'feedback_rate_1'),
              Markup.button.callback('2 ⭐', 'feedback_rate_2'),
              Markup.button.callback('3 ⭐', 'feedback_rate_3'),
              Markup.button.callback('4 ⭐', 'feedback_rate_4'),
              Markup.button.callback('5 ⭐', 'feedback_rate_5'),
            ],
          ]),
        }
      );
      return;
    }

    // ── Custom deadline ──────────────────────────────────────────────────────
    if (sess.state === 'awaiting_custom_deadline') {
      const deadline = parseDeadline(text);
      if (!deadline) {
        return ctx.reply(
          '❌ Не понял срок. Попробуй написать иначе:\n• *5 месяцев*\n• *1 год*\n• *декабрь 2026*\n• *31.12.2026*',
          { parse_mode: 'Markdown' },
        );
      }
      const resolvedTitle = getGoalTitle(sess);
      setSession(userId, { goalDeadline: deadline, goalTitle: resolvedTitle, state: 'confirming_subcategories' });
      await ctx.reply('🤖 AI подбирает подкатегории...');
      try {
        const suggested = await suggestSubcategories(resolvedTitle);
        setSession(userId, { suggestedSubcategories: suggested });
        let text2 = `✨ AI предлагает направления для цели *"${resolvedTitle}"*:\n\n`;
        for (const s of suggested) {
          text2 += `${s.emoji} *${s.name}* — ${Math.round(s.weight * 100)}%\n_${s.description}_\n\n`;
        }
        text2 += `Создать цель с этими категориями?`;
        const months = Math.max(1, Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)));
        await ctx.reply(text2, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Создать цель', 'confirm_goal')],
            [Markup.button.callback('✏️ Изменить категории', 'edit_subcategories')],
            [Markup.button.callback('🔄 Другие варианты', `deadline_${months}`)],
          ]),
        });
      } catch (e) {
        console.error('[Bot] Error in subcategory flow:', e);
        await ctx.reply('⚠️ Что-то пошло не так. Попробуй /goal ещё раз.');
        setSession(userId, { state: 'idle' });
      }
      return;
    }

    // ── Goal deadline (text) ─────────────────────────────────────────────────
    if (sess.state === 'awaiting_goal_deadline') {
      const deadline = parseDeadline(text);
      if (!deadline) {
        return ctx.reply('❌ Не понял срок. Попробуй: *5 месяцев*, *1 год*, *декабрь 2026*', { parse_mode: 'Markdown' });
      }
      const resolvedTitle = getGoalTitle(sess);
      setSession(userId, { goalDeadline: deadline, goalTitle: resolvedTitle, state: 'confirming_subcategories' });
      await ctx.reply('🤖 AI подбирает подкатегории...');
      try {
        const s = getSession(userId);
        const userContext = [s.about, s.carModel, s.carPrice, s.income, s.strategy].filter(Boolean).join('; ');
        let suggested: SuggestedSubcategory[];
        try {
          suggested = await suggestSubcategories(resolvedTitle, userContext || undefined);
        } catch {
          suggested = [
            { name: 'Доход', emoji: '💼', weight: 0.4, color: '#10b981', description: 'Действия, влияющие на заработок' },
            { name: 'Накопления', emoji: '💰', weight: 0.3, color: '#6366f1', description: 'Откладываю и инвестирую' },
            { name: 'Навыки', emoji: '📚', weight: 0.2, color: '#f59e0b', description: 'Учусь, расту, развиваюсь' },
            { name: 'Здоровье', emoji: '💪', weight: 0.1, color: '#ef4444', description: 'Физическое и ментальное состояние' },
          ];
        }
        setSession(userId, { suggestedSubcategories: suggested });
        let txt = `✨ AI предлагает направления для цели *"${resolvedTitle}"*:\n\n`;
        for (const sc of suggested) {
          txt += `${sc.emoji} *${sc.name}* — ${Math.round(sc.weight * 100)}%\n_${sc.description}_\n\n`;
        }
        txt += `Создать цель с этими категориями?`;
        const months = Math.max(1, Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)));
        await ctx.reply(txt, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Создать цель', 'confirm_goal')],
            [Markup.button.callback('✏️ Изменить категории', 'edit_subcategories')],
            [Markup.button.callback('🔄 Другие варианты', `deadline_${months}`)],
          ]),
        });
      } catch (e) {
        console.error('[Bot] Error:', e);
        await ctx.reply('⚠️ Что-то пошло не так. Попробуй /goal ещё раз.');
        setSession(userId, { state: 'idle' });
      }
      return;
    }

    // ── Edit subcategories ────────────────────────────────────────────────────
    if (sess.state === 'awaiting_edit_subcategories') {
      const lines = text.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return ctx.reply('Нужно минимум 2 категории 👇');
      const colors = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6'];
      const emojis = ['💼', '💰', '📚', '💪', '🎯'];
      const custom: SuggestedSubcategory[] = lines.slice(0, 5).map((line, i) => {
        const [namePart, ...descParts] = line.split('—').map(s => s.trim());
        return {
          name: namePart,
          emoji: emojis[i] || '🎯',
          weight: parseFloat((1 / Math.min(lines.length, 5)).toFixed(2)),
          color: colors[i] || '#6366f1',
          description: descParts.join('—') || namePart,
        };
      });

      const user = await getOrCreateUser(ctx);
      const goal = await getActiveGoal(user.id);

      // Если редактирование существующей цели (из настроек)
      if (goal && sess.state === 'awaiting_edit_subcategories' && !sess.goalDeadline) {
        // Обновляем категории существующей цели
        await prisma.subcategory.deleteMany({ where: { goalId: goal.id } });
        const total = custom.reduce((sum, s) => sum + s.weight, 0);
        await prisma.subcategory.createMany({
          data: custom.map(s => ({
            goalId: goal.id,
            name: s.name,
            emoji: s.emoji,
            weight: parseFloat((s.weight / total).toFixed(4)),
            color: s.color,
          })),
        });
        setSession(userId, { state: 'idle' });
        let reply = `✅ *Категории обновлены!*\n\nНовые категории цели *"${goal.title}":*\n\n`;
        for (const s of custom) reply += `${s.emoji} *${s.name}*\n`;
        return ctx.reply(reply, { parse_mode: 'Markdown', ...MAIN_KEYBOARD });
      }

      // Иначе — в процессе создания новой цели
      setSession(userId, { suggestedSubcategories: custom, state: 'confirming_subcategories' });
      const goalTitle = getGoalTitle(sess);
      let txt = `✨ Твои категории для цели *"${goalTitle}"*:\n\n`;
      for (const sc of custom) {
        txt += `${sc.emoji} *${sc.name}* — ${Math.round(sc.weight * 100)}%\n`;
        if (sc.description !== sc.name) txt += `   _${sc.description}_\n`;
        txt += '\n';
      }
      txt += 'Создать цель с этими категориями?';
      return ctx.reply(txt, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Создать цель', 'confirm_goal')],
          [Markup.button.callback('✏️ Изменить ещё раз', 'edit_subcategories')],
        ]),
      });
    }

    // ── About ─────────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_about') {
      setSession(userId, { about: text, state: 'awaiting_car_model' });
      return ctx.reply(
        '🚗 Отлично! Какую машину хочешь купить?\n\nНапиши модель или нажми кнопку:',
        { ...Markup.inlineKeyboard([[Markup.button.callback('🤷 Ещё не знаю', 'car_unknown')]]) },
      );
    }

    // ── Car model ─────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_car_model') {
      setSession(userId, { carModel: text, state: 'awaiting_car_price' });
      return ctx.reply(
        `💰 Понял, *${text}*!\n\nПримерная стоимость? (в рублях, например: 2 500 000)\nИли напиши "не знаю"`,
        { parse_mode: 'Markdown' },
      );
    }

    // ── Car price ─────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_car_price') {
      setSession(userId, { carPrice: text, state: 'awaiting_income' });
      return ctx.reply(
        '📊 Какой у тебя сейчас доход в месяц?\n\nМожно написать примерно (например: *80 000 ₽* или *150к*)',
        { parse_mode: 'Markdown' },
      );
    }

    // ── Income ────────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_income') {
      setSession(userId, { income: text, state: 'awaiting_life_areas', lifeAreas: [] });
      return ctx.reply(
        '🎯 Какие сферы жизни для тебя сейчас приоритетны?\n\n_Выбери всё важное и нажми *Готово*_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💼 Карьера / бизнес', 'area_career'), Markup.button.callback('💰 Финансы', 'area_finance')],
            [Markup.button.callback('💪 Здоровье', 'area_health'), Markup.button.callback('📚 Саморазвитие', 'area_growth')],
            [Markup.button.callback('❤️ Отношения', 'area_relations'), Markup.button.callback('🌍 Путешествия', 'area_travel')],
            [Markup.button.callback('✅ Готово', 'areas_done')],
          ]),
        },
      );
    }

    // ── Goal title ────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_goal_title') {
      if (text.length < 3) return ctx.reply('Название слишком короткое. Напиши подробнее 👇');
      const isCarGoal = /(машин|авто|тачк|car|bmw|mercedes|toyota|lada|kia|hyundai)/i.test(text);
      if (isCarGoal) {
        setSession(userId, { goalTitle: text, state: 'awaiting_car_model' });
        return ctx.reply(
          `🚗 Отлично! Какую машину хочешь купить?`,
          { ...Markup.inlineKeyboard([[Markup.button.callback('Ещё не знаю', 'car_unknown')]]) },
        );
      }
      setSession(userId, { goalTitle: text, state: 'awaiting_goal_deadline' });
      return ctx.reply(
        `Отлично! Цель: *"${text}"*\n\nНа какой срок?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('3 месяца', 'deadline_3'), Markup.button.callback('6 месяцев', 'deadline_6')],
            [Markup.button.callback('1 год', 'deadline_12'), Markup.button.callback('3 года', 'deadline_36')],
            [Markup.button.callback('✏️ Свой срок', 'deadline_custom')],
          ]),
        },
      );
    }

    // ── Entry text ────────────────────────────────────────────────────────────
    if (sess.state === 'awaiting_entry_text') {
      if (text.length < 10) return ctx.reply('Слишком коротко. Расскажи подробнее что сделал 👇');
      setSession(userId, { state: 'idle' });
      const user = await getOrCreateUser(ctx);
      const goal = await getActiveGoal(user.id);
      if (!goal) return ctx.reply('Активная цель не найдена. Используй /goal');

      await ctx.reply('🤖 Анализирую...');
      try {
        const subcategoryNames = goal.subcategories.map((s) => s.name);
        const analysis = await analyzeEntry(text, goal.title, subcategoryNames);
        const today = todayUTC();
        await prisma.entry.upsert({
          where: { userId_goalId_date: { userId: user.id, goalId: goal.id, date: today } },
          update: { rawText: text, totalScore: analysis.totalScore, aiComment: analysis.overallComment },
          create: {
            userId: user.id,
            goalId: goal.id,
            date: today,
            rawText: text,
            totalScore: analysis.totalScore,
            aiComment: analysis.overallComment,
            entryScores: {
              create: analysis.subcategories.map((s) => {
                const sub = goal.subcategories.find((sc) => sc.name.toLowerCase() === s.name.toLowerCase()) ?? goal.subcategories[0];
                return { subcategoryId: sub.id, score: s.score, aiComment: s.comment, actions: s.actions };
              }),
            },
          },
        });
        const streakResult = await updateStreak(user.id, goal.id, today, analysis.totalScore);

        const scoreEmoji = analysis.totalScore >= 70 ? '🟢' : analysis.totalScore >= 40 ? '🟡' : '🔴';
        let reply = `${scoreEmoji} *Оценка дня: ${analysis.totalScore}/100*\n\n💬 ${analysis.overallComment}\n\n*По категориям:*\n`;
        for (const s of analysis.subcategories) {
          const sub = goal.subcategories.find((sc) => sc.name.toLowerCase() === s.name.toLowerCase());
          reply += `${sub?.emoji ?? '•'} ${s.name}: *${s.score}/10*\n`;
        }
        if (analysis.strengths.length > 0) {
          reply += `\n✅ *Сильные стороны:*\n`;
          for (const s of analysis.strengths) reply += `• ${s}\n`;
        }
        if (analysis.suggestions.length > 0) {
          reply += `\n💡 *Рекомендации:*\n`;
          for (const s of analysis.suggestions) reply += `• ${s}\n`;
        }
        reply += `\n🔥 Стрик: *${streakWord(streakResult.currentStreak)}*`;

        // Предлагаем оставить отзыв каждые 5 записей
        const stats = await prisma.userStats.findUnique({ where: { userId: user.id } });
        const totalEntries = (stats?.totalEntries ?? 0);
        const showFeedback = totalEntries > 0 && totalEntries % 5 === 0;

        const keyboard = showFeedback
          ? Markup.inlineKeyboard([[Markup.button.callback('💬 Оставить отзыв', 'settings_feedback')]])
          : undefined;

        return ctx.reply(reply, {
          parse_mode: 'Markdown',
          ...(keyboard ? keyboard : MAIN_KEYBOARD),
        });
      } catch (err) {
        console.error('[Bot] Entry analysis error:', err);
        return ctx.reply('Ошибка при анализе. Попробуй ещё раз /entry');
      }
    }

    return ctx.reply('Используй кнопки меню или команды:\n/entry — записать день\n/progress — прогресс\n/help — справка');
  });

  bot.catch((err, ctx) => {
    console.error('[Bot] Unhandled error:', err);
    ctx?.reply?.('⚠️ Произошла ошибка. Попробуй ещё раз.').catch(() => {});
  });
  console.log('[Bot] @DriveGoal_bot ready ✅');
  return bot;
}
