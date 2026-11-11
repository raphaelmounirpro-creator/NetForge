import type { SimTime } from "./time.js";

export interface Scheduled<T> {
  readonly time: SimTime;
  /** Numéro d'ordre attribué à la programmation : départage les égalités d'instant. */
  readonly seq: number;
  readonly value: T;
}

function before<T>(a: Scheduled<T>, b: Scheduled<T>): boolean {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}

/**
 * File d'événements ordonnée par instant puis par numéro d'ordre (tas binaire).
 * Deux événements au même instant sont toujours traités dans l'ordre où ils
 * ont été programmés : l'ordre ne dépend ni du hasard ni de l'implémentation.
 */
export class EventQueue<T> {
  private readonly heap: Array<Scheduled<T>> = [];

  get size(): number {
    return this.heap.length;
  }

  peek(): Scheduled<T> | undefined {
    return this.heap[0];
  }

  push(item: Scheduled<T>): void {
    const heap = this.heap;
    heap.push(item);
    let index = heap.length - 1;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = heap[parentIndex];
      if (!parent || !before(item, parent)) break;
      heap[index] = parent;
      index = parentIndex;
    }
    heap[index] = item;
  }

  pop(): Scheduled<T> | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;
    let index = 0;
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let smallest = last;
      let smallestIndex = -1;
      const leftItem = heap[left];
      const rightItem = heap[right];
      if (leftItem && before(leftItem, smallest)) {
        smallest = leftItem;
        smallestIndex = left;
      }
      if (rightItem && before(rightItem, smallest)) {
        smallest = rightItem;
        smallestIndex = right;
      }
      if (smallestIndex === -1) break;
      heap[index] = smallest;
      index = smallestIndex;
    }
    heap[index] = last;
    return top;
  }
}
