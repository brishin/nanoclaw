import { readFileSync } from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMockConvexClient, makeMockStore, type MockStore } from './test-utils/mock-convex.js';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: loggerMock,
}));

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
  getAllRegisteredGroups,
  getRegisteredGroup,
  getAllSessions,
  getRouterState,
  setRegisteredGroup,
  setRouterState,
  setSession,
} from './db.js';

let store: MockStore;

beforeEach(() => {
  store = makeMockStore();
  _initTestDatabase(makeMockConvexClient(store) as unknown as import('convex/browser').ConvexClient);
  vi.clearAllMocks();
});

describe('upstream regression contracts', () => {
  it('rejects invalid folder in setRegisteredGroup', async () => {
    await expect(
      setRegisteredGroup('bad@g.us', {
        name: 'Bad',
        folder: '../../outside',
        trigger: '@Andy',
        added_at: '2026-02-23T00:00:00.000Z',
      }),
    ).rejects.toThrow('Invalid group folder');
  });

  it('filters invalid folders in getRegisteredGroup and logs warning', async () => {
    store.registeredGroups.set('bad@g.us', {
      jid: 'bad@g.us',
      name: 'Bad',
      folder: '../escape',
      triggerPattern: '@Andy',
      addedAt: '2026-02-23T00:00:00.000Z',
      requiresTrigger: true,
    });

    const group = await getRegisteredGroup('bad@g.us');
    expect(group).toBeUndefined();
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('filters invalid folders in getAllRegisteredGroups while keeping valid rows', async () => {
    store.registeredGroups.set('valid@g.us', {
      jid: 'valid@g.us',
      name: 'Valid',
      folder: 'family',
      triggerPattern: '@Andy',
      addedAt: '2026-02-23T00:00:00.000Z',
      requiresTrigger: true,
    });
    store.registeredGroups.set('invalid@g.us', {
      jid: 'invalid@g.us',
      name: 'Invalid',
      folder: '..',
      triggerPattern: '@Andy',
      addedAt: '2026-02-23T00:00:00.000Z',
      requiresTrigger: true,
    });

    const groups = await getAllRegisteredGroups();
    expect(Object.keys(groups)).toEqual(['valid@g.us']);
    expect(groups['valid@g.us']?.folder).toBe('family');
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('round-trips router state and sessions', async () => {
    await setRouterState('last_timestamp', '2026-02-23T00:00:00.000Z');
    expect(await getRouterState('last_timestamp')).toBe('2026-02-23T00:00:00.000Z');

    await setSession('family', 'session-123');
    const sessions = await getAllSessions();
    expect(sessions).toEqual({ family: 'session-123' });
  });
});

describe('index merge invariants', () => {
  const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  it('uses resolveGroupFolderPath for group registration validation', () => {
    expect(indexSource).toMatch(/resolveGroupFolderPath\(group\.folder\)/);
  });

  it('notifies queue idleness on successful agent completion', () => {
    expect(indexSource).toMatch(/queue\.notifyIdle\(chatJid\)/);
  });

  it('passes assistantName to runContainerAgent', () => {
    expect(indexSource).toMatch(/assistantName:\s*ASSISTANT_NAME/);
  });
});
