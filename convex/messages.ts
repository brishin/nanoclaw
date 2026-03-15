import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const store = mutation({
  args: {
    messageId: v.string(),
    chatJid: v.string(),
    sender: v.string(),
    senderName: v.string(),
    content: v.string(),
    timestamp: v.string(),
    isFromMe: v.boolean(),
    isBotMessage: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Upsert: delete existing record with same messageId+chatJid before inserting
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_chat_timestamp", (q) => q.eq("chatJid", args.chatJid))
      .filter((q) => q.eq(q.field("messageId"), args.messageId))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, args);
    } else {
      await ctx.db.insert("messages", args);
    }
  },
});

export const getNew = query({
  args: {
    jids: v.array(v.string()),
    lastTimestamp: v.string(),
    botPrefix: v.string(),
  },
  handler: async (ctx, { jids, lastTimestamp, botPrefix }) => {
    if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

    const allMessages = [];
    for (const jid of jids) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_chat_timestamp", (q) =>
          q.eq("chatJid", jid).gt("timestamp", lastTimestamp),
        )
        .filter((q) =>
          q.and(
            q.eq(q.field("isBotMessage"), false),
            q.not(q.eq(q.field("content").toString(), "")), // placeholder, see filter below
          ),
        )
        .collect();
      allMessages.push(...msgs);
    }

    // Filter out bot messages by prefix (backstop for pre-migration data)
    const filtered = allMessages.filter(
      (m) => !m.isBotMessage && !m.content.startsWith(`${botPrefix}:`),
    );

    // Sort by timestamp
    filtered.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

    let newTimestamp = lastTimestamp;
    for (const m of filtered) {
      if (m.timestamp > newTimestamp) newTimestamp = m.timestamp;
    }

    return {
      messages: filtered.map((m) => ({
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
  },
});

export const getSince = query({
  args: {
    chatJid: v.string(),
    sinceTimestamp: v.string(),
    botPrefix: v.string(),
  },
  handler: async (ctx, { chatJid, sinceTimestamp, botPrefix }) => {
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_chat_timestamp", (q) =>
        q.eq("chatJid", chatJid).gt("timestamp", sinceTimestamp),
      )
      .collect();

    const filtered = msgs.filter(
      (m) => !m.isBotMessage && !m.content.startsWith(`${botPrefix}:`),
    );

    filtered.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

    return filtered.map((m) => ({
      id: m.messageId,
      chat_jid: m.chatJid,
      sender: m.sender,
      sender_name: m.senderName,
      content: m.content,
      timestamp: m.timestamp,
      is_from_me: m.isFromMe,
      is_bot_message: m.isBotMessage,
    }));
  },
});
