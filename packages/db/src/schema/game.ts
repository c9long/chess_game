import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** Civ catalog. A civ's rules live in immutable `civilization_versions` rows. */
export const civilizations = pgTable('civilizations', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  emblemAsset: text('emblem_asset').notNull(),
  enabled: boolean('enabled').notNull().default(true),
})

/** Immutable (enforced by a trigger in the migrations). */
export const civilizationVersions = pgTable(
  'civilization_versions',
  {
    civId: integer('civ_id')
      .notNull()
      .references(() => civilizations.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    roster: jsonb('roster').notNull(),
    abilities: jsonb('abilities').notNull().default(sql`'{}'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.civId, t.version] })],
)

export const matchStatus = pgEnum('match_status', ['in_progress', 'finished', 'aborted'])
export const matchMode = pgEnum('match_mode', ['ffa', 'teams'])

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    status: matchStatus('status').notNull().default('in_progress'),
    mode: matchMode('mode').notNull(),
    /** '10+0' | '3+2' (TIME_CONTROLS in @game/config). */
    timeControl: text('time_control').notNull(),
    rated: boolean('rated').notNull().default(false),
    rulesVersion: integer('rules_version').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    /** e.g. 'last_standing', 'move_limit', 'server_restart'. */
    endReason: text('end_reason'),
  },
  (t) => [
    index('matches_status_idx').on(t.status),
    index('matches_started_at_idx').on(t.startedAt),
  ],
)

export const matchPlayers = pgTable(
  'match_players',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    /** 0 = South, 1 = West, 2 = North, 3 = East. */
    seat: smallint('seat').notNull(),
    team: smallint('team'),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    /** BOT_LEVELS label, e.g. '1200' or 'max'. */
    botLevel: text('bot_level'),
    civId: integer('civ_id')
      .notNull()
      .references(() => civilizations.id, { onDelete: 'restrict' }),
    civVersion: integer('civ_version').notNull(),
    finalStatus: text('final_status'),
    placement: smallint('placement'),
    defeatReason: text('defeat_reason'),
    defeatSeq: integer('defeat_seq'),
    ratingBefore: doublePrecision('rating_before'),
    ratingAfter: doublePrecision('rating_after'),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.seat] }),
    index('match_players_user_idx').on(t.userId),
    check('match_players_seat_range', sql`${t.seat} between 0 and 3`),
    check('match_players_human_xor_bot', sql`(${t.userId} is null) <> (${t.botLevel} is null)`),
    // A match can only reference a civ version that exists (replays re-simulate under it).
    foreignKey({
      name: 'match_players_civ_version_fk',
      columns: [t.civId, t.civVersion],
      foreignColumns: [civilizationVersions.civId, civilizationVersions.version],
    }).onDelete('restrict'),
  ],
)

export const matchEventType = pgEnum('match_event_type', [
  'move',
  'promotion',
  'pass',
  'defeat',
  'timeout',
  'abandon',
  'disconnect',
  'reconnect',
  'game_end',
  'resign',
  'draw_offer',
  'draw_response',
])

export const matchEvents = pgTable(
  'match_events',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    seat: smallint('seat'),
    type: matchEventType('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    clockRemainingMs: bigint('clock_remaining_ms', { mode: 'number' }),
    serverTs: ts('server_ts').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.seq] })],
)

export const ratings = pgTable(
  'ratings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    mode: matchMode('mode').notNull(),
    timeControl: text('time_control').notNull(),
    /**
     * Rating pool: 'public' (rated games: four registered humans) or 'shadow' (hidden;
     * casual games with bots, rated against `bot_level_anchors`; used to calibrate bot labels).
     */
    kind: text('kind').notNull().default('public'),
    mu: doublePrecision('mu').notNull(),
    sigma: doublePrecision('sigma').notNull(),
    gamesPlayed: integer('games_played').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('ratings_user_mode_tc_kind').on(t.userId, t.mode, t.timeControl, t.kind),
    check('ratings_kind_pool', sql`${t.kind} in ('public', 'shadow')`),
  ],
)

/**
 * Fixed OpenSkill ratings standing in for each bot level in shadow-rating updates (PLAN §6:
 * the hidden shadow ratings re-anchor bot labels against real humans). Not updated by games;
 * recalibration rewrites them from bot-arena / shadow-pool data.
 */
export const botLevelAnchors = pgTable('bot_level_anchors', {
  /** BOT_LEVELS label: '600' ... '2400' or 'max'. */
  botLevel: text('bot_level').primaryKey(),
  mu: doublePrecision('mu').notNull(),
  sigma: doublePrecision('sigma').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})
