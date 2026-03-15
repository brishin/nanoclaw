import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

import { ASSISTANT_NAME, CONVEX_URL } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { NewMessage, RegisteredGroup, ScheduledTask, TaskRunLog } from './types.js';

let client: ConvexClient;

export function initDatabase(): void {
  if (!CONVEX_URL) throw new Error('CONVEX_URL is not set in .env');
  client = new ConvexClient(CONVEX_URL);
}

/** @internal - for tests only. Injects a mock client. */
export function _initTestDatabase(mockClient: ConvexClient): void {
  client = mockClient;
}

export async function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): Promise<void> {
  await client.mutation(api.groups.storeChatMetadata, {
    jid: chatJid,
    timestamp,
    name,
    channel,
    isGroup,
  });
}

export async function updateChatName(chatJid: string, name: string): Promise<void> {
  await client.mutation(api.groups.updateChatName, {
    jid: chatJid,
    name,
    now: new Date().toISOString(),
  });
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

export async function getAllChats(): Promise<ChatInfo[]> {
  return client.query(api.groups.getAllChats, {});
}

export async function getLastGroupSync(): Promise<string | null> {
  return client.query(api.groups.getLastGroupSync, {});
}

export async function setLastGroupSync(): Promise<void> {
  await client.mutation(api.groups.setLastGroupSync, {
    now: new Date().toISOString(),
  });
}

export async function storeMessage(msg: NewMessage): Promise<void> {
  await client.mutation(api.messages.store, {
    messageId: msg.id,
    chatJid: msg.chat_jid,
    sender: msg.sender,
    senderName: msg.sender_name,
    content: msg.content,
    timestamp: msg.timestamp,
    isFromMe: msg.is_from_me ?? false,
    isBotMessage: msg.is_bot_message ?? false,
  });
}

export async function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): Promise<{ messages: NewMessage[]; newTimestamp: string }> {
  return client.query(api.messages.getNew, { jids, lastTimestamp, botPrefix });
}

export async function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): Promise<NewMessage[]> {
  return client.query(api.messages.getSince, {
    chatJid,
    sinceTimestamp,
    botPrefix,
  });
}

export async function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): Promise<void> {
  await client.mutation(api.tasks.create, {
    taskId: task.id,
    groupFolder: task.group_folder,
    chatJid: task.chat_jid,
    prompt: task.prompt,
    scheduleType: task.schedule_type,
    scheduleValue: task.schedule_value,
    contextMode: task.context_mode || 'isolated',
    nextRun: task.next_run ?? undefined,
    status: task.status,
    createdAt: task.created_at,
  });
}

export async function getTaskById(id: string): Promise<ScheduledTask | undefined> {
  const result = await client.query(api.tasks.getById, { taskId: id });
  return result ?? undefined;
}

export async function getTasksForGroup(groupFolder: string): Promise<ScheduledTask[]> {
  return client.query(api.tasks.getByGroup, { groupFolder });
}

export async function getAllTasks(): Promise<ScheduledTask[]> {
  return client.query(api.tasks.getAll, {});
}

export async function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): Promise<void> {
  await client.mutation(api.tasks.update, {
    taskId: id,
    prompt: updates.prompt,
    scheduleType: updates.schedule_type,
    scheduleValue: updates.schedule_value,
    nextRun: updates.next_run,
    status: updates.status,
  });
}

export async function deleteTask(id: string): Promise<void> {
  await client.mutation(api.tasks.remove, { taskId: id });
}

export async function getDueTasks(): Promise<ScheduledTask[]> {
  return client.query(api.tasks.getDue, { now: new Date().toISOString() });
}

export async function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): Promise<void> {
  await client.mutation(api.tasks.updateAfterRun, {
    taskId: id,
    nextRun,
    lastResult,
    now: new Date().toISOString(),
  });
}

export async function logTaskRun(log: TaskRunLog): Promise<void> {
  await client.mutation(api.tasks.logRun, {
    taskId: log.task_id,
    runAt: log.run_at,
    durationMs: log.duration_ms,
    status: log.status,
    result: log.result ?? undefined,
    error: log.error ?? undefined,
  });
}

export async function getRouterState(key: string): Promise<string | undefined> {
  const result = await client.query(api.groups.getRouterState, { key });
  return result ?? undefined;
}

export async function setRouterState(key: string, value: string): Promise<void> {
  await client.mutation(api.groups.setRouterState, { key, value });
}

export async function getSession(groupFolder: string): Promise<string | undefined> {
  const result = await client.query(api.sessions.get, { groupFolder });
  return result ?? undefined;
}

export async function setSession(groupFolder: string, sessionId: string): Promise<void> {
  await client.mutation(api.sessions.set, { groupFolder, sessionId });
}

export async function getAllSessions(): Promise<Record<string, string>> {
  return client.query(api.sessions.getAll, {});
}

export async function getRegisteredGroup(
  jid: string,
): Promise<(RegisteredGroup & { jid: string }) | undefined> {
  const result = await client.query(api.groups.getRegisteredGroup, { jid });
  if (!result) return undefined;
  if (!isValidGroupFolder(result.folder)) {
    logger.warn(
      { jid: result.jid, folder: result.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return result ?? undefined;
}

export async function setRegisteredGroup(
  jid: string,
  group: RegisteredGroup,
): Promise<void> {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  await client.mutation(api.groups.setRegisteredGroup, {
    jid,
    name: group.name,
    folder: group.folder,
    trigger: group.trigger,
    addedAt: group.added_at,
    containerConfig: group.containerConfig
      ? JSON.stringify(group.containerConfig)
      : undefined,
    requiresTrigger: group.requiresTrigger ?? true,
  });
}

export async function getAllRegisteredGroups(): Promise<Record<string, RegisteredGroup>> {
  const rows = await client.query(api.groups.getAllRegisteredGroups, {});
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger,
      added_at: row.added_at,
      containerConfig: row.containerConfig,
      requiresTrigger: row.requiresTrigger,
    };
  }
  return result;
}

export function subscribeToNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
  callback: (result: { messages: NewMessage[]; newTimestamp: string }) => void,
): () => void {
  return client.onUpdate(api.messages.getNew, { jids, lastTimestamp, botPrefix }, callback);
}

// Backfill ASSISTANT_NAME for getMessagesSince/getNewMessages
export { ASSISTANT_NAME };
