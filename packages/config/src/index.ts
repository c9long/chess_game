/**
 * Display name of the game. This is the only place the title may appear;
 * code identifiers and package names stay neutral so a rename is one line.
 */
export const APP_NAME = "LinkedLists's Chess Game"

/**
 * Label under the home-screen icon (web manifest `short_name`, app stores later). Launchers
 * show about 12 characters; set a shorter form here once the title is final.
 */
export const APP_SHORT_NAME: string = APP_NAME

/** Civilizations selectable in v1, in display order. Slugs are stable identifiers. */
export const CIVILIZATIONS = [
  { slug: 'canada', name: 'Canada' },
  { slug: 'usa', name: 'United States' },
  { slug: 'china', name: 'China' },
  { slug: 'japan', name: 'Japan' },
  { slug: 'germany', name: 'Germany' },
  { slug: 'russia', name: 'Russia' },
  { slug: 'england', name: 'England' },
  { slug: 'france', name: 'France' },
  { slug: 'mali', name: 'Mali' },
] as const

export type CivSlug = (typeof CIVILIZATIONS)[number]['slug']

export * from './civ-info.ts'

/** Time controls offered in v1: base minutes + increment seconds. */
export const TIME_CONTROLS = {
  '10+0': { baseMs: 10 * 60_000, incrementMs: 0 },
  '3+2': { baseMs: 3 * 60_000, incrementMs: 2_000 },
} as const

export type TimeControlId = keyof typeof TIME_CONTROLS

/** Selectable bot strength labels (on our own 4-player ladder, not FIDE Elo). */
export const BOT_LEVELS = [600, 900, 1200, 1500, 1800, 2100, 2400, 'max'] as const

export type BotLevel = (typeof BOT_LEVELS)[number]

/**
 * Current versions of the clickwrap legal documents (docs/legal/). Bumping a version after
 * a material change makes every user re-accept before continuing.
 */
export const LEGAL_VERSIONS = {
  terms: '0.2',
  privacy: '0.2',
} as const

export type LegalDocument = keyof typeof LEGAL_VERSIONS

export const LEGAL_DOCUMENTS = Object.keys(LEGAL_VERSIONS) as LegalDocument[]

/** How each document is agreed to (PLAN §5): the Terms are accepted, the Privacy Policy acknowledged. */
export const LEGAL_ACCEPTANCE_KIND = {
  terms: 'accepted',
  privacy: 'acknowledged',
} as const satisfies Record<LegalDocument, 'accepted' | 'acknowledged'>

/**
 * Dispute option chosen by the reviewing attorney (Terms §17-19): 'A' (arbitration) shows the
 * arbitration notice under the clickwrap checkbox; 'B' (courts) does not. Undecided until the
 * attorney review, so the notice stays off.
 */
export const DISPUTE_OPTION: 'A' | 'B' | undefined = undefined

/** Clickwrap line shown under the checkbox when dispute Option A is chosen (Terms §2 note). */
export const ARBITRATION_NOTICE =
  'These Terms include an arbitration agreement and class-action waiver (Section 18), which you can opt out of within 30 days.'
