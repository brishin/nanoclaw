import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory store for the db mock
const store = {
  chats: new Map<string, { jid: string; name: string; lastMessageTime: string; channel?: string; isGroup: boolean }>(),
};

vi.mock('./db.js', () => ({
  _initTestDatabase: vi.fn(),
  initDatabase: vi.fn(),
  storeChatMetadata: vi.fn(async (jid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) => {
    const existing = store.chats.get(jid);
    if (existing) {
      existing.lastMessageTime = existing.lastMessageTime > timestamp ? existing.lastMessageTime : timestamp;
      if (name) existing.name = name;
      if (channel !== undefined) existing.channel = channel;
      if (isGroup !== undefined) existing.isGroup = isGroup;
    } else {
      store.chats.set(jid, { jid, name: name ?? jid, lastMessageTime: timestamp, channel, isGroup: isGroup ?? false });
    }
  }),
  getAllChats: vi.fn(async () => {
    return Array.from(store.chats.values())
      .filter((c) => c.jid !== '__group_sync__')
      .map((c) => ({ jid: c.jid, name: c.name, last_message_time: c.lastMessageTime, channel: c.channel ?? '', is_group: c.isGroup ? 1 : 0 }))
      .sort((a, b) => (a.last_message_time > b.last_message_time ? -1 : 1));
  }),
  getRouterState: vi.fn(async () => null),
  getAllSessions: vi.fn(async () => ({})),
  getAllRegisteredGroups: vi.fn(async () => ({})),
}));

// Mock other deps that index.ts needs on import
vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  ASSISTANT_HAS_OWN_NUMBER: false,
  POLL_INTERVAL: 2000,
  TRIGGER_PATTERN: /^@Andy\b/i,
  MAIN_GROUP_FOLDER: 'main',
  DATA_DIR: '/tmp',
  STORE_DIR: '/tmp',
  GROUPS_DIR: '/tmp/groups',
  IDLE_TIMEOUT: 1800000,
  MAX_CONCURRENT_CONTAINERS: 5,
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getAvailableGroups, _setRegisteredGroups } from './index.js';
import { storeChatMetadata } from './db.js';

beforeEach(() => {
  store.chats.clear();
  _setRegisteredGroups({});
});

// --- JID ownership patterns ---

describe('JID ownership patterns', () => {
  it('WhatsApp group JID: ends with @g.us', () => {
    const jid = '12345678@g.us';
    expect(jid.endsWith('@g.us')).toBe(true);
  });

  it('WhatsApp DM JID: ends with @s.whatsapp.net', () => {
    const jid = '12345678@s.whatsapp.net';
    expect(jid.endsWith('@s.whatsapp.net')).toBe(true);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only groups, excludes DMs', async () => {
    await storeChatMetadata('group1@g.us', '2024-01-01T00:00:01.000Z', 'Group 1', 'whatsapp', true);
    await storeChatMetadata('user@s.whatsapp.net', '2024-01-01T00:00:02.000Z', 'User DM', 'whatsapp', false);
    await storeChatMetadata('group2@g.us', '2024-01-01T00:00:03.000Z', 'Group 2', 'whatsapp', true);

    const groups = await getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.jid)).toContain('group1@g.us');
    expect(groups.map((g) => g.jid)).toContain('group2@g.us');
    expect(groups.map((g) => g.jid)).not.toContain('user@s.whatsapp.net');
  });

  it('excludes __group_sync__ sentinel', async () => {
    await storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Group', 'whatsapp', true);

    const groups = await getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group@g.us');
  });

  it('marks registered groups correctly', async () => {
    await storeChatMetadata('reg@g.us', '2024-01-01T00:00:01.000Z', 'Registered', 'whatsapp', true);
    await storeChatMetadata('unreg@g.us', '2024-01-01T00:00:02.000Z', 'Unregistered', 'whatsapp', true);

    _setRegisteredGroups({
      'reg@g.us': {
        name: 'Registered',
        folder: 'registered',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

    const groups = await getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'reg@g.us');
    const unreg = groups.find((g) => g.jid === 'unreg@g.us');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', async () => {
    await storeChatMetadata('old@g.us', '2024-01-01T00:00:01.000Z', 'Old', 'whatsapp', true);
    await storeChatMetadata('new@g.us', '2024-01-01T00:00:05.000Z', 'New', 'whatsapp', true);
    await storeChatMetadata('mid@g.us', '2024-01-01T00:00:03.000Z', 'Mid', 'whatsapp', true);

    const groups = await getAvailableGroups();
    expect(groups[0].jid).toBe('new@g.us');
    expect(groups[1].jid).toBe('mid@g.us');
    expect(groups[2].jid).toBe('old@g.us');
  });

  it('excludes non-group chats regardless of JID format', async () => {
    await storeChatMetadata('unknown-format-123', '2024-01-01T00:00:01.000Z', 'Unknown');
    await storeChatMetadata('custom:abc', '2024-01-01T00:00:02.000Z', 'Custom DM', 'custom', false);
    await storeChatMetadata('group@g.us', '2024-01-01T00:00:03.000Z', 'Group', 'whatsapp', true);

    const groups = await getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group@g.us');
  });

  it('returns empty array when no chats exist', async () => {
    const groups = await getAvailableGroups();
    expect(groups).toHaveLength(0);
  });
});
