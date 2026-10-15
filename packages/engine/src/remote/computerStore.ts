import { randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { fromBase64Url, toBase64Url } from '@switchboard/protocol';

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
}

interface Row {
  id: string;
  name: string;
  engine_key: string;
  address: string;
  device_id: string;
  paired_at: number;
}

/**
 * The computers this app paired with, in `remote_computers`: their public keys and addresses only. This app's own
 * device key is in the system's keychain, so a copy of the database connects to nothing.
 */
export class ComputerStore {
  private readonly statements: Record<'list' | 'byKey' | 'insert' | 'replace' | 'address' | 'name' | 'remove', StatementSync>;

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

  /** Stores a computer after it allowed this one. Pairing again with one already here keeps its id. */
  add(computer: Omit<PairedComputer, 'id' | 'pairedAt'>): PairedComputer {
    const at = this.now();
    const existing = this.find(computer.enginePublicKey);
    if (existing) {
      this.statements.replace.run(computer.name, computer.address, computer.deviceId, at, existing.id);
      return { ...computer, id: existing.id, pairedAt: at };
    }
    const id = randomUUID();
    this.statements.insert.run(id, computer.name, toBase64Url(computer.enginePublicKey), computer.address, computer.deviceId, at);
    return { ...computer, id, pairedAt: at };
  }

  setAddress(id: string, address: string): void {
    this.statements.address.run(address, id);
  }

  setName(id: string, name: string): void {
    this.statements.name.run(name, id);
  }

  remove(id: string): boolean {
    return Number(this.statements.remove.run(id).changes) > 0;
  }
}

function toComputer(row: Row): PairedComputer | null {
  const enginePublicKey = fromBase64Url(row.engine_key);
  if (!enginePublicKey) return null;
  return { id: row.id, name: row.name, enginePublicKey, address: row.address, deviceId: row.device_id, pairedAt: row.paired_at };
}
