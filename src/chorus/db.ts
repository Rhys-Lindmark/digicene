import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CHORUS_CONFIG, type ChorusModelId } from "./config";
import { IDENTITY_REGISTRY } from "./identities";
import type { ModelOutput, PublicUtterance } from "./types";

export type ChorusDatabase = DatabaseSync;

let sharedDatabase: DatabaseSync | undefined;

function databasePath() {
  return resolve(process.env.CHORUS_DB_PATH || "data/chorus.db");
}

export function openDatabase(path = databasePath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;",
  );
  migrate(db);
  return db;
}

export function getDatabase(): DatabaseSync {
  sharedDatabase ??= openDatabase();
  return sharedDatabase;
}

export function closeSharedDatabase() {
  sharedDatabase?.close();
  sharedDatabase = undefined;
}

function migrate(db: DatabaseSync) {
  db.exec(`
		CREATE TABLE IF NOT EXISTS identities (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			worldview TEXT NOT NULL,
			memory TEXT NOT NULL,
			affinities_json TEXT NOT NULL,
			relationships_json TEXT NOT NULL DEFAULT '[]',
			last_spoke_at INTEGER
		);
		CREATE TABLE IF NOT EXISTS utterances (
			id TEXT PRIMARY KEY,
			identity_id TEXT NOT NULL REFERENCES identities(id),
			utterance TEXT NOT NULL,
			section_id TEXT NOT NULL,
			reply_to_utterance_id TEXT REFERENCES utterances(id),
			mood TEXT NOT NULL,
			model_id TEXT NOT NULL,
			prompt_tokens INTEGER NOT NULL DEFAULT 0,
			completion_tokens INTEGER NOT NULL DEFAULT 0,
			reasoning_tokens INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			hidden_at INTEGER
		);
		CREATE INDEX IF NOT EXISTS utterances_recent ON utterances(created_at DESC);
		CREATE INDEX IF NOT EXISTS utterances_section ON utterances(section_id, created_at DESC);
		CREATE TABLE IF NOT EXISTS section_signals (
			session_id TEXT PRIMARY KEY,
			section_id TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS signals_recent ON section_signals(updated_at DESC);
		CREATE TABLE IF NOT EXISTS budget_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			request_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK(kind IN ('reservation', 'reconciliation')),
			amount_usd REAL NOT NULL,
			model_id TEXT NOT NULL,
			prompt_tokens INTEGER NOT NULL DEFAULT 0,
			completion_tokens INTEGER NOT NULL DEFAULT 0,
			reasoning_tokens INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS budget_window ON budget_events(created_at);
		CREATE UNIQUE INDEX IF NOT EXISTS one_reservation ON budget_events(request_id, kind) WHERE kind = 'reservation';
		CREATE UNIQUE INDEX IF NOT EXISTS one_reconciliation ON budget_events(request_id, kind) WHERE kind = 'reconciliation';
		CREATE TABLE IF NOT EXISTS worker_lease (
			name TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			expires_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS scheduler_state (
			name TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS generation_errors (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			model_id TEXT,
			code TEXT NOT NULL,
			message TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
	`);

  const insert = db.prepare(`
		INSERT INTO identities (id, name, worldview, memory, affinities_json, relationships_json)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			worldview = excluded.worldview,
			affinities_json = excluded.affinities_json,
			relationships_json = excluded.relationships_json
	`);
  for (const item of IDENTITY_REGISTRY) {
    insert.run(
      item.id,
      item.name,
      item.worldview,
      item.memory,
      JSON.stringify(item.affinities),
      JSON.stringify(item.relationships ?? []),
    );
  }
}

export function tryAcquireLease(
  db: DatabaseSync,
  ownerId: string,
  now = Date.now(),
  leaseMs: number = CHORUS_CONFIG.leaseMs,
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const lease = db
      .prepare("SELECT owner_id, expires_at FROM worker_lease WHERE name = ?")
      .get("chorus") as { owner_id: string; expires_at: number } | undefined;
    const acquired =
      !lease || lease.owner_id === ownerId || lease.expires_at <= now;
    if (acquired) {
      db.prepare(
        `INSERT INTO worker_lease(name, owner_id, expires_at) VALUES('chorus', ?, ?)
				ON CONFLICT(name) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at`,
      ).run(ownerId, now + leaseMs);
    }
    db.exec("COMMIT");
    return acquired;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function releaseLease(db: DatabaseSync, ownerId: string) {
  db.prepare(
    "DELETE FROM worker_lease WHERE name = 'chorus' AND owner_id = ?",
  ).run(ownerId);
}

export function currentRollingSpend(db: DatabaseSync, now = Date.now()) {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM budget_events WHERE created_at > ?",
    )
    .get(now - CHORUS_CONFIG.rollingWindowMs) as { total: number };
  return Math.max(0, row.total);
}

export function reserveBudget(
  db: DatabaseSync,
  requestId: string,
  modelId: ChorusModelId,
  amount: number,
  now = Date.now(),
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM budget_events WHERE created_at > ?",
      )
      .get(now - CHORUS_CONFIG.rollingWindowMs) as { total: number };
    const spent = Math.max(0, row.total);
    const allowed =
      spent < CHORUS_CONFIG.safetyCutoffUsd &&
      spent + amount <= CHORUS_CONFIG.targetBudgetUsd &&
      spent + amount < CHORUS_CONFIG.legalMaximumUsd;
    if (allowed) {
      db.prepare(
        `INSERT INTO budget_events(request_id, kind, amount_usd, model_id, created_at)
				VALUES(?, 'reservation', ?, ?, ?)`,
      ).run(requestId, amount, modelId, now);
    }
    db.exec("COMMIT");
    return { allowed, spent, projected: spent + amount };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function reconcileBudget(
  db: DatabaseSync,
  requestId: string,
  modelId: ChorusModelId,
  reserved: number,
  actual: number,
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
  },
  now = Date.now(),
) {
  const safeActual = Math.max(0, actual);
  // Keep both halves of the ledger entry on the same rolling-window boundary.
  // Otherwise the reservation could expire seconds before its negative delta
  // and temporarily undercount unrelated requests.
  const reservationEvent = db
    .prepare(
      "SELECT created_at FROM budget_events WHERE request_id = ? AND kind = 'reservation'",
    )
    .get(requestId) as { created_at: number } | undefined;
  const eventTime = reservationEvent?.created_at ?? now;
  db.prepare(
    `INSERT INTO budget_events(
		request_id, kind, amount_usd, model_id, prompt_tokens, completion_tokens, reasoning_tokens, created_at
	) VALUES(?, 'reconciliation', ?, ?, ?, ?, ?, ?)`,
  ).run(
    requestId,
    safeActual - reserved,
    modelId,
    usage.promptTokens,
    usage.completionTokens,
    usage.reasoningTokens,
    eventTime,
  );
}

export function recordSectionSignal(
  db: DatabaseSync,
  sessionId: string,
  sectionId: string,
  now = Date.now(),
) {
  db.prepare(
    `INSERT INTO section_signals(session_id, section_id, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET section_id = excluded.section_id, updated_at = excluded.updated_at`,
  ).run(sessionId, sectionId, now);
  db.prepare("DELETE FROM section_signals WHERE updated_at < ?").run(
    now - 60 * 60 * 1_000,
  );
}

export function getActiveSection(db: DatabaseSync, now = Date.now()) {
  const row = db
    .prepare(
      `SELECT section_id, COUNT(*) AS listeners, MAX(updated_at) AS latest
		FROM section_signals WHERE updated_at > ? GROUP BY section_id
		ORDER BY listeners DESC, latest DESC LIMIT 1`,
    )
    .get(now - 90_000) as { section_id: string } | undefined;
  return row?.section_id ?? "arrival";
}

export function listUtterances(
  db: DatabaseSync,
  sectionId?: string,
  after = 0,
  limit = 30,
): PublicUtterance[] {
  const rows = (
    sectionId
      ? db
          .prepare(
            `SELECT u.id, u.identity_id, i.name AS identity_name, u.utterance, u.section_id,
			u.reply_to_utterance_id, u.mood, u.created_at FROM utterances u JOIN identities i ON i.id = u.identity_id
			WHERE u.hidden_at IS NULL AND u.created_at > ? AND u.section_id = ? ORDER BY u.created_at DESC LIMIT ?`,
          )
          .all(after, sectionId, limit)
      : db
          .prepare(
            `SELECT u.id, u.identity_id, i.name AS identity_name, u.utterance, u.section_id,
			u.reply_to_utterance_id, u.mood, u.created_at FROM utterances u JOIN identities i ON i.id = u.identity_id
			WHERE u.hidden_at IS NULL AND u.created_at > ? ORDER BY u.created_at DESC LIMIT ?`,
          )
          .all(after, limit)
  ) as Array<Record<string, string | number | null>>;
  return rows.reverse().map((row) => ({
    id: String(row.id),
    identityId: String(row.identity_id),
    identityName: String(row.identity_name),
    utterance: String(row.utterance),
    sectionId: String(row.section_id),
    replyToUtteranceId: row.reply_to_utterance_id
      ? String(row.reply_to_utterance_id)
      : null,
    mood: String(row.mood),
    createdAt: Number(row.created_at),
  }));
}

export function listIdentityUtterances(
  db: DatabaseSync,
  identityId: string,
  after = 0,
  limit = 3,
): PublicUtterance[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.identity_id, i.name AS identity_name, u.utterance, u.section_id,
		u.reply_to_utterance_id, u.mood, u.created_at FROM utterances u JOIN identities i ON i.id = u.identity_id
		WHERE u.hidden_at IS NULL AND u.created_at > ? AND u.identity_id = ? ORDER BY u.created_at DESC LIMIT ?`,
    )
    .all(after, identityId, limit) as Array<
    Record<string, string | number | null>
  >;
  return rows.reverse().map((row) => ({
    id: String(row.id),
    identityId: String(row.identity_id),
    identityName: String(row.identity_name),
    utterance: String(row.utterance),
    sectionId: String(row.section_id),
    replyToUtteranceId: row.reply_to_utterance_id
      ? String(row.reply_to_utterance_id)
      : null,
    mood: String(row.mood),
    createdAt: Number(row.created_at),
  }));
}

export function saveUtterance(
  db: DatabaseSync,
  id: string,
  output: ModelOutput,
  modelId: ChorusModelId,
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
  },
  now = Date.now(),
) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO utterances(id, identity_id, utterance, section_id, reply_to_utterance_id, mood,
			model_id, prompt_tokens, completion_tokens, reasoning_tokens, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      output.identityId,
      output.utterance,
      output.sectionId,
      output.replyToUtteranceId,
      output.mood,
      modelId,
      usage.promptTokens,
      usage.completionTokens,
      usage.reasoningTokens,
      now,
    );
    db.prepare(
      "UPDATE identities SET memory = ?, last_spoke_at = ? WHERE id = ?",
    ).run(output.memoryUpdate, now, output.identityId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function hideUtterance(db: DatabaseSync, id: string, now = Date.now()) {
  return (
    db
      .prepare(
        "UPDATE utterances SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL",
      )
      .run(now, id).changes > 0
  );
}

export function recordError(
  db: DatabaseSync,
  modelId: string | null,
  code: string,
  message: string,
  now = Date.now(),
) {
  db.prepare(
    "INSERT INTO generation_errors(model_id, code, message, created_at) VALUES(?, ?, ?, ?)",
  ).run(
    modelId,
    code.slice(0, 80),
    message.replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500),
    now,
  );
}

export function getState(db: DatabaseSync, name: string, fallback = "") {
  const row = db
    .prepare("SELECT value FROM scheduler_state WHERE name = ?")
    .get(name) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setState(db: DatabaseSync, name: string, value: string) {
  db.prepare(
    `INSERT INTO scheduler_state(name, value) VALUES(?, ?)
		ON CONFLICT(name) DO UPDATE SET value = excluded.value`,
  ).run(name, value);
}

export function nextBeatNumber(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = Number(getState(db, "beat", "0")) || 0;
    setState(db, "beat", String(current + 1));
    db.exec("COMMIT");
    return current;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
