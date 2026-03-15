import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const create = mutation({
  args: {
    taskId: v.string(),
    groupFolder: v.string(),
    chatJid: v.string(),
    prompt: v.string(),
    scheduleType: v.union(v.literal("cron"), v.literal("interval"), v.literal("once")),
    scheduleValue: v.string(),
    contextMode: v.union(v.literal("isolated"), v.literal("group")),
    nextRun: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed")),
    createdAt: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("scheduledTasks", {
      taskId: args.taskId,
      groupFolder: args.groupFolder,
      chatJid: args.chatJid,
      prompt: args.prompt,
      scheduleType: args.scheduleType,
      scheduleValue: args.scheduleValue,
      contextMode: args.contextMode,
      nextRun: args.nextRun,
      status: args.status,
      createdAt: args.createdAt,
    });
  },
});

export const getById = query({
  args: { taskId: v.string() },
  handler: async (ctx, { taskId }) => {
    const row = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
      .first();
    if (!row) return null;
    return rowToTask(row);
  },
});

export const getByGroup = query({
  args: { groupFolder: v.string() },
  handler: async (ctx, { groupFolder }) => {
    const rows = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_group", (q) => q.eq("groupFolder", groupFolder))
      .collect();
    return rows.map(rowToTask).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("scheduledTasks").collect();
    return rows.map(rowToTask).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  },
});

export const update = mutation({
  args: {
    taskId: v.string(),
    prompt: v.optional(v.string()),
    scheduleType: v.optional(v.union(v.literal("cron"), v.literal("interval"), v.literal("once"))),
    scheduleValue: v.optional(v.string()),
    nextRun: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("completed"))),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .first();
    if (!row) return;

    const patch: Record<string, unknown> = {};
    if (args.prompt !== undefined) patch.prompt = args.prompt;
    if (args.scheduleType !== undefined) patch.scheduleType = args.scheduleType;
    if (args.scheduleValue !== undefined) patch.scheduleValue = args.scheduleValue;
    if (args.nextRun !== undefined) patch.nextRun = args.nextRun ?? undefined;
    if (args.status !== undefined) patch.status = args.status;

    await ctx.db.patch(row._id, patch);
  },
});

export const remove = mutation({
  args: { taskId: v.string() },
  handler: async (ctx, { taskId }) => {
    // Delete run logs
    const logs = await ctx.db
      .query("taskRunLogs")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    for (const log of logs) {
      await ctx.db.delete(log._id);
    }
    // Delete task
    const row = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

export const getDue = query({
  args: { now: v.string() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_status_nextRun", (q) => q.eq("status", "active"))
      .filter((q) =>
        q.and(
          q.neq(q.field("nextRun"), undefined),
          q.lte(q.field("nextRun"), now),
        ),
      )
      .collect();
    return rows
      .map(rowToTask)
      .sort((a, b) => (a.next_run ?? "") < (b.next_run ?? "") ? -1 : 1);
  },
});

export const updateAfterRun = mutation({
  args: {
    taskId: v.string(),
    nextRun: v.union(v.string(), v.null()),
    lastResult: v.string(),
    now: v.string(),
  },
  handler: async (ctx, { taskId, nextRun, lastResult, now }) => {
    const row = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
      .first();
    if (!row) return;

    const patch: Record<string, unknown> = {
      lastRun: now,
      lastResult,
      nextRun: nextRun ?? undefined,
    };
    if (nextRun === null) patch.status = "completed";

    await ctx.db.patch(row._id, patch);
  },
});

export const logRun = mutation({
  args: {
    taskId: v.string(),
    runAt: v.string(),
    durationMs: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("taskRunLogs", args);
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTask(row: any) {
  return {
    id: row.taskId as string,
    group_folder: row.groupFolder as string,
    chat_jid: row.chatJid as string,
    prompt: row.prompt as string,
    schedule_type: row.scheduleType as "cron" | "interval" | "once",
    schedule_value: row.scheduleValue as string,
    context_mode: row.contextMode as "group" | "isolated",
    next_run: (row.nextRun as string | undefined) ?? null,
    last_run: (row.lastRun as string | undefined) ?? null,
    last_result: (row.lastResult as string | undefined) ?? null,
    status: row.status as "active" | "paused" | "completed",
    created_at: row.createdAt as string,
  };
}
