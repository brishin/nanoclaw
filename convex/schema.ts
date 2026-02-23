import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  chats: defineTable({
    jid: v.string(),
    name: v.optional(v.string()),
    lastMessageTime: v.optional(v.string()),
    channel: v.optional(v.string()),
    isGroup: v.boolean(),
  }).index("by_jid", ["jid"]),

  messages: defineTable({
    messageId: v.string(),
    chatJid: v.string(),
    sender: v.string(),
    senderName: v.string(),
    content: v.string(),
    timestamp: v.string(),
    isFromMe: v.boolean(),
    isBotMessage: v.boolean(),
  })
    .index("by_chat_timestamp", ["chatJid", "timestamp"])
    .index("by_timestamp", ["timestamp"]),

  scheduledTasks: defineTable({
    taskId: v.string(),
    groupFolder: v.string(),
    chatJid: v.string(),
    prompt: v.string(),
    scheduleType: v.union(v.literal("cron"), v.literal("interval"), v.literal("once")),
    scheduleValue: v.string(),
    contextMode: v.union(v.literal("isolated"), v.literal("group")),
    nextRun: v.optional(v.string()),
    lastRun: v.optional(v.string()),
    lastResult: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed")),
    createdAt: v.string(),
  })
    .index("by_status_nextRun", ["status", "nextRun"])
    .index("by_group", ["groupFolder"])
    .index("by_taskId", ["taskId"]),

  taskRunLogs: defineTable({
    taskId: v.string(),
    runAt: v.string(),
    durationMs: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_task", ["taskId", "runAt"]),

  routerState: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  sessions: defineTable({
    groupFolder: v.string(),
    sessionId: v.string(),
  }).index("by_group", ["groupFolder"]),

  registeredGroups: defineTable({
    jid: v.string(),
    name: v.string(),
    folder: v.string(),
    triggerPattern: v.string(),
    addedAt: v.string(),
    containerConfig: v.optional(v.string()),
    requiresTrigger: v.boolean(),
  }).index("by_jid", ["jid"]),
});
