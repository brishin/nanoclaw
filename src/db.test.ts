import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMockConvexClient, makeMockStore, type MockStore } from './test-utils/mock-convex.js';

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
  getAllRegisteredGroups,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  setRegisteredGroup,
  storeChatMetadata,
  storeMessage,
  updateTask,
} from './db.js';

let store: MockStore;

beforeEach(() => {
  store = makeMockStore();
  _initTestDatabase(makeMockConvexClient(store) as unknown as import('convex/browser').ConvexClient);
});
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

