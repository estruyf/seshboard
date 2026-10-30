import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { toBase64Url } from '@seshboard/protocol';

/**
 * What a paired device is, for its icon in Settings › Remote: a phone's browser, a computer's browser, or Seshboard
 * on another computer (`REMOTE_DESKTOP_ORIGIN`). Told from the socket's origin and user agent when it paired: a label,
 * never what lets it in.
 */
export type DeviceKind = 'phone' | 'browser' | 'computer';

/** A phone (or another computer) that was paired, as Settings › Remote lists it. */
export interface RemoteDevice {
  id: string;
  name: string;
  kind: DeviceKind;
  createdAt: number;
  lastSeenAt: number | null;
  /** The engine's address it last connected through; null before its first connection. */
  lastAddress: string | null;
}

/** Any device ever paired with a key, revoked or not, for the log's line about a refused key. */
export interface DeviceRecord {
  name: string;
  kind: DeviceKind;
  createdAt: number;
  revokedAt: number | null;
}

/** A device that hasn't connected for this long is refused, as if revoked, and leaves the list. */
export const DEVICE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  name: string;
  kind: string;
  last_address: string | null;
  public_key: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

/**
 * The paired phones, in `remote_devices`. Only their public keys are kept; a revoked device keeps its row (so its
 * key is refused, and can't be paired again by accident under its old id) but leaves the list.
 */
export class DeviceStore {
  private readonly statements: Record<'list' | 'byKey' | 'insert' | 'touch' | 'rename' | 'revoke' | 'retireKey', StatementSync>;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      list: db.prepare('SELECT * FROM remote_devices WHERE revoked_at IS NULL ORDER BY created_at'),
      byKey: db.prepare('SELECT * FROM remote_devices WHERE public_key = ?'),
      insert: db.prepare('INSERT INTO remote_devices (id, name, kind, public_key, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'),
      touch: db.prepare('UPDATE remote_devices SET last_seen_at = ?, last_address = COALESCE(?, last_address) WHERE id = ? AND revoked_at IS NULL'),
      rename: db.prepare('UPDATE remote_devices SET name = ? WHERE id = ? AND revoked_at IS NULL'),
      revoke: db.prepare('UPDATE remote_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
      retireKey: db.prepare("UPDATE remote_devices SET public_key = public_key || ':revoked:' || id WHERE id = ?"),
    };
  }

  /** Paired devices that can still connect, oldest first. Expired ones are revoked on the way. */
  list(): RemoteDevice[] {
    return (this.statements.list.all() as unknown as Row[]).filter((row) => !this.expire(row)).map(toDevice);
  }

  /** Stores a device after Allow on the Mac. A key that was revoked before can be paired again, as a new device. */
  add(name: string, publicKey: Uint8Array, kind: DeviceKind = 'phone'): RemoteDevice {
    const key = toBase64Url(publicKey);
    const existing = this.statements.byKey.get(key) as unknown as Row | undefined;
    const at = this.now();
    if (existing && existing.revoked_at === null && !this.expire(existing)) return toDevice(existing);
    if (existing) {
      // The UNIQUE key: a revoked row gives its key up to the new pairing.
      this.statements.revoke.run(at, existing.id);
      this.statements.retireKey.run(existing.id);
    }
    const id = randomUUID();
    this.statements.insert.run(id, name, kind, key, at, at);
    return { id, name, kind, createdAt: at, lastSeenAt: at, lastAddress: null };
  }

  /** The device with this key, when it may connect (paired, not revoked, not expired). */
  find(publicKey: Uint8Array): RemoteDevice | null {
    const row = this.statements.byKey.get(toBase64Url(publicKey)) as unknown as Row | undefined;
    if (!row || row.revoked_at !== null || this.expire(row)) return null;
    return toDevice(row);
  }

  /** The device a key belonged to, also when revoked (`find` is what lets it in). */
  lookup(publicKey: Uint8Array): DeviceRecord | null {
    const row = this.statements.byKey.get(toBase64Url(publicKey)) as unknown as Row | undefined;
    return row ? { name: row.name, kind: toDevice(row).kind, createdAt: row.created_at, revokedAt: row.revoked_at } : null;
  }

  /** It connected now, through `address` (the engine's public address then; null keeps the one it had). */
  touch(id: string, address: string | null = null): void {
    this.statements.touch.run(this.now(), address, id);
  }

  /** True when the device is paired and now has this name. */
  rename(id: string, name: string): boolean {
    return Number(this.statements.rename.run(name, id).changes) > 0;
  }

  /** True when the device was paired and is now revoked. */
  revoke(id: string): boolean {
    return Number(this.statements.revoke.run(this.now(), id).changes) > 0;
  }

  private expire(row: Row): boolean {
    if (row.revoked_at !== null) return false;
    const last = row.last_seen_at ?? row.created_at;
    if (this.now() - last < DEVICE_EXPIRY_MS) return false;
    this.statements.revoke.run(this.now(), row.id);
    return true;
  }
}

const toDevice = (row: Row): RemoteDevice => ({ id: row.id, name: row.name, kind: row.kind === 'computer' || row.kind === 'browser' ? row.kind : 'phone', createdAt: row.created_at, lastSeenAt: row.last_seen_at, lastAddress: row.last_address ?? null });
