import { attackSchema, type Attack } from "./eventSchemas";
// Attack sequence is independent of snapshots and control events.
export class AttackSynchronizer {
  nextExpected = 1;
  outgoingSeq = 0;
  private buffered = new Map<number, Attack>();
  private received = new Map<string, number>();
  private history: Attack[] = [];
  readonly unacked = new Map<string, { attack: Attack; sentAt: number }>();
  constructor(
    private apply: (attack: Attack) => void,
    private acknowledge: (id: string) => void,
  ) {}
  get hasGap() {
    return this.buffered.size > 0;
  }
  create(holes: number[], lockIndex: number, attackId: string): Attack {
    if (this.unacked.size >= 32) throw new Error("攻擊重送佇列已滿");
    const attack = attackSchema.parse({
      attackId,
      attackSeq: ++this.outgoingSeq,
      lockIndex,
      lines: holes.length,
      holes,
    });
    this.history.push(attack);
    this.history = this.history.slice(-32);
    this.unacked.set(attackId, { attack, sentAt: 0 });
    return attack;
  }
  receive(attack: Attack) {
    const parsed = attackSchema.safeParse(attack);
    if (!parsed.success) return false;
    attack = parsed.data;
    if (this.received.has(attack.attackId)) {
      this.acknowledge(attack.attackId);
      return true;
    }
    if (attack.attackSeq < this.nextExpected) return false;
    if (attack.attackSeq > this.nextExpected + 31)
      throw new Error("攻擊序號超出重送窗口");
    const existing = this.buffered.get(attack.attackSeq);
    if (existing && existing.attackId !== attack.attackId)
      throw new Error("攻擊序號衝突");
    this.buffered.set(attack.attackSeq, attack);
    while (this.buffered.has(this.nextExpected)) {
      const next = this.buffered.get(this.nextExpected)!;
      this.apply(next);
      this.buffered.delete(this.nextExpected);
      this.received.set(next.attackId, next.attackSeq);
      this.nextExpected++;
      this.acknowledge(next.attackId);
    }
    // Retain enough IDs to recognize all retries in the sender's bounded window.
    for (const [id, seq] of this.received)
      if (seq < this.nextExpected - 64) this.received.delete(id);
    return true;
  }
  ack(id: string) {
    this.unacked.delete(id);
  }
  retries(now: number): Attack[] {
    const result: Attack[] = [];
    for (const pending of this.unacked.values())
      if (now - pending.sentAt >= 800) {
        pending.sentAt = now;
        result.push(pending.attack);
      }
    return result;
  }
  resendFrom(seq: number): Attack[] {
    if (
      seq > this.outgoingSeq + 1 ||
      seq < 1 ||
      (this.history.length && seq < this.history[0].attackSeq)
    )
      throw new Error("無法恢復攻擊序列");
    return this.history.filter((a) => a.attackSeq >= seq);
  }
  export() {
    return {
      nextExpected: this.nextExpected,
      outgoingSeq: this.outgoingSeq,
      history: this.history,
      received: [...this.received],
      unacked: [...this.unacked.values()].map((p) => p.attack),
    };
  }
  restore(data: unknown) {
    if (!data || typeof data !== "object") throw new Error("無效的同步紀錄");
    const value = data as ReturnType<AttackSynchronizer["export"]>;
    if (
      !Number.isSafeInteger(value.nextExpected) ||
      value.nextExpected < 1 ||
      !Number.isSafeInteger(value.outgoingSeq) ||
      value.outgoingSeq < 0 ||
      !Array.isArray(value.history) ||
      value.history.length > 32 ||
      !Array.isArray(value.received) ||
      value.received.length > 64 ||
      !Array.isArray(value.unacked) ||
      value.unacked.length > 32
    )
      throw new Error("無效的同步紀錄");
    this.nextExpected = value.nextExpected;
    this.outgoingSeq = value.outgoingSeq;
    this.history = value.history.map((a) => attackSchema.parse(a));
    this.received = new Map(value.received);
    this.unacked.clear();
    for (const a of value.unacked) {
      const attack = attackSchema.parse(a);
      this.unacked.set(attack.attackId, { attack, sentAt: 0 });
    }
  }
}
