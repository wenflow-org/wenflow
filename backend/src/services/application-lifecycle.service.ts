import type { Server } from 'http';

export type ApplicationLifecycleState = 'starting' | 'ready' | 'draining' | 'stopped';

interface Stoppable {
  stop(): Promise<void> | void;
}

interface Closable {
  close(): Promise<void> | void;
}

interface Disconnectable {
  $disconnect(): Promise<void>;
}

export interface ApplicationLifecycleResources {
  httpServer: Server | null;
  stopSchedulers(): Promise<void> | void;
  teaching?: Stoppable | null;
  collaboration?: Stoppable | null;
  backgroundTasks?: Array<Promise<unknown> | null | undefined>;
  backgroundTaskTracker?: { drain(): Promise<void> } | null;
  outbox?: Stoppable | null;
  gateway?: Closable | null;
  databases: Disconnectable[];
}

export interface ApplicationShutdownReport {
  reason: string;
  timedOut: boolean;
  errors: Array<{ stage: string; message: string }>;
}

const DEFAULT_SHUTDOWN_DEADLINE_MS = 25_000;

export function resolveShutdownDeadlineMs(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_SHUTDOWN_DEADLINE_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new Error('SHUTDOWN_DEADLINE_MS 必须是 1000 到 120000 之间的整数');
  }
  return parsed;
}

export class ApplicationLifecycle {
  private state: ApplicationLifecycleState = 'starting';
  private shutdownPromise: Promise<ApplicationShutdownReport> | null = null;

  getState(): ApplicationLifecycleState {
    return this.state;
  }

  isDraining(): boolean {
    return this.state === 'draining' || this.state === 'stopped';
  }

  markReady(): void {
    if (this.state === 'starting') this.state = 'ready';
  }

  shutdown(
    reason: string,
    resources: ApplicationLifecycleResources,
    deadlineMs = DEFAULT_SHUTDOWN_DEADLINE_MS
  ): Promise<ApplicationShutdownReport> {
    if (!this.shutdownPromise) {
      this.state = 'draining';
      this.shutdownPromise = this.runShutdown(reason, resources, deadlineMs);
    }
    return this.shutdownPromise;
  }

  private async runShutdown(
    reason: string,
    resources: ApplicationLifecycleResources,
    deadlineMs: number
  ): Promise<ApplicationShutdownReport> {
    const deadlineAt = Date.now() + deadlineMs;
    const errors: ApplicationShutdownReport['errors'] = [];
    let timedOut = false;

    const forceCloseHttp = () => {
      try {
        resources.httpServer?.closeAllConnections();
      } catch (error) {
        errors.push({ stage: 'http-force-close', message: this.errorMessage(error) });
      }
    };

    const invoke = (operation: (() => Promise<unknown> | unknown) | undefined) => {
      if (!operation) return Promise.resolve();
      try {
        return Promise.resolve(operation());
      } catch (error) {
        return Promise.reject(error);
      }
    };

    const capture = (operation: Promise<unknown>) => operation.then(
      () => ({ error: null as unknown }),
      error => ({ error })
    );

    const waitFor = async (stage: string, operation: Promise<unknown>) => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        timedOut = true;
        return;
      }
      let timer: NodeJS.Timeout;
      const result = await Promise.race([
        operation.then(() => ({ type: 'ok' as const })).catch(error => ({ type: 'error' as const, error })),
        new Promise<{ type: 'timeout' }>(resolve => {
          timer = setTimeout(() => resolve({ type: 'timeout' }), remaining);
          timer.unref?.();
        })
      ]).finally(() => clearTimeout(timer!));
      if (result.type === 'timeout') timedOut = true;
      if (result.type === 'error') errors.push({ stage, message: this.errorMessage(result.error) });
    };

    const settleHooks = async (hooks: Array<Promise<unknown>>) => {
      const results = await Promise.allSettled(hooks);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected.length > 0) {
        throw new Error(rejected.map(result => this.errorMessage(result.reason)).join('; '));
      }
    };

    try {
      await Promise.resolve(resources.stopSchedulers());
    } catch (error) {
      errors.push({ stage: 'schedulers', message: this.errorMessage(error) });
    }

    const teachingStop = capture(invoke(resources.teaching ? () => resources.teaching!.stop() : undefined));
    const trackedBackgroundDrain = capture(invoke(
      resources.backgroundTaskTracker ? () => resources.backgroundTaskTracker!.drain() : undefined
    ));
    const backgroundTasks = (resources.backgroundTasks || [])
      .filter(Boolean)
      .map(operation => capture(Promise.resolve(operation!)));
    const httpClose = this.closeHttpServer(resources.httpServer, errors);
    try {
      resources.httpServer?.closeIdleConnections();
    } catch (error) {
      errors.push({ stage: 'http-idle-close', message: this.errorMessage(error) });
    }
    await waitFor('http', httpClose);

    if (!timedOut) {
      await waitFor('background', (async () => {
        const captured = await Promise.all([
          teachingStop,
          trackedBackgroundDrain,
          ...backgroundTasks,
          capture(invoke(resources.collaboration ? () => resources.collaboration!.stop() : undefined))
        ]);
        const failed = captured.filter(result => result.error !== null);
        if (failed.length > 0) {
          throw new Error(failed.map(result => this.errorMessage(result.error)).join('; '));
        }
      })());
    }

    if (!timedOut) await waitFor('outbox', invoke(resources.outbox ? () => resources.outbox!.stop() : undefined));
    if (!timedOut) await waitFor('gateway', invoke(resources.gateway ? () => resources.gateway!.close() : undefined));
    if (!timedOut) {
      await waitFor('databases', settleHooks(resources.databases.map(database => invoke(() => database.$disconnect()))));
    }

    if (timedOut) forceCloseHttp();
    this.state = 'stopped';
    return { reason, timedOut, errors };
  }

  private closeHttpServer(
    server: Server | null,
    errors: ApplicationShutdownReport['errors']
  ): Promise<void> {
    if (!server) return Promise.resolve();
    return new Promise(resolve => {
      server.close(error => {
        if (error) errors.push({ stage: 'http', message: this.errorMessage(error) });
        resolve();
      });
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
