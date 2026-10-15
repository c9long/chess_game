/**
 * @game/protocol: the versioned wire contract shared by the web client, the server and
 * (later) the Unity client. Plain TypeScript types plus zod schemas the server validates
 * with; `pnpm --filter @game/protocol schema` exports JSON Schema for C# codegen.
 *
 * - `@game/protocol`: constants, join options, messages, REST shapes
 * - `@game/protocol/state`: the Colyseus schema of the match room state
 * - `@game/protocol/client`: typed send/receive helpers for an SDK room
 */
export * from './constants.ts'
export * from './messages.ts'
export type * from './rest.ts'
