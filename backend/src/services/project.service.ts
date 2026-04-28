import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface CreateProjectInput {
  userId: string;
  title: string;
  description?: string;
  deadline?: string;
}

export interface ProjectStats {
  total: number;
  active: number;
  completed: number;
  totalTasks: number;
  doneTasks: number;
  totalTime: number; // minutes
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createProject(input: CreateProjectInput) {
  return prisma.project.create({
    data: {
      userId: input.userId,
      title: input.title,
      description: input.description || null,
      deadline: input.deadline ? new Date(input.deadline) : null,
    },
    include: { tasks: true },
  });
}

export async function getProject(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      tasks: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

export async function listProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId, status: { not: 'archived' } },
    include: {
      tasks: true,
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function updateProject(
  projectId: string,
  userId: string,
  data: { title?: string; description?: string; deadline?: string | null; status?: string }
) {
  const update: any = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined) update.description = data.description;
  if (data.deadline !== undefined) update.deadline = data.deadline ? new Date(data.deadline) : null;
  if (data.status !== undefined) update.status = data.status;

  return prisma.project.updateMany({
    where: { id: projectId, userId },
    data: update,
  });
}

export async function deleteProject(projectId: string, userId: string) {
  return prisma.project.updateMany({
    where: { id: projectId, userId },
    data: { status: 'archived' },
  });
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getProjectStats(userId: string): Promise<ProjectStats> {
  const projects = await prisma.project.findMany({
    where: { userId, status: { not: 'archived' } },
    include: { tasks: true },
  });

  const stats: ProjectStats = {
    total: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    totalTasks: 0,
    doneTasks: 0,
    totalTime: 0,
  };

  for (const p of projects) {
    stats.totalTasks += p.tasks.length;
    stats.doneTasks += p.tasks.filter((t) => t.status === 'done').length;
    stats.totalTime += p.tasks.reduce((sum, t) => sum + (t.actualTime || 0), 0);
  }

  return stats;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatProjectList(projects: any[], stats: ProjectStats): string {
  if (projects.length === 0) {
    return '📂 *Проекты*\n\nУ тебя пока нет проектов. Создай первый:\n`/project create "Название проекта"`';
  }

  const lines = projects.map((p) => {
    const done = p.tasks.filter((t: any) => t.status === 'done').length;
    const total = p.tasks.length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    const bar = renderProgressBar(progress);
    const emoji = p.status === 'completed' ? '✅' : '🎯';
    return `${emoji} *${p.title}* ${bar} ${progress}%\n   ${done}/${total} задач · ${p._timeStr || '0ч'}`;
  });

  return `📂 *Проекты* (${stats.active} активных · ${stats.completed} завершено)\n\n`
    + lines.join('\n\n')
    + `\n\n📊 Всего: ${stats.totalTasks} задач, ${stats.doneTasks} выполнено, ${Math.round(stats.totalTime / 60)}ч`;
}

export function formatProjectDetail(project: any): string {
  const done = project.tasks.filter((t: any) => t.status === 'done').length;
  const total = project.tasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = renderProgressBar(progress);
  const totalTime = project.tasks.reduce((sum: number, t: any) => sum + (t.actualTime || 0), 0);

  const deadlineStr = project.deadline
    ? `📅 Дедлайн: ${new Date(project.deadline).toLocaleDateString('ru-RU')}`
    : '📅 Без дедлайна';

  const tasksStr = project.tasks
    .map((t: any) => {
      const statusEmoji: Record<string, string> = {
        todo: '📝',
        in_progress: '🔄',
        blocked: '⛔',
        done: '✅',
      };
      const prioEmoji: Record<string, string> = {
        low: '🟢',
        medium: '🟡',
        high: '🟠',
        urgent: '🔴',
      };
      return `${statusEmoji[t.status] || '📝'} ${prioEmoji[t.priority] || '🟡'} *${t.title}*${t.estimatedTime ? ` (${t.estimatedTime}м)` : ''}`;
    })
    .join('\n');

  return `🎯 *${project.title}*\n${deadlineStr}\n${bar} ${progress}%\n\n`
    + `📋 *Задачи* (${done}/${total})\n${tasksStr || '_Нет задач_'}\n\n`
    + `⏱️ Всего времени: ${Math.round(totalTime / 60)}ч ${totalTime % 60}м`;
}

function renderProgressBar(percent: number, length = 10): string {
  const filled = Math.round((percent / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}
