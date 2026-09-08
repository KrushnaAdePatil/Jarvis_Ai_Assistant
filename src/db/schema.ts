import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

// Conversation memory — every exchange between Sir and JARVIS is archived.
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(), // 'user' | 'jarvis' | 'system'
  content: text("content").notNull(),
  intent: text("intent"),
  mode: text("mode").notNull().default("jarvis"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Long-term memory — preferences, facts, names JARVIS has learned.
export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Tasks / to-do items with priority levels.
export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  task: text("task").notNull(),
  priority: text("priority").notNull().default("normal"), // low | normal | high
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// FRIDAY security & monitoring event log.
export const securityEvents = pgTable("security_events", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"), // info | warning | critical
  source: text("source").notNull().default("FRIDAY"),
  message: text("message").notNull(),
  acknowledged: boolean("acknowledged").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Custom taught commands — "when I say X, do Y".
export const customCommands = pgTable("custom_commands", {
  id: serial("id").primaryKey(),
  triggerPhrase: text("trigger_phrase").notNull().unique(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
