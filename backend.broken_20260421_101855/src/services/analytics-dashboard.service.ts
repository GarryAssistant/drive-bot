import { Context, Markup } from 'telegraf';
import { prisma } from './prisma.service';

type DashPage = 'overview' | 'users' | 'entries' | 'retention' | 'feedback' | 'abtest';

function navKeyboard(current: DashPage) {
  const pages: { label: string; page: DashPage }[] = [
    { label: '📊 Обзор', page: 'overview' },
    { label: '👥 Юзеры', page: 'users' },
    { label: '📝 Записи', page: 'entries' },
    { label: '🔄 Retention', page: 'retention' },
    { label: '💬 Фидбек', page: 'feedback' },
    { label: '🧪 A/B тест', page: 'abtest' },
  ];
  return Markup.inlineKeyboard(
    pages.filter(p => p.page !== current).map(p => [Markup.button.callback(p.label, `dash_${p.page}`)])
  );
}

async function getOverview(): Promise<string> {
  const day1 = new Date(Date.now() - 86400000);
  const day7 = new Date(Date.now() - 7 * 86400000);
  const day30 = new Date(Date.now() - 30 * 86400000);
  const [total, withGoal, dau, wau, mau, totalEntries, e7d, avgScore] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { goals: { some: { isActive: true } } } }),
    prisma.user.count({ where: { entries: { some: { createdAt: { gte: day1 } } } } }),
    prisma.user.count({ where: { entries: { some: { createdAt: { gte: day7 } } } } }),
    prisma.user.count({ where: { entries: { some: { createdAt: { gte: day30 } } } } }),
    prisma.entry.count(),
    prisma.entry.count({ where: { createdAt: { gte: day7 } } }),
    prisma.entry.aggregate({ _avg: { totalScore: true } }),
  ]);
  const conv = total > 0 ? ((withGoal / total) * 100).toFixed(1) : '0';
  const avg = avgScore._avg.totalScore?.toFixed(1) ?? 'N/A';
  return `📊 *Общий обзор*\n\n` +
    `👥 Пользователей: *${total}* (с целью: ${withGoal}, ${conv}%)\n` +
    `📱 DAU / WAU / MAU: *${dau} / ${wau} / ${mau}*\n\n` +
    `📝 Записей всего: *${totalEntries}*\n` +
    `📝 За 7 дней: *${e7d}*\n` +
    `⭐️ Средний балл: *${avg}/100*`;
}

async function getUsersPage(): Promise<string> {
  const day1 = new Date(Date.now() - 86400000);
  const day7 = new Date(Date.now() - 7 * 86400000);
  const day30 = new Date(Date.now() - 30 * 86400000);
  const [newToday, newWeek, newMonth, withNotify, notifyStats] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: day1 } } }),
    prisma.user.count({ where: { createdAt: { gte: day7 } } }),
    prisma.user.count({ where: { createdAt: { gte: day30 } } }),
    prisma.user.count({ where: { notifyEnabled: true } }),
    prisma.user.groupBy({ by: ['notifyHour'], _count: { id: true }, orderBy: { notifyHour: 'asc' } }),
  ]);
  const topHours = notifyStats.sort((a, b) => b._count.id - a._count.id).slice(0, 3).map(h => `${h.notifyHour}:00 (${h._count.id})`).join(', ');
  return `👥 *Пользователи*\n\n` +
    `➕ Новых за 24ч / 7д / 30д: *${newToday} / ${newWeek} / ${newMonth}*\n` +
    `🔔 С уведомлениями: *${withNotify}*\n` +
    `⏰ Популярное время: ${topHours || 'нет данных'}`;
}

async function getEntriesPage(): Promise<string> {
  const week = new Date(Date.now() - 7 * 86400000);
  const month = new Date(Date.now() - 30 * 86400000);
  const [total, e7d, e30d, scoreHigh, scoreMid, scoreLow, avgScore] = await Promise.all([
    prisma.entry.count(),
    prisma.entry.count({ where: { createdAt: { gte: week } } }),
    prisma.entry.count({ where: { createdAt: { gte: month } } }),
    prisma.entry.count({ where: { totalScore: { gte: 70 } } }),
    prisma.entry.count({ where: { totalScore: { gte: 40, lt: 70 } } }),
    prisma.entry.count({ where: { totalScore: { lt: 40 } } }),
    prisma.entry.aggregate({ _avg: { totalScore: true } }),
  ]);
  const avg = avgScore._avg.totalScore?.toFixed(1) ?? 'N/A';
  const pH = total > 0 ? ((scoreHigh / total) * 100).toFixed(0) : '0';
  const pM = total > 0 ? ((scoreMid / total) * 100).toFixed(0) : '0';
  const pL = total > 0 ? ((scoreLow / total) * 100).toFixed(0) : '0';
  return `📝 *Записи*\n\n` +
    `Всего / 7д / 30д: *${total} / ${e7d} / ${e30d}*\n` +
    `⭐️ Средний балл: *${avg}/100*\n\n` +
    `🟢 Высокие (70+): ${scoreHigh} (${pH}%)\n` +
    `🟡 Средние (40-69): ${scoreMid} (${pM}%)\n` +
    `🔴 Низкие (<40): ${scoreLow} (${pL}%)`;
}

async function getRetentionPage(): Promise<string> {
  const day7 = new Date(Date.now() - 7 * 86400000);
  const day14 = new Date(Date.now() - 14 * 86400000);
  const day30 = new Date(Date.now() - 30 * 86400000);
  const [old7, ret7, old30, ret30, avgStreak, churned] = await Promise.all([
    prisma.user.count({ where: { createdAt: { lte: day7 } } }),
    prisma.user.count({ where: { createdAt: { lte: day7 }, entries: { some: { createdAt: { gte: day7 } } } } }),
    prisma.user.count({ where: { createdAt: { lte: day30 } } }),
    prisma.user.count({ where: { createdAt: { lte: day30 }, entries: { some: { createdAt: { gte: day30 } } } } }),
    prisma.userStats.aggregate({ _avg: { currentStreak: true, longestStreak: true } }),
    prisma.user.count({ where: { createdAt: { lte: day14, gte: day30 }, entries: { none: { createdAt: { gte: day14 } } } } }),
  ]);
  const r7 = old7 > 0 ? ((ret7 / old7) * 100).toFixed(1) : 'N/A';
  const r30 = old30 > 0 ? ((ret30 / old30) * 100).toFixed(1) : 'N/A';
  const avgCur = avgStreak._avg.currentStreak?.toFixed(1) ?? '0';
  const avgLong = avgStreak._avg.longestStreak?.toFixed(1) ?? '0';
  return `🔄 *Retention*\n\n` +
    `7-дневный: *${r7}%* (${ret7}/${old7})\n` +
    `30-дневный: *${r30}%* (${ret30}/${old30})\n\n` +
    `🔥 Средний стрик: *${avgCur} дн.*\n` +
    `🏆 Лучший стрик (avg): *${avgLong} дн.*\n\n` +
    `👻 Отвалились (14-30д): *${churned}*`;
}

async function getFeedbackPage(): Promise<string> {
  const [total, withRating, avgRating, recent] = await Promise.all([
    prisma.feedback.count(),
    prisma.feedback.count({ where: { rating: { not: null } } }),
    prisma.feedback.aggregate({ _avg: { rating: true }, where: { rating: { not: null } } }),
    prisma.feedback.findMany({ orderBy: { createdAt: 'desc' }, take: 3, select: { text: true, rating: true, createdAt: true } }),
  ]);
  const avg = avgRating._avg.rating?.toFixed(1) ?? 'N/A';
  let text = `💬 *Обратная связь*\n\nВсего: *${total}* | С оценкой: *${withRating}* | Avg: *${avg}⭐*\n\n*Последние:*\n`;
  for (const f of recent) {
    const stars = f.rating ? '⭐'.repeat(f.rating) : '—';
    text += `\n${stars} _"${f.text.slice(0, 100)}${f.text.length > 100 ? '...' : ''}"_\n`;
  }
  return text;
}

async function getABTestPage(): Promise<string> {
  const [usersA, usersB, convA, convB] = await Promise.all([
    (prisma.user as any).count({ where: { abVariant: 'A' } }),
    (prisma.user as any).count({ where: { abVariant: 'B' } }),
    (prisma.user as any).count({ where: { abVariant: 'A', goals: { some: {} } } }),
    (prisma.user as any).count({ where: { abVariant: 'B', goals: { some: {} } } }),
  ]);
  const rA = usersA > 0 ? ((convA / usersA) * 100).toFixed(1) : '0';
  const rB = usersB > 0 ? ((convB / usersB) * 100).toFixed(1) : '0';
  const winner = parseFloat(rB) > parseFloat(rA) ? '🏆 Побеждает B' : parseFloat(rA) > parseFloat(rB) ? '🏆 Побеждает A' : '🤝 Ничья';
  return `🧪 *A/B тест онбординга*\n\n` +
    `*Вариант A* (стандартный):\n  Юзеров: ${usersA} | Создали цель: ${convA} (${rA}%)\n\n` +
    `*Вариант B* (конкретный вопрос):\n  Юзеров: ${usersB} | Создали цель: ${convB} (${rB}%)\n\n` +
    `${winner}`;
}

export async function buildDashPage(page: DashPage): Promise<{ text: string; keyboard: any }> {
  let text: string;
  switch (page) {
    case 'users':    text = await getUsersPage();    break;
    case 'entries':  text = await getEntriesPage();  break;
    case 'retention':text = await getRetentionPage();break;
    case 'feedback': text = await getFeedbackPage(); break;
    case 'abtest':   text = await getABTestPage();   break;
    default:         text = await getOverview();
  }
  return { text, keyboard: navKeyboard(page) };
}

export async function handleDashboard(ctx: Context, adminIds: string[]): Promise<void> {
  if (!adminIds.includes(String(ctx.from!.id))) { await ctx.reply('❌ Только для администраторов'); return; }
  const { text, keyboard } = await buildDashPage('overview');
  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}
