import { randomUUID } from 'node:crypto';
import { newPairingSecret, pskFromSecret } from '@switchboard/protocol';

/** How long a QR code can be scanned. */
export const PAIRING_OFFER_MS = 2 * 60 * 1000;
/** How long the Mac waits for Allow or Deny. */
export const PAIRING_CONFIRM_MS = 60 * 1000;
/** Failed pairing handshakes before pairing closes until you click Pair a phone again. */
export const PAIRING_MAX_FAILURES = 5;

/** A phone that proved it scanned the QR code and waits for Allow on the Mac. */
export interface PairRequest {
  id: string;
  name: string;
  /** The 6 digits the phone shows too. */
  code: string;
  expiresAt: number;
}

export interface PairingState {
  /** Open while a QR code can be scanned. */
  offer: { expiresAt: number } | null;
  request: PairRequest | null;
  /** Too many failed attempts closed pairing. */
  locked: boolean;
}

interface Waiting {
  request: PairRequest;
  resolve(allowed: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Pairing, one phone at a time: Pair a phone makes a secret that is good for one use and two minutes (closing the
 * dialog cancels it), and a phone that proves it has it waits for Allow on the Mac with a matching code.
 */
export class Pairing {
  private secret: Uint8Array | null = null;
  private expiresAt = 0;
  private failures = 0;
  private locked = false;
  private offerTimer: ReturnType<typeof setTimeout> | undefined;
  private waiting: Waiting | null = null;

  constructor(
    private readonly onChange: (state: PairingState) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** A new QR code's secret, replacing any earlier one (and dropping a request waiting for it). */
  start(): { secret: Uint8Array; expiresAt: number } {
    this.clear(false);
    this.secret = newPairingSecret();
    this.expiresAt = this.now() + PAIRING_OFFER_MS;
    this.failures = 0;
    this.locked = false;
    this.offerTimer = setTimeout(() => this.cancel(), PAIRING_OFFER_MS);
    this.offerTimer.unref?.();
    this.changed();
    return { secret: this.secret, expiresAt: this.expiresAt };
  }

  /** Closes the QR code and denies a waiting request (the dialog was closed, Remote was turned off). */
  cancel(): void {
    this.clear(true);
  }

  /** The pre-shared key a pairing handshake must use now, or null when pairing is closed. */
  psk(): Uint8Array | null {
    if (!this.secret || this.locked || this.now() >= this.expiresAt) return null;
    return pskFromSecret(this.secret);
  }

  /** A pairing handshake failed (a wrong secret or engine key, or a frame that didn't decrypt). */
  failed(): void {
    if (!this.secret) return;
    this.failures++;
    if (this.failures >= PAIRING_MAX_FAILURES) {
      this.secret = null;
      this.locked = true;
      clearTimeout(this.offerTimer);
      this.changed();
    }
  }

  /**
   * A phone proved it has the secret: it is used up now, whatever happens next. False when someone else used it
   * first (then this phone is refused).
   */
  claim(): boolean {
    if (!this.psk()) return false;
    this.secret = null;
    clearTimeout(this.offerTimer);
    this.changed();
    return true;
  }

  /** Shows "Pair <name>?" with the code; resolves true on Allow, false on Deny, a timeout or a cancel. */
  ask(name: string, code: string): Promise<boolean> {
    this.settle(false);
    return new Promise((resolve) => {
      const request: PairRequest = { id: randomUUID(), name, code, expiresAt: this.now() + PAIRING_CONFIRM_MS };
      const timer = setTimeout(() => this.settle(false), PAIRING_CONFIRM_MS);
      timer.unref?.();
      this.waiting = { request, resolve, timer };
      this.changed();
    });
  }

  /** Allow or Deny on the Mac. False when that request is no longer waiting. */
  decide(requestId: string, allow: boolean): boolean {
    if (this.waiting?.request.id !== requestId) return false;
    this.settle(allow);
    return true;
  }

  state(): PairingState {
    return {
      offer: this.secret && !this.locked && this.now() < this.expiresAt ? { expiresAt: this.expiresAt } : null,
      request: this.waiting?.request ?? null,
      locked: this.locked,
    };
  }

  private settle(allowed: boolean): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    clearTimeout(waiting.timer);
    waiting.resolve(allowed);
    this.changed();
  }

  private clear(notify: boolean): void {
    clearTimeout(this.offerTimer);
    const had = this.secret !== null || this.waiting !== null || this.locked;
    this.secret = null;
    this.locked = false;
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting) {
      clearTimeout(waiting.timer);
      waiting.resolve(false);
    }
    if (notify && had) this.changed();
  }

  private changed(): void {
    this.onChange(this.state());
  }
}
