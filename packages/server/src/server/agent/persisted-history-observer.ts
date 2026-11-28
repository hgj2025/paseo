import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createFileObserver,
  type FileObserver,
  type FileObserverSubscription,
} from "../file-observer/index.js";

interface Observation {
  path: string;
  refs: number;
  closed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  subscription?: FileObserverSubscription;
  work: Promise<void>;
  ready: Promise<void>;
}

/** Only viewed transcripts are observed. All clients share one replay lane per agent. */
export class PersistedHistoryObserver {
  private readonly observations = new Map<string, Observation>();
  private readonly signatures = new Map<string, string>();
  constructor(
    private readonly ports: {
      synchronize(agentId: string): Promise<unknown>;
      isBusy(agentId: string): boolean;
      onError(error: unknown, agentId: string): void;
      observer?: FileObserver;
    },
  ) {}
  private readonly observer = this.ports.observer ?? createFileObserver();

  observe(agentId: string, path: string): { ready: Promise<void>; release(): Promise<void> } {
    let observation = this.observations.get(agentId);
    if (!observation) {
      const entry: Observation = {
        path: resolve(path),
        refs: 0,
        closed: false,
        work: Promise.resolve(),
        ready: Promise.resolve(),
      };
      this.observations.set(agentId, entry);
      entry.ready = this.observer
        .subscribe(dirname(entry.path), (error, events) => {
          if (entry.closed) return;
          if (error) {
            this.ports.onError(error, agentId);
            return;
          }
          if (!events.some((event) => resolve(event.path) === entry.path)) return;
          if (entry.timer) clearTimeout(entry.timer);
          entry.timer = setTimeout(() => {
            entry.timer = undefined;
            this.checkInBackground(agentId);
          }, 1000);
          entry.timer.unref?.();
        })
        .then((subscription) => {
          entry.subscription = subscription;
          return entry.closed ? undefined : this.check(agentId);
        });
      // The caller can await ready; also handle cancellation during startup.
      void entry.ready.catch((error) => this.ports.onError(error, agentId));
      observation = entry;
    }
    const entry = observation;
    entry.refs++;
    let released = false;
    return {
      ready: entry.ready.then(() => this.check(agentId)),
      release: async () => {
        if (released) return;
        released = true;
        if (--entry.refs > 0) return;
        entry.closed = true;
        if (entry.timer) clearTimeout(entry.timer);
        if (this.observations.get(agentId) === entry) this.observations.delete(agentId);
        await entry.ready.catch(() => undefined);
        await entry.subscription?.unsubscribe();
        await entry.work.catch(() => undefined);
      },
    };
  }

  check(agentId: string): Promise<void> {
    const entry = this.observations.get(agentId);
    if (!entry || entry.closed) return Promise.resolve();
    const work = entry.work.catch(() => undefined).then(() => this.reconcile(agentId, entry));
    entry.work = work;
    return work;
  }
  private checkInBackground(agentId: string): void {
    void this.check(agentId).catch((error) => this.ports.onError(error, agentId));
  }

  private async reconcile(agentId: string, entry: Observation): Promise<void> {
    if (entry.closed || this.ports.isBusy(agentId)) return;
    const info = await stat(entry.path);
    const signature = `${entry.path}:${info.ino}:${info.size}:${info.mtimeMs}`;
    if (entry.closed || this.signatures.get(agentId) === signature || this.ports.isBusy(agentId))
      return;
    await this.ports.synchronize(agentId);
    // Remember only successful reads; failures remain retryable on reopen/reconnect.
    this.signatures.set(agentId, signature);
  }
}
