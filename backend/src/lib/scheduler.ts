/**
 * All of Scrip's asynchrony (payment confirmation, QR expiration, webhook retry) is
 * simulated in-process with setTimeout. Routing every timer through this
 * interface buys two things: timers can be cancelled on shutdown instead of leaking, and
 * tests can drive virtual time instead of sleeping.
 */
export interface Scheduler {
  /** Runs `task` after `delayMs`. Returns a handle usable with `cancel`. */
  schedule(delayMs: number, task: () => void | Promise<void>): number;
  cancel(handle: number): void;
  /** Cancels every pending task. Called on server close. */
  clearAll(): void
  /** Current epoch millis — virtual under ManualScheduler. */
  now(): number;
  /** Number of tasks still pending. */
  pending(): number;
}

export type TaskErrorHandler = (err: unknown) => void;

const defaultOnError: TaskErrorHandler = (err) => {
  console.error('[scrip] scheduled task failed:', err);
};

/** Production scheduler: real timers, real clock. */
export class TimeoutScheduler implements Scheduler {
  #handles = new Map<number, NodeJS.Timeout>();
  #nextHandle = 1;
  #onError: TaskErrorHandler;

  constructor(onError: TaskErrorHandler = defaultOnError) {
    this.#onError = onError;
  }

  schedule(delayMs: number, task: () => void | Promise<void>): number {
    const handle = this.#nextHandle++;

    const timer = setTimeout(() => {
      this.#handles.delete(handle);
      try {
        const result = task();
        if (result instanceof Promise) result.catch(this.#onError);
      } catch (err) {
        this.#onError(err);
      }
    }, Math.max(0, delayMs));

    // A pending simulation must never hold the process open on its own.
    timer.unref?.();
    this.#handles.set(handle, timer);
    return handle;
  }

  cancel(handle: number): void {
    const timer = this.#handles.get(handle);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.#handles.delete(handle);
  }

  clearAll(): void {
    for (const timer of this.#handles.values()) clearTimeout(timer);
    this.#handles.clear();
  }

  now(): number {
    return Date.now();
  }

  pending(): number {
    return this.#handles.size;
  }
}

interface ManualTask {
  handle: number;
  dueAt: number;
  task: () => void | Promise<void>;
}

/**
 * Test scheduler with a virtual clock. `advance(ms)` runs everything that comes due in
 * that window, in chronological order, awaiting each task — so a webhook retry chain that
 * schedules its own follow-up resolves within a single advance() call.
 */
export class ManualScheduler implements Scheduler {
  #tasks: ManualTask[] = [];
  #nextHandle = 1;
  #clock: number;

  constructor(startAt = Date.now()) {
    this.#clock = startAt;
  }

  schedule(delayMs: number, task: () => void | Promise<void>): number {
    const handle = this.#nextHandle++;
    this.#tasks.push({ handle, dueAt: this.#clock + Math.max(0, delayMs), task });
    return handle;
  }

  cancel(handle: number): void {
    this.#tasks = this.#tasks.filter((t) => t.handle !== handle);
  }

  clearAll(): void {
    this.#tasks = [];
  }

  now(): number {
    return this.#clock;
  }

  pending(): number {
    return this.#tasks.length;
  }

  /** Advances virtual time, running due tasks (including ones they schedule in range). */
  async advance(ms: number): Promise<void> {
    const target = this.#clock + ms;

    for (;;) {
      const due = this.#tasks
        .filter((t) => t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.handle - b.handle);

      const next = due[0];
      if (!next) break;

      this.#tasks = this.#tasks.filter((t) => t.handle !== next.handle);
      this.#clock = Math.max(this.#clock, next.dueAt);
      await next.task();
    }

    this.#clock = target;
  }

  /**
   * Drains the queue completely. Tasks that schedule follow-ups (a webhook retry chain)
   * push work past the current horizon, so this keeps advancing until nothing is pending.
   */
  async runAll(maxRounds = 200): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      if (this.#tasks.length === 0) return;

      const furthest = this.#tasks.reduce((max, t) => Math.max(max, t.dueAt), this.#clock);
      await this.advance(furthest - this.#clock + 1);
    }

    throw new Error(
      `ManualScheduler.runAll did not settle after ${maxRounds} rounds — a task is rescheduling itself forever`,
    );
  }
}
