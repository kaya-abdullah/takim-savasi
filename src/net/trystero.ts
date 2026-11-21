import { joinRoom, selfId, type JsonValue, type MessageAction, type Room } from 'trystero';
import type { Msg, Transport } from './online';

/** Bump when the messages change, so old and new versions never share a room. */
export const PROTOCOL = 'p1';
const APP_ID = 'takim-savasi-3d';

/**
 * Peer-to-peer room over WebRTC. Public Nostr relays only introduce the
 * devices to each other; game data then flows directly between them.
 */
export class TrysteroTransport implements Transport {
  readonly selfId = selfId;
  onMessage: ((msg: Msg, from: string) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  private room: Room;
  private act: MessageAction<JsonValue>;

  /** room: "1", "2"… (public rooms) or a private name from the page address (?oda=…). */
  constructor(room: string) {
    this.room = joinRoom({ appId: APP_ID }, `${PROTOCOL}-oda-${room}`);
    this.act = this.room.makeAction<JsonValue>('m');
    this.act.onMessage = (data, ctx) => {
      if (data && typeof data === 'object' && !Array.isArray(data)) this.onMessage?.(data as Msg, ctx.peerId);
    };
    this.room.onPeerJoin = (id) => this.onPeerJoin?.(id);
    this.room.onPeerLeave = (id) => this.onPeerLeave?.(id);
  }

  send(msg: Msg, to?: string): void {
    void this.act.send(msg as JsonValue, to ? { target: to } : undefined).catch(() => {});
  }

  leave(): void {
    void this.room.leave();
  }
}
