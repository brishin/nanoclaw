import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const get = query({
  args: { groupFolder: v.string() },
  handler: async (ctx, { groupFolder }) => {
    const row = await ctx.db
      .query("sessions")
      .withIndex("by_group", (q) => q.eq("groupFolder", groupFolder))
      .first();
    return row?.sessionId ?? null;
  },
});

export const set = mutation({
  args: { groupFolder: v.string(), sessionId: v.string() },
  handler: async (ctx, { groupFolder, sessionId }) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_group", (q) => q.eq("groupFolder", groupFolder))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { sessionId });
    } else {
      await ctx.db.insert("sessions", { groupFolder, sessionId });
    }
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("sessions").collect();
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.groupFolder] = row.sessionId;
    }
    return result;
  },
});
