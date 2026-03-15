import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

// --- Chat metadata ---

export const storeChatMetadata = mutation({
  args: {
    jid: v.string(),
    timestamp: v.string(),
    name: v.optional(v.string()),
    channel: v.optional(v.string()),
    isGroup: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chats")
      .withIndex("by_jid", (q) => q.eq("jid", args.jid))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {
        lastMessageTime:
          (existing.lastMessageTime ?? "") > args.timestamp
            ? existing.lastMessageTime
            : args.timestamp,
      };
      if (args.name) patch.name = args.name;
      if (args.channel !== undefined) patch.channel = args.channel ?? existing.channel;
      if (args.isGroup !== undefined) patch.isGroup = args.isGroup ?? existing.isGroup;
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("chats", {
        jid: args.jid,
        name: args.name ?? args.jid,
        lastMessageTime: args.timestamp,
        channel: args.channel,
        isGroup: args.isGroup ?? false,
      });
    }
  },
});

export const updateChatName = mutation({
  args: { jid: v.string(), name: v.string(), now: v.string() },
  handler: async (ctx, { jid, name, now }) => {
    const existing = await ctx.db
      .query("chats")
      .withIndex("by_jid", (q) => q.eq("jid", jid))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { name });
    } else {
      await ctx.db.insert("chats", {
        jid,
        name,
        lastMessageTime: now,
        isGroup: false,
      });
    }
  },
});

export const getAllChats = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("chats").collect();
    return rows
      .map((r) => ({
        jid: r.jid,
        name: r.name ?? r.jid,
        last_message_time: r.lastMessageTime ?? "",
        channel: r.channel ?? "",
        is_group: r.isGroup ? 1 : 0,
      }))
      .sort((a, b) =>
        a.last_message_time > b.last_message_time ? -1 : 1,
      );
  },
});

export const getLastGroupSync = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("chats")
      .withIndex("by_jid", (q) => q.eq("jid", "__group_sync__"))
      .first();
    return row?.lastMessageTime ?? null;
  },
});

export const setLastGroupSync = mutation({
  args: { now: v.string() },
  handler: async (ctx, { now }) => {
    const existing = await ctx.db
      .query("chats")
      .withIndex("by_jid", (q) => q.eq("jid", "__group_sync__"))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { lastMessageTime: now });
    } else {
      await ctx.db.insert("chats", {
        jid: "__group_sync__",
        name: "__group_sync__",
        lastMessageTime: now,
        isGroup: false,
      });
    }
  },
});

// --- Registered groups ---

export const getRegisteredGroup = query({
  args: { jid: v.string() },
  handler: async (ctx, { jid }) => {
    const row = await ctx.db
      .query("registeredGroups")
      .withIndex("by_jid", (q) => q.eq("jid", jid))
      .first();
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
  },
});

export const setRegisteredGroup = mutation({
  args: {
    jid: v.string(),
    name: v.string(),
    folder: v.string(),
    trigger: v.string(),
    addedAt: v.string(),
    containerConfig: v.optional(v.string()),
    requiresTrigger: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("registeredGroups")
      .withIndex("by_jid", (q) => q.eq("jid", args.jid))
      .first();
    const data = {
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      triggerPattern: args.trigger,
      addedAt: args.addedAt,
      containerConfig: args.containerConfig,
      requiresTrigger: args.requiresTrigger,
    };
    if (existing) {
      await ctx.db.replace(existing._id, data);
    } else {
      await ctx.db.insert("registeredGroups", data);
    }
  },
});

export const getAllRegisteredGroups = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("registeredGroups").collect();
    return rows.map((row) => ({
      jid: row.jid,
      name: row.name,
      folder: row.folder,
      trigger: row.triggerPattern,
      added_at: row.addedAt,
      containerConfig: row.containerConfig ? JSON.parse(row.containerConfig) : undefined,
      requiresTrigger: row.requiresTrigger,
    }));
  },
});

// --- Router state ---

export const getRouterState = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("routerState")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row?.value ?? null;
  },
});

export const setRouterState = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("routerState")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("routerState", { key, value });
    }
  },
});
