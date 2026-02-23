import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory store backing the mock Convex client
type Store = {
  chats: Map<string, { jid: string; name: string; lastMessageTime: string; channel?: string; isGroup: boolean }>;
  messages: Map<string, { messageId: string; chatJid: string; sender: string; senderName: string; content: string; timestamp: string; isFromMe: boolean; isBotMessage: boolean }>;
  scheduledTasks: Map<string, { taskId: string; groupFolder: string; chatJid: string; prompt: string; scheduleType: string; scheduleValue: string; contextMode: string; nextRun?: string; lastRun?: string; lastResult?: string; status: string; createdAt: string }>;
  routerState: Map<string, string>;
  sessions: Map<string, string>;
  registeredGroups: Map<string, { jid: string; name: string; folder: string; triggerPattern: string; addedAt: string; containerConfig?: string; requiresTrigger: boolean }>;
};

function makeStore(): Store {
  return {
    chats: new Map(),
    messages: new Map(),
    scheduledTasks: new Map(),
    routerState: new Map(),
    sessions: new Map(),
    registeredGroups: new Map(),
  };
}

let store: Store;

function makeMockClient() {
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
        const { jids, lastTimestamp, botPrefix } = args as { jids: string[]; lastTimestamp: string; botPrefix: string };
        if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };
        const all = Array.from(store.messages.values())
          .filter((m) => jids.includes(m.chatJid) && m.timestamp > lastTimestamp && !m.isBotMessage && !m.content.startsWith(`${botPrefix}:`))
          .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
        let newTimestamp = lastTimestamp;
        for (const m of all) {
          if (m.timestamp > newTimestamp) newTimestamp = m.timestamp;
        }
        return {
          messages: all.map((m) => ({ id: m.messageId, chat_jid: m.chatJid, sender: m.sender, sender_name: m.senderName, content: m.content, timestamp: m.timestamp, is_from_me: m.isFromMe, is_bot_message: m.isBotMessage })),
          newTimestamp,
        };
      }

      if (name === 'messages:getSince') {
        const { chatJid, sinceTimestamp, botPrefix } = args as { chatJid: string; sinceTimestamp: string; botPrefix: string };
        return Array.from(store.messages.values())
          .filter((m) => m.chatJid === chatJid && m.timestamp > sinceTimestamp && !m.isBotMessage && !m.content.startsWith(`${botPrefix}:`))
          .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
          .map((m) => ({ id: m.messageId, chat_jid: m.chatJid, sender: m.sender, sender_name: m.senderName, content: m.content, timestamp: m.timestamp, is_from_me: m.isFromMe, is_bot_message: m.isBotMessage }));
      }

      if (name === 'tasks:getById') {
        const row = store.scheduledTasks.get(args.taskId as string);
        if (!row) return null;
        return { id: row.taskId, group_folder: row.groupFolder, chat_jid: row.chatJid, prompt: row.prompt, schedule_type: row.scheduleType, schedule_value: row.scheduleValue, context_mode: row.contextMode, next_run: row.nextRun ?? null, last_run: row.lastRun ?? null, last_result: row.lastResult ?? null, status: row.status, created_at: row.createdAt };
      }

      if (name === 'tasks:getAll') {
        return Array.from(store.scheduledTasks.values()).map((row) => ({ id: row.taskId, group_folder: row.groupFolder, chat_jid: row.chatJid, prompt: row.prompt, schedule_type: row.scheduleType, schedule_value: row.scheduleValue, context_mode: row.contextMode, next_run: row.nextRun ?? null, last_run: row.lastRun ?? null, last_result: row.lastResult ?? null, status: row.status, created_at: row.createdAt }));
      }

      if (name === 'groups:getRouterState') {
        return store.routerState.get(args.key as string) ?? null;
      }

      if (name === 'sessions:getAll') {
        const result: Record<string, string> = {};
        store.sessions.forEach((v, k) => { result[k] = v; });
        return result;
      }

      if (name === 'groups:getAllRegisteredGroups') {
        return Array.from(store.registeredGroups.values()).map((r) => ({ jid: r.jid, name: r.name, folder: r.folder, trigger: r.triggerPattern, added_at: r.addedAt, containerConfig: r.containerConfig ? JSON.parse(r.containerConfig) : undefined, requiresTrigger: r.requiresTrigger }));
      }

      return null;
    }),

    mutation: vi.fn(async (ref: { _name: string }, args: Record<string, unknown>) => {
      const name = ref._name as string;

      if (name === 'groups:storeChatMetadata') {
        const { jid, timestamp, name: chatName, channel, isGroup } = args as { jid: string; timestamp: string; name?: string; channel?: string; isGroup?: boolean };
        const existing = store.chats.get(jid);
        if (existing) {
          existing.lastMessageTime = existing.lastMessageTime > timestamp ? existing.lastMessageTime : timestamp;
          if (chatName) existing.name = chatName;
          if (channel !== undefined) existing.channel = channel;
          if (isGroup !== undefined) existing.isGroup = isGroup;
        } else {
          store.chats.set(jid, { jid, name: chatName ?? jid, lastMessageTime: timestamp, channel, isGroup: isGroup ?? false });
        }
      }

      if (name === 'groups:updateChatName') {
        const { jid, name: chatName, now } = args as { jid: string; name: string; now: string };
        const existing = store.chats.get(jid);
        if (existing) {
          existing.name = chatName;
        } else {
          store.chats.set(jid, { jid, name: chatName, lastMessageTime: now, isGroup: false });
        }
      }

      if (name === 'groups:setLastGroupSync') {
        const { now } = args as { now: string };
        const existing = store.chats.get('__group_sync__');
        if (existing) {
          existing.lastMessageTime = now;
        } else {
          store.chats.set('__group_sync__', { jid: '__group_sync__', name: '__group_sync__', lastMessageTime: now, isGroup: false });
        }
      }

      if (name === 'messages:store') {
        const { messageId, chatJid } = args as { messageId: string; chatJid: string };
        const key = `${messageId}:${chatJid}`;
        store.messages.set(key, args as Store['messages'] extends Map<string, infer V> ? V : never);
      }

      if (name === 'tasks:create') {
        const { taskId } = args as { taskId: string };
        store.scheduledTasks.set(taskId, args as Store['scheduledTasks'] extends Map<string, infer V> ? V : never);
      }

      if (name === 'tasks:update') {
        const { taskId, prompt, scheduleType, scheduleValue, nextRun, status } = args as { taskId: string; prompt?: string; scheduleType?: string; scheduleValue?: string; nextRun?: string | null; status?: string };
        const row = store.scheduledTasks.get(taskId);
        if (row) {
          if (prompt !== undefined) row.prompt = prompt;
          if (scheduleType !== undefined) row.scheduleType = scheduleType;
          if (scheduleValue !== undefined) row.scheduleValue = scheduleValue;
          if (nextRun !== undefined) row.nextRun = nextRun ?? undefined;
          if (status !== undefined) row.status = status;
        }
      }

      if (name === 'tasks:remove') {
        store.scheduledTasks.delete(args.taskId as string);
      }

      if (name === 'groups:setRouterState') {
        store.routerState.set(args.key as string, args.value as string);
      }

      if (name === 'sessions:set') {
        store.sessions.set(args.groupFolder as string, args.sessionId as string);
      }

      if (name === 'groups:setRegisteredGroup') {
        const { jid } = args as { jid: string };
        store.registeredGroups.set(jid, args as Store['registeredGroups'] extends Map<string, infer V> ? V : never);
      }
    }),

    onUpdate: vi.fn().mockReturnValue(() => {}), // returns no-op unsubscribe
  };
}

// anyApi returns proxies with _name property — mirror that for the mock
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

vi.mock('convex/browser', () => ({
  ConvexClient: vi.fn(),
}));

import {
  _initTestDatabase,
  createTask,
  deleteTask,
  getAllChats,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  storeChatMetadata,
  storeMessage,
  updateTask,
} from './db.js';

beforeEach(() => {
  store = makeStore();
  _initTestDatabase(makeMockClient() as unknown as import('convex/browser').ConvexClient);
});

// Helper to store a message using the normalized NewMessage interface
async function store_msg(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  await storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

// --- storeMessage (NewMessage format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    await store_msg({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = await getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('stores empty content', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    await store_msg({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Dave',
      content: '',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const messages = await getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('');
  });

  it('stores is_from_me flag', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    await store_msg({
      id: 'msg-3',
      chat_jid: 'group@g.us',
      sender: 'me@s.whatsapp.net',
      sender_name: 'Me',
      content: 'my message',
      timestamp: '2024-01-01T00:00:05.000Z',
      is_from_me: true,
    });

    const messages = await getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
  });

  it('upserts on duplicate id+chat_jid', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    await store_msg({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'original',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    await store_msg({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'updated',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = await getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('updated');
  });
});

// --- getMessagesSince ---

describe('getMessagesSince', () => {
  beforeEach(async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    await store_msg({ id: 'm1', chat_jid: 'group@g.us', sender: 'Alice@s.whatsapp.net', sender_name: 'Alice', content: 'first', timestamp: '2024-01-01T00:00:01.000Z' });
    await store_msg({ id: 'm2', chat_jid: 'group@g.us', sender: 'Bob@s.whatsapp.net', sender_name: 'Bob', content: 'second', timestamp: '2024-01-01T00:00:02.000Z' });
    await storeMessage({ id: 'm3', chat_jid: 'group@g.us', sender: 'Bot@s.whatsapp.net', sender_name: 'Bot', content: 'bot reply', timestamp: '2024-01-01T00:00:03.000Z', is_bot_message: true });
    await store_msg({ id: 'm4', chat_jid: 'group@g.us', sender: 'Carol@s.whatsapp.net', sender_name: 'Carol', content: 'third', timestamp: '2024-01-01T00:00:04.000Z' });
  });

  it('returns messages after the given timestamp', async () => {
    const msgs = await getMessagesSince('group@g.us', '2024-01-01T00:00:02.000Z', 'Andy');
    // Should exclude m1, m2 (before/at timestamp), m3 (bot message)
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('third');
  });

  it('excludes bot messages via is_bot_message flag', async () => {
    const msgs = await getMessagesSince('group@g.us', '2024-01-01T00:00:00.000Z', 'Andy');
    const botMsgs = msgs.filter((m) => m.content === 'bot reply');
    expect(botMsgs).toHaveLength(0);
  });

  it('returns all non-bot messages when sinceTimestamp is empty', async () => {
    const msgs = await getMessagesSince('group@g.us', '', 'Andy');
    // 3 user messages (bot message excluded)
    expect(msgs).toHaveLength(3);
  });

  it('filters pre-migration bot messages via content prefix backstop', async () => {
    await store_msg({
      id: 'm5', chat_jid: 'group@g.us', sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot', content: 'Andy: old bot reply',
      timestamp: '2024-01-01T00:00:05.000Z',
    });
    const msgs = await getMessagesSince('group@g.us', '2024-01-01T00:00:04.000Z', 'Andy');
    expect(msgs).toHaveLength(0);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  beforeEach(async () => {
    await storeChatMetadata('group1@g.us', '2024-01-01T00:00:00.000Z');
    await storeChatMetadata('group2@g.us', '2024-01-01T00:00:00.000Z');

    await store_msg({ id: 'a1', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net', sender_name: 'User', content: 'g1 msg1', timestamp: '2024-01-01T00:00:01.000Z' });
    await store_msg({ id: 'a2', chat_jid: 'group2@g.us', sender: 'user@s.whatsapp.net', sender_name: 'User', content: 'g2 msg1', timestamp: '2024-01-01T00:00:02.000Z' });
    await storeMessage({ id: 'a3', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net', sender_name: 'User', content: 'bot reply', timestamp: '2024-01-01T00:00:03.000Z', is_bot_message: true });
    await store_msg({ id: 'a4', chat_jid: 'group1@g.us', sender: 'user@s.whatsapp.net', sender_name: 'User', content: 'g1 msg2', timestamp: '2024-01-01T00:00:04.000Z' });
  });

  it('returns new messages across multiple groups', async () => {
    const { messages, newTimestamp } = await getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    // Excludes bot message, returns 3 user messages
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:04.000Z');
  });

  it('filters by timestamp', async () => {
    const { messages } = await getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Only g1 msg2 (after ts, not bot)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('g1 msg2');
  });

  it('returns empty for no registered groups', async () => {
    const { messages, newTimestamp } = await getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });
});

// --- storeChatMetadata ---

describe('storeChatMetadata', () => {
  it('stores chat with JID as default name', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    const chats = await getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('group@g.us');
    expect(chats[0].name).toBe('group@g.us');
  });

  it('stores chat with explicit name', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'My Group');
    const chats = await getAllChats();
    expect(chats[0].name).toBe('My Group');
  });

  it('updates name on subsequent call with name', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Updated Name');
    const chats = await getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated Name');
  });

  it('preserves newer timestamp on conflict', async () => {
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:05.000Z');
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z');
    const chats = await getAllChats();
    expect(chats[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });
});

// --- Task CRUD ---

describe('task CRUD', () => {
  it('creates and retrieves a task', async () => {
    await createTask({
      id: 'task-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'do something',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const task = await getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('do something');
    expect(task!.status).toBe('active');
  });

  it('updates task status', async () => {
    await createTask({
      id: 'task-2',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await updateTask('task-2', { status: 'paused' });
    const task = await getTaskById('task-2');
    expect(task!.status).toBe('paused');
  });

  it('deletes a task and its run logs', async () => {
    await createTask({
      id: 'task-3',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'delete me',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await deleteTask('task-3');
    expect(await getTaskById('task-3')).toBeUndefined();
  });
});
