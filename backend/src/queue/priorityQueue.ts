export interface QueueItem {
  id: string;
  /** Lower score = served first. */
  score: number;
}

/**
 * Binary min-heap. push/pop are O(log n). `remove` is lazy (O(1)): removed ids are
 * skipped when they reach the top, which keeps cancellation of queued jobs cheap.
 */
export class PriorityQueue {
  private heap: QueueItem[] = [];
  private removed = new Set<string>();
  private members = new Set<string>();

  get size(): number {
    return this.members.size;
  }

  has(id: string): boolean {
    return this.members.has(id);
  }

  push(item: QueueItem): void {
    if (this.members.has(item.id)) return; // idempotent
    this.removed.delete(item.id);
    this.members.add(item.id);
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }

  pop(): QueueItem | undefined {
    while (this.heap.length > 0) {
      const top = this.heap[0] as QueueItem;
      const last = this.heap.pop() as QueueItem;
      if (this.heap.length > 0) {
        this.heap[0] = last;
        this.siftDown(0);
      }
      if (this.removed.has(top.id)) {
        this.removed.delete(top.id);
        continue;
      }
      this.members.delete(top.id);
      return top;
    }
    return undefined;
  }

  remove(id: string): boolean {
    if (!this.members.has(id)) return false;
    this.members.delete(id);
    this.removed.add(id);
    return true;
  }

  ids(): string[] {
    return [...this.members];
  }

  private less(a: QueueItem, b: QueueItem): boolean {
    return a.score < b.score;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.heap[i] as QueueItem, this.heap[p] as QueueItem)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(this.heap[l] as QueueItem, this.heap[m] as QueueItem)) m = l;
      if (r < n && this.less(this.heap[r] as QueueItem, this.heap[m] as QueueItem)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }

  private swap(a: number, b: number): void {
    const t = this.heap[a] as QueueItem;
    this.heap[a] = this.heap[b] as QueueItem;
    this.heap[b] = t;
  }
}
