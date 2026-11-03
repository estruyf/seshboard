import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { COMPUTER_COLORS, COMPUTER_NOTIFY, fromBase64Url, toBase64Url, type ComputerColor, type ComputerNotify } from '@seshboard/protocol';

/** Another computer this app paired with, as a phone pairs with it. */
export interface PairedComputer {
  id: string;
  /** What it calls itself, from its last `hello` (its address's host until the first one). */
  name: string;
  enginePublicKey: Uint8Array;
  /** Its Remote's `https://` address. */
  address: string;
  /** The id that computer gave this one when it allowed it. */
  deviceId: string;
  pairedAt: number;
  /** The name you gave it here; null for its own. */
  label: string | null;
  /** The colour you gave it here (`violet` until you pick one). */
  color: ComputerColor;
  /** Which of its notifications show here (`all` until you pick another). */
  notify: ComputerNotify;
}

/** The name a computer shows here: the one you gave it, else its own. */
export const shownName = (computer: Pick<PairedComputer, 'name' | 'label'>): string => computer.label ?? computer.name;

interface Row {
  id: string;
  name: string;
  engine_key: string;
  address: string;
  device_id: string;
  paired_at: number;
  label: string | null;
  color: string | null;
  notify: string | null;
}

/**
 * The computers this app paired with, in `remote_computers`: their public keys and addresses only. This app's own
 * device key is in the system's keychain, so a copy of the database connects to nothing.
 */
export class ComputerStore {
  private readonly statements: Record<'list' | 'byKey' | 'insert' | 'replace' | 'address' | 'name' | 'label' | 'color' | 'notify' | 'remove', StatementSync>;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      list: db.prepare('SELECT * FROM remote_computers ORDER BY paired_at'),
      byKey: db.prepare('SELECT * FROM remote_computers WHERE engine_key = ?'),
      insert: db.prepare('INSERT INTO remote_computers (id, name, engine_key, address, device_id, paired_at) VALUES (?, ?, ?, ?, ?, ?)'),
      replace: db.prepare('UPDATE remote_computers SET name = ?, address = ?, device_id = ?, paired_at = ? WHERE id = ?'),
      address: db.prepare('UPDATE remote_computers SET address = ? WHERE id = ?'),
      name: db.prepare('UPDATE remote_computers SET name = ? WHERE id = ?'),
      label: db.prepare('UPDATE remote_computers SET label = ? WHERE id = ?'),
      color: db.prepare('UPDATE remote_computers SET color = ? WHERE id = ?'),
      notify: db.prepare('UPDATE remote_computers SET notify = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM remote_computers WHERE id = ?'),
    };
  }

  list(): PairedComputer[] {
    return (this.statements.list.all() as unknown as Row[]).flatMap((row) => toComputer(row) ?? []);
  }

  /** The computer with this key, paired before. */
  find(enginePublicKey: Uint8Array): PairedComputer | null {
    const row = this.statements.byKey.get(toBase64Url(enginePublicKey)) as unknown as Row | undefined;
    return row ? toComputer(row) : null;
  }

  /** Stores a computer after it allowed this one. Pairing again with one already here keeps its id, name, colour and notifications. */
  add(computer: Omit<PairedComputer, 'id' | 'pairedAt' | 'label' | 'color' | 'notify'>): PairedComputer {
    const at = this.now();
    const existing = this.find(computer.enginePublicKey);
    if (existing) {
      this.statements.replace.run(computer.name, computer.address, computer.deviceId, at, existing.id);
      return { ...computer, id: existing.id, pairedAt: at, label: existing.label, color: existing.color, notify: existing.notify };
    }
    const id = randomUUID();
    this.statements.insert.run(id, computer.name, toBase64Url(computer.enginePublicKey), computer.address, computer.deviceId, at);
    return { ...computer, id, pairedAt: at, label: null, color: 'violet', notify: 'all' };
  }

  setAddress(id: string, address: string): void {
    this.statements.address.run(address, id);
  }

  setName(id: string, name: string): void {
    this.statements.name.run(name, id);
  }

  /** The name you give it here; empty (or its own name) goes back to its own. */
  setLabel(id: string, label: string): void {
    this.statements.label.run(label.trim() || null, id);
  }

  setColor(id: string, color: ComputerColor): void {
    this.statements.color.run(color === 'violet' ? null : color, id);
  }

  setNotify(id: string, notify: ComputerNotify): void {
    this.statements.notify.run(notify === 'all' ? null : notify, id);
  }

  remove(id: string): boolean {
    return Number(this.statements.remove.run(id).changes) > 0;
  }
}

function toComputer(row: Row): PairedComputer | null {
  const enginePublicKey = fromBase64Url(row.engine_key);
  if (!enginePublicKey) return null;
  return { id: row.id, name: row.name, enginePublicKey, address: row.address, deviceId: row.device_id, pairedAt: row.paired_at, label: row.label || null, color: toColor(row.color), notify: toNotify(row.notify) };
}

// A colour a newer version saved, which this one doesn't know, shows as the default.
const toColor = (value: string | null): ComputerColor => (COMPUTER_COLORS as readonly string[]).includes(value ?? '') ? (value as ComputerColor) : 'violet';

// So does a notifications choice it doesn't know: all of them.
const toNotify = (value: string | null): ComputerNotify => (COMPUTER_NOTIFY as readonly string[]).includes(value ?? '') ? (value as ComputerNotify) : 'all';
