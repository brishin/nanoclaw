import { vi } from 'vitest';

export type MockStore = {
  chats: Map<string, { jid: string; name: string; lastMessageTime: string; channel?: string; isGroup: boolean }>;
  messages: Map<string, { messageId: string; chatJid: string; sender: string; senderName: string; content: string; timestamp: string; isFromMe: boolean; isBotMessage: boolean }>;
  scheduledTasks: Map<string, {
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
  }>;
  taskRunLogs: Array<{
    taskId: string;
    runAt: string;
    durationMs: number;
    status: string;
    result: string | null;
    error: string | null;
  }>;
  routerState: Map<string, string>;
  sessions: Map<string, string>;
  registeredGroups: Map<string, {
    jid: string;
    name: string;
    folder: string;
    triggerPattern: string;
    addedAt: string;
    containerConfig?: string;
    requiresTrigger: boolean;
  }>;
};

export function makeMockStore(): MockStore {
  return {
    chats: new Map(),
    messages: new Map(),
    scheduledTasks: new Map(),
    taskRunLogs: [],
    routerState: new Map(),
    sessions: new Map(),
    registeredGroups: new Map(),
  };
}

function toTaskRow(row: MockStore['scheduledTasks'] extends Map<string, infer V> ? V : never) {
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

export function makeMockConvexClient(store: MockStore) {
  return {
    query: vi.fn(async (ref: { _name: string }, args: Record<string, unknown>) => {
      const name = ref._name as string;

      if (name === 'groups:getAllChats') {
        return Array.from(store.chats.values())
          .filter((c) => c.jid !== '__group_sync__')
          .map((c) => ({
            jid: c.jid,
            name: c.name,
            last_message_time: c.lastMessageTime,
            channel: c.channel ?? '',
            is_group: c.isGroup ? 1 : 0,
          }))
          .sort((a, b) => (a.last_message_time > b.last_message_time ? -1 : 1));
      }

      if (name === 'groups:getLastGroupSync') {
        return store.chats.get('__group_sync__')?.lastMessageTime ?? null;
      }

      if (name === 'messages:getNew') {
        const { jids, lastTimestamp, botPrefix } = args as {
          jids: string[];
          lastTimestamp: string;
          botPrefix: string;
        };
        if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

        const all = Array.from(store.messages.values())
          .filter((m) => jids.includes(m.chatJid) && m.timestamp > lastTimestamp && !m.isBotMessage && !m.content.startsWith(`${botPrefix}:`))
          .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

        let newTimestamp = lastTimestamp;
        for (const m of all) {
          if (m.timestamp > newTimestamp) newTimestamp = m.timestamp;
        }

        return {
          messages: all.map((m) => ({
            id: m.messageId,
            chat_jid: m.chatJid,
            sender: m.sender,
            sender_name: m.senderName,
            content: m.content,
            timestamp: m.timestamp,
            is_from_me: m.isFromMe,
            is_bot_message: m.isBotMessage,
          })),
          newTimestamp,
        };
      }

      if (name === 'messages:getSince') {
        const { chatJid, sinceTimestamp, botPrefix } = args as {
          chatJid: string;
          sinceTimestamp: string;
          botPrefix: string;
        };
        return Array.from(store.messages.values())
          .filter((m) => m.chatJid === chatJid && m.timestamp > sinceTimestamp && !m.isBotMessage && !m.content.startsWith(`${botPrefix}:`))
          .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
          .map((m) => ({
            id: m.messageId,
            chat_jid: m.chatJid,
            sender: m.sender,
            sender_name: m.senderName,
            content: m.content,
            timestamp: m.timestamp,
            is_from_me: m.isFromMe,
            is_bot_message: m.isBotMessage,
          }));
      }

      if (name === 'tasks:getById') {
        const row = store.scheduledTasks.get(args.taskId as string);
        return row ? toTaskRow(row) : null;
      }

      if (name === 'tasks:getByGroup') {
        const groupFolder = args.groupFolder as string;
        return Array.from(store.scheduledTasks.values())
          .filter((row) => row.groupFolder === groupFolder)
          .map(toTaskRow);
      }

      if (name === 'tasks:getAll') {
        return Array.from(store.scheduledTasks.values()).map(toTaskRow);
      }

      if (name === 'tasks:getDue') {
        const now = args.now as string;
        return Array.from(store.scheduledTasks.values())
          .filter((row) => row.status === 'active' && row.nextRun !== undefined && row.nextRun <= now)
          .map(toTaskRow);
      }

      if (name === 'groups:getRouterState') {
        return store.routerState.get(args.key as string) ?? null;
      }

      if (name === 'sessions:get') {
        return store.sessions.get(args.groupFolder as string) ?? null;
      }

      if (name === 'sessions:getAll') {
        const result: Record<string, string> = {};
        store.sessions.forEach((value, key) => {
          result[key] = value;
        });
        return result;
      }

      if (name === 'groups:getRegisteredGroup') {
        const row = store.registeredGroups.get(args.jid as string);
        if (!row) return null;
        return {
          jid: row.jid,
          name: row.name,
          folder: row.folder,
          trigger: row.triggerPattern,
          added_at: row.addedAt,
          containerConfig: row.containerConfig ? JSON.parse(row.containerConfig) : undefined,
          requiresTrigger: row.requiresTrigger,
        };
      }

      if (name === 'groups:getAllRegisteredGroups') {
        return Array.from(store.registeredGroups.values()).map((row) => ({
          jid: row.jid,
          name: row.name,
          folder: row.folder,
          trigger: row.triggerPattern,
          added_at: row.addedAt,
          containerConfig: row.containerConfig ? JSON.parse(row.containerConfig) : undefined,
          requiresTrigger: row.requiresTrigger,
        }));
      }

      return null;
    }),

    mutation: vi.fn(async (ref: { _name: string }, args: Record<string, unknown>) => {
      const name = ref._name as string;

      if (name === 'groups:storeChatMetadata') {
        const { jid, timestamp, name: chatName, channel, isGroup } = args as {
          jid: string;
          timestamp: string;
          name?: string;
          channel?: string;
          isGroup?: boolean;
        };
        const existing = store.chats.get(jid);
        if (existing) {
          existing.lastMessageTime = existing.lastMessageTime > timestamp ? existing.lastMessageTime : timestamp;
          if (chatName) existing.name = chatName;
          if (channel !== undefined) existing.channel = channel;
          if (isGroup !== undefined) existing.isGroup = isGroup;
        } else {
          store.chats.set(jid, {
            jid,
            name: chatName ?? jid,
            lastMessageTime: timestamp,
            channel,
            isGroup: isGroup ?? false,
          });
        }
        return;
      }

      if (name === 'groups:updateChatName') {
        const { jid, name: chatName, now } = args as { jid: string; name: string; now: string };
        const existing = store.chats.get(jid);
        if (existing) {
          existing.name = chatName;
        } else {
          store.chats.set(jid, { jid, name: chatName, lastMessageTime: now, isGroup: false });
        }
        return;
      }

      if (name === 'groups:setLastGroupSync') {
        const { now } = args as { now: string };
        const existing = store.chats.get('__group_sync__');
        if (existing) {
          existing.lastMessageTime = now;
        } else {
          store.chats.set('__group_sync__', {
            jid: '__group_sync__',
            name: '__group_sync__',
            lastMessageTime: now,
            isGroup: false,
          });
        }
        return;
      }

      if (name === 'messages:store') {
        const row = args as {
          messageId: string;
          chatJid: string;
          sender: string;
          senderName: string;
          content: string;
          timestamp: string;
          isFromMe: boolean;
          isBotMessage: boolean;
        };
        store.messages.set(`${row.messageId}:${row.chatJid}`, row);
        return;
      }

      if (name === 'tasks:create') {
        const row = args as MockStore['scheduledTasks'] extends Map<string, infer V> ? V : never;
        store.scheduledTasks.set(row.taskId, row);
        return;
      }

      if (name === 'tasks:update') {
        const row = store.scheduledTasks.get(args.taskId as string);
        if (!row) return;

        const { prompt, scheduleType, scheduleValue, nextRun, status } = args as {
          prompt?: string;
          scheduleType?: 'cron' | 'interval' | 'once';
          scheduleValue?: string;
          nextRun?: string | null;
          status?: 'active' | 'paused' | 'completed';
        };
        if (prompt !== undefined) row.prompt = prompt;
        if (scheduleType !== undefined) row.scheduleType = scheduleType;
        if (scheduleValue !== undefined) row.scheduleValue = scheduleValue;
        if (nextRun !== undefined) row.nextRun = nextRun ?? undefined;
        if (status !== undefined) row.status = status;
        return;
      }

      if (name === 'tasks:remove') {
        store.scheduledTasks.delete(args.taskId as string);
        return;
      }

      if (name === 'tasks:updateAfterRun') {
        const row = store.scheduledTasks.get(args.taskId as string);
        if (!row) return;
        row.lastRun = args.now as string;
        row.lastResult = args.lastResult as string;
        row.nextRun = (args.nextRun as string | null) ?? undefined;
        if (args.nextRun === null) row.status = 'completed';
        return;
      }

      if (name === 'tasks:logRun') {
        store.taskRunLogs.push({
          taskId: args.taskId as string,
          runAt: args.runAt as string,
          durationMs: args.durationMs as number,
          status: args.status as string,
          result: (args.result as string | null) ?? null,
          error: (args.error as string | null) ?? null,
        });
        return;
      }

      if (name === 'groups:setRouterState') {
        store.routerState.set(args.key as string, args.value as string);
        return;
      }

      if (name === 'sessions:set') {
        store.sessions.set(args.groupFolder as string, args.sessionId as string);
        return;
      }

      if (name === 'groups:setRegisteredGroup') {
        const row = args as {
          jid: string;
          name: string;
          folder: string;
          trigger: string;
          addedAt: string;
          containerConfig?: string;
          requiresTrigger: boolean;
        };
        store.registeredGroups.set(row.jid, {
          jid: row.jid,
          name: row.name,
          folder: row.folder,
          triggerPattern: row.trigger,
          addedAt: row.addedAt,
          containerConfig: row.containerConfig,
          requiresTrigger: row.requiresTrigger,
        });
      }
    }),

    onUpdate: vi.fn().mockReturnValue(() => {}),
  };
}
