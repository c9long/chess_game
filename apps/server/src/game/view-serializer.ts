/**
 * State patches for a room whose clients aren't all shown the same state. Colyseus encodes
 * one state for every client of a room; a client that must see something else (a player who
 * is out of a ranked game sees it delayed, game-view.ts) is given its own copy of the state
 * (`StateCopy`) with its own encoder instead, so the live state never reaches it.
 *
 * Moving a client between the live state and a copy sends it a full state of the new one.
 * The client SDK reconciles a full state against what it holds (removing what the new one
 * doesn't contain), and a copy numbers its parts from far above anything the live state uses,
 * so no part of one is ever taken for a part of the other. Only the root shares its id (0):
 * it is the client's room state either way.
 *
 * This leans on Colyseus internals (the room installing its serializer through
 * `setSerializer`, schema reference ids, the SDK's full-state reconciling), checked against
 * @colyseus/core 0.18.18, @colyseus/schema 5.0.40 and @colyseus/sdk 0.18.5: re-check it (the
 * spectating tests in game-spectate.test.ts) when upgrading any of them.
 */
import { type Client, ClientState, Protocol, SchemaSerializer } from '@colyseus/core'
import { $refId, Encoder, Root, type Schema, TypeContext } from '@colyseus/schema'

/** First reference id of a copy's parts. */
const COPY_REF_BASE = 2 ** 30

/** A state shown to some clients instead of the room's own, with its own encoder. */
export class StateCopy<T extends Schema> {
  readonly state: T
  readonly encoder: Encoder<T>
  private fullBuffer = new Uint8Array(Encoder.BUFFER_SIZE)

  constructor(state: T) {
    Object.defineProperty(state, $refId, { value: 0, enumerable: false, writable: true })
    const types = TypeContext.cache(state.constructor as typeof Schema)
    this.encoder = new Encoder(state, new Root(types, COPY_REF_BASE))
    this.state = state
    this.fullBuffer[0] = Protocol.ROOM_STATE
  }

  /**
   * A full state of the copy. Its pending changes are dropped: a copy has one client, which
   * the full state brings up to date, and a later patch must not replay them on top of it.
   */
  fullState(): Uint8Array {
    this.encoder.discardChanges()
    return this.encoder.encodeAll({ offset: 1 }, this.fullBuffer)
  }
}

/** What a connection was last sent a full state of: the live state, or a copy. */
const LIVE = Symbol('live')

export class ViewSerializer<T extends Schema> extends SchemaSerializer<T> {
  private shown = new WeakMap<Client, StateCopy<T> | typeof LIVE>()
  private readonly copyFor: (client: Client) => StateCopy<T> | undefined

  /** `copyFor` names the copy a client must be shown, or undefined for the live state. */
  constructor(copyFor: (client: Client) => StateCopy<T> | undefined) {
    super()
    this.copyFor = copyFor
  }

  override getFullState(
    client?: Client,
    timing?: Parameters<SchemaSerializer<T>['getFullState']>[1],
  ) {
    const copy = client ? this.copyFor(client) : undefined
    if (client) this.shown.set(client, copy ?? LIVE)
    return copy ? copy.fullState() : super.getFullState(client, timing)
  }

  override applyPatches(
    clients: Client[],
    state?: unknown,
    timing?: Parameters<SchemaSerializer<T>['applyPatches']>[2],
  ): boolean {
    const live: Client[] = []
    const backToLive: Client[] = []
    const byCopy = new Map<StateCopy<T>, Client[]>()
    for (const client of clients) {
      const copy = client.state === ClientState.JOINED ? this.copyFor(client) : undefined
      if (copy) {
        const list = byCopy.get(copy)
        if (list) list.push(client)
        else byCopy.set(copy, [client])
      } else if (client.state === ClientState.JOINED && this.shown.get(client) !== LIVE) {
        backToLive.push(client)
      } else {
        live.push(client)
      }
    }
    const changed = super.applyPatches(live, state, timing)
    // After the patch, so the full state already holds this tick's changes.
    for (const client of backToLive) client.raw(this.getFullState(client, timing))
    for (const [copy, watching] of byCopy) {
      const fresh = watching.filter((c) => this.shown.get(c) !== copy)
      if (copy.encoder.hasChanges) {
        const steady = watching.filter((c) => this.shown.get(c) === copy)
        if (steady.length > 0) {
          copy.encoder.sharedBuffer[0] = Protocol.ROOM_STATE_PATCH
          const patch = copy.encoder.encode({ offset: 1 })
          for (const c of steady) c.raw(patch)
        }
        copy.encoder.discardChanges()
      }
      for (const c of fresh) c.raw(this.getFullState(c))
    }
    return changed
  }
}
