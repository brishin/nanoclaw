import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _initTestDatabase, createTask, getTaskById } from './db.js';
import {
  _resetSchedulerLoopForTests,
  startSchedulerLoop,
} from './task-scheduler.js';

type TaskRow = {
  taskId: string;
  groupFolder: string;
  chatJid: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  contextMode: 'isolated' | 'group';
  nextRun?: string;
  lastRun?: string;
  lastResult?: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
};

const scheduledTasks = new Map<string, TaskRow>();

function toScheduledTask(row: TaskRow) {
  return {
    id: row.taskId,
    group_folder: row.groupFolder,
    chat_jid: row.chatJid,
    prompt: row.prompt,
    schedule_type: row.scheduleType,
    schedule_value: row.scheduleValue,
    context_mode: row.contextMode,
    next_run: row.nextRun ?? null,
    last_run: row.lastRun ?? null,
    last_result: row.lastResult ?? null,
    status: row.status,
    created_at: row.createdAt,
  };
}

function makeMockClient() {
  return {
    query: vi.fn(async (ref: { _name: string }, args: Record<string, unknown>) => {
      const name = ref._name as string;
      if (name === 'tasks:getDue') {
        const now = args.now as string;
        return Array.from(scheduledTasks.values())
          .filter((row) => row.status === 'active' && row.nextRun !== undefined && row.nextRun <= now)
          .map(toScheduledTask);
      }
      if (name === 'tasks:getById') {
        const row = scheduledTasks.get(args.taskId as string);
        return row ? toScheduledTask(row) : null;
      }
      if (name === 'tasks:getAll') {
        return Array.from(scheduledTasks.values()).map(toScheduledTask);
      }
      return null;
    }),
    mutation: vi.fn(async (ref: { _name: string }, args: Record<string, unknown>) => {
      const name = ref._name as string;
      if (name === 'tasks:create') {
        const row = args as unknown as TaskRow;
        scheduledTasks.set(row.taskId, row);
      }
      if (name === 'tasks:update') {
        const row = scheduledTasks.get(args.taskId as string);
        if (!row) return;
        if (args.status !== undefined) row.status = args.status as TaskRow['status'];
      }
      if (name === 'tasks:updateAfterRun') {
        const row = scheduledTasks.get(args.taskId as string);
        if (!row) return;
        row.lastRun = args.now as string;
        row.lastResult = args.lastResult as string;
        row.nextRun = (args.nextRun as string | null) ?? undefined;
        if (args.nextRun === null) row.status = 'completed';
      }
      if (name === 'tasks:logRun') return;
    }),
    onUpdate: vi.fn().mockReturnValue(() => {}),
  };
}

vi.mock('convex/server', () => {
  const handler: ProxyHandler<object> = {
    get(target: object, prop: string | symbol): unknown {
      if (prop === '_name') return (target as { _path: string })._path;
      return new Proxy({ _path: `${(target as { _path: string })._path}:${String(prop)}` }, handler);
    },
  };
  return {
    anyApi: new Proxy({ _path: '' }, {
      get(_target, prop: string | symbol) {
        return new Proxy({ _path: String(prop) }, handler);
      },
    }),
    componentsGeneric: () => ({}),
  };
});

describe('task scheduler', () => {
  beforeEach(() => {
    scheduledTasks.clear();
    _initTestDatabase(makeMockClient() as unknown as import('convex/browser').ConvexClient);
    _resetSchedulerLoopForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses due tasks with invalid group folders to prevent retry churn', async () => {
    await createTask({
      id: 'task-invalid-folder',
      group_folder: '../../outside',
      chat_jid: 'bad@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({}),
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    const task = await getTaskById('task-invalid-folder');
    expect(task?.status).toBe('paused');
  });
});
