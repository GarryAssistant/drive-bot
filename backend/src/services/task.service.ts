import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  estimatedTime?: number;
  deadline?: string;
}

export interface ActiveTimer {
  taskId: string;
  taskTitle: string;
  elapsedMinutes: number;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createTask(input: CreateTaskInput) {
  // Get max sortOrder for this project
  const lastTask = await prisma.task.findFirst({
    where: { projectId: input.projectId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  return prisma.task.create({
    data: {
      projectId: input.projectId,
      title: input.title,
      description: input.description || null,
      priority: input.priority || 'medium',
      estimatedTime: input.estimatedTime || null,
      deadline: input.deadline ? new Date(input.deadline) : null,
      sortOrder: (lastTask?.sortOrder ?? -1) + 1,
    },
  });
}

export async function getTask(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      timeLogs: { orderBy: { startTime: 'desc' } },
      project: { select: { userId: true, title: true } },
    },
  });
}

export async function updateTask(
  taskId: string,
  data: {
    title?: string;
    description?: string;
    priority?: string;
    status?: string;
    estimatedTime?: number | null;
    deadline?: string | null;
    sortOrder?: number;
  }
) {
  const update: any = {};
  if (data.title !== undefined) update.title = data.title;
  if (data.description !== undefined) update.description = data.description;
  if (data.priority !== undefined) update.priority = data.priority;
  if (data.status !== undefined) update.status = data.status;
  if (data.estimatedTime !== undefined) update.estimatedTime = data.estimatedTime;
  if (data.deadline !== undefined) update.deadline = data.deadline ? new Date(data.deadline) : null;
  if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;

  return prisma.task.update({
    where: { id: taskId },
    data: update,
  });
}

export async function deleteTask(taskId: string) {
  return prisma.task.delete({ where: { id: taskId } });
}

export async function reorderTasks(projectId: string, taskIds: string[]) {
  await prisma.$transaction(
    taskIds.map((id, index) =>
      prisma.task.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );
}

// ─── Status transitions ─────────────────────────────────────────────────────

export async function startTask(taskId: string) {
  return updateTask(taskId, { status: 'in_progress' });
}

export async function completeTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { estimatedTime: true, actualTime: true, projectId: true },
  });

  // Calculate actualTime from timeLogs if present
  const timeLogs = await prisma.timeLog.findMany({
    where: { taskId, endTime: { not: null } },
  });
  const actualTime = timeLogs.reduce((sum, l) => sum + (l.duration || 0), 0);

  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'done', actualTime },
  });

  return actualTime;
}

export async function blockTask(taskId: string, reason?: string) {
  return prisma.task.update({
    where: { id: taskId },
    data: { status: 'blocked', description: reason ? `${reason}` : undefined },
  });
}

// ─── Timer ──────────────────────────────────────────────────────────────────

// In-memory active timers (per-user). For production use Redis.
const activeTimers = new Map<string, { taskId: string; startTime: Date }>();

export function startTimer(userId: string, taskId: string, taskTitle: string) {
  activeTimers.set(userId, { taskId, startTime: new Date() });
  return { taskId, taskTitle, startedAt: new Date() };
}

export function stopTimer(userId: string): { taskId: string; durationMinutes: number; durationMs: number } | null {
  const timer = activeTimers.get(userId);
  if (!timer) return null;

  activeTimers.delete(userId);
  const now = new Date();
  const durationMs = now.getTime() - timer.startTime.getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  // Save TimeLog
  prisma.timeLog.create({
    data: {
      taskId: timer.taskId,
      startTime: timer.startTime,
      endTime: now,
      duration: durationMinutes || 1, // minimum 1 min
    },
  }).catch((err) => console.error('Failed to save time log:', err));

  // Update task actualTime
  prisma.task.findUnique({ where: { id: timer.taskId } }).then((task) => {
    if (task) {
      const current = task.actualTime || 0;
      prisma.task.update({
        where: { id: timer.taskId },
        data: { actualTime: current + durationMinutes },
      }).catch(console.error);
    }
  }).catch(console.error);

  return {
    taskId: timer.taskId,
    durationMinutes: durationMinutes || 1,
    durationMs,
  };
}

export function getActiveTimer(userId: string): ActiveTimer | null {
  const timer = activeTimers.get(userId);
  if (!timer) return null;

  const elapsedMs = Date.now() - timer.startTime.getTime();
  const elapsedMinutes = Math.round(elapsedMs / 60000);

  return {
    taskId: timer.taskId,
    taskTitle: '',
    elapsedMinutes,
  };
}

export function getActiveTimerTaskId(userId: string): string | null {
  return activeTimers.get(userId)?.taskId || null;
}

// ─── Task listing ───────────────────────────────────────────────────────────

export async function getProjectTasks(projectId: string) {
  return prisma.task.findMany({
    where: { projectId },
    orderBy: { sortOrder: 'asc' },
    include: {
      timeLogs: { orderBy: { startTime: 'desc' }, take: 1 },
    },
  });
}

export async function getUserPendingTasks(userId: string, limit = 20) {
  // Get tasks through projects
  const tasks = await prisma.task.findMany({
    where: {
      project: { userId, status: 'active' },
      status: { in: ['todo', 'in_progress', 'blocked'] },
    },
    include: {
      project: { select: { title: true } },
    },
    orderBy: [
      { priority: 'desc' },
      { deadline: 'asc' },
    ],
    take: limit,
  });

  return tasks;
}
