import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { AgentTask, TaskStatus } from '@agent-orchestrator/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import type { OpenCodeProcessManager } from '../opencode/sdk-process-manager.js';
import type { EventBus } from '../../websocket/event-bus.js';
import type { CostTracker } from '../cost-tracker/tracker.js';
import type { RagService } from '../rag/rag-service.js';
import { AgentWorker } from '../../workers/agent-worker.js';

export const AGENT_QUEUE_NAME = 'agent-tasks';

export interface AgentJobData {
  task: AgentTask;
  githubToken: string;
  extraContext?: string;
  additionalEnv?: Record<string, string>;
}

/**
 * TaskQueue — thin wrapper around BullMQ Queue.
 *
 * Manages job enqueueing, pause/stop/cancel operations.
 * Actual worker processing logic lives in AgentWorker.
 *
 * Dependency resolution is event-driven (no polling):
 * AgentWorker calls checkAndEnqueueDependents() after each completion,
 * which queries the DB for tasks whose all deps are now satisfied.
 */
export class TaskQueue {
  private queue: Queue<AgentJobData>;
  private agentWorker: AgentWorker;
  private processManager: OpenCodeProcessManager;
  private logger: FastifyBaseLogger;

  constructor(
    redis: Redis,
    db: Pool,
    processManager: OpenCodeProcessManager,
    eventBus: EventBus,
    costTracker: CostTracker,
    logger: FastifyBaseLogger,
    onTaskStatusChange: (taskId: string, status: TaskStatus, data?: unknown) => Promise<void>,
    ragService?: RagService,
  ) {
    this.processManager = processManager;
    this.logger = logger;

    this.queue = new Queue<AgentJobData>(AGENT_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s → 10s → 20s
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });

    this.agentWorker = new AgentWorker({
      redis,
      db,
      processManager,
      eventBus,
      costTracker,
      ragService: ragService ?? ({
        retrieveContext: async () => [],
        formatAsContext: () => '',
        indexProjectFiles: async () => 0,
      } as unknown as RagService),
      logger,
      onTaskStatusChange,
      // Pass enqueueTask as a bound closure so AgentWorker can enqueue dependents
      enqueueTask: (task, token, opts) => this.enqueueTask(task, token, opts),
    });
  }

  /**
   * Enqueue a task immediately.
   * Caller must ensure all dependencies are already satisfied before calling.
   * AgentWorker handles dependent enqueuing automatically after completion.
   */
  async enqueueTask(
    task: AgentTask,
    githubToken: string,
    options?: {
      extraContext?: string;
      additionalEnv?: Record<string, string>;
    },
  ): Promise<void> {
    const priorityMap: Record<string, number> = {
      expert: 1,
      complex: 2,
      standard: 3,
      simple: 4,
      trivial: 5,
    };

    const jobData: AgentJobData = {
      task,
      githubToken,
      ...options,
    };

    await this.queue.add(`${task.agentType}:${task.id}`, jobData, {
      jobId: task.id,
      priority: priorityMap[task.complexity] ?? 3,
    });

    this.logger.info(
      { taskId: task.id, agentType: task.agentType, dependsOn: task.dependsOn },
      'Task enqueued',
    );
  }

  async pauseTask(taskId: string): Promise<boolean> {
    const paused = this.processManager.pauseAgent(taskId);
    return paused;
  }

  async resumeTask(taskId: string): Promise<boolean> {
    return this.processManager.resumeAgent(taskId);
  }

  async stopTask(taskId: string): Promise<boolean> {
    const stopped = this.processManager.stopAgent(taskId);
    const job = await this.queue.getJob(taskId);
    if (job) await job.remove();
    return stopped;
  }

  /**
   * Inject a user message into a currently running task.
   * Delegates to AgentWorker → ProcessManager.
   */
  injectToTask(taskId: string, message: string): boolean {
    return this.agentWorker.injectToTask(taskId, message);
  }

  async close(): Promise<void> {
    this.processManager.stopAll();
    await this.agentWorker.close();
    await this.queue.close();
  }
}
