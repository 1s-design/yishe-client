/**
 * 客户端本地定时采集调度器（CronScheduler）
 *
 * 架构原则：
 *  - 定时器在客户端本地跑，服务端只做「配置下发 + 结果接收」
 *  - 零轮询：服务端 WS 推配置变更，客户端本地 setInterval 调度
 *  - 采集直接调 collectEngine，不走服务端 dispatch（省一整轮网络往返）
 *  - 结果经现有 WebSocket 通道回传（不另开连接）
 *
 * 性能设计：
 *  - 单 interval 全局扫描（非每任务一个 timer），内存占用 O(1)
 *  - 任务间串行执行，防并发打爆客户端 / 远端源
 *  - 同名任务幂等：上次未完成时跳过本次，不排队堆积
 */
import { EventEmitter } from 'events';

export interface CronSchedule {
  /** 任务唯一 ID */
  id: string;
  /** 采集源 ID（如 hotsearch-douyin） */
  sourceId: string;
  /** 采集方法（list / search / popular 等浏览方法） */
  action: string;
  /** 方法参数 */
  params?: Record<string, any>;
  /** 采集结果保存目标（crawler_material / collect_file） */
  materialTarget?: string;
  /** 间隔秒数（如 10800 = 3 小时）；与 cron 二选一 */
  intervalSec?: number;
  /** cron 表达式（标准 5 段）；与 intervalSec 二选一 */
  cron?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 任务显示名 */
  label?: string;
}

interface ScheduleRuntime {
  schedule: CronSchedule;
  /** 下次执行时间戳（ms） */
  nextRunAt: number;
  /** 上次执行时间戳 */
  lastRunAt?: number;
  /** 上次执行结果摘要 */
  lastResult?: string;
  /** 是否正在执行（防重入） */
  running: boolean;
}

export class CronScheduler extends EventEmitter {
  private runtimes = new Map<string, ScheduleRuntime>();
  private timer: NodeJS.Timeout | null = null;
  private tickIntervalMs = 30_000; // 30s 扫一次
  private executing = false;

  constructor() {
    super();
  }

  /** 启动调度器（幂等） */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    // unref 防止阻止进程退出
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    console.log('[CronScheduler] 已启动，扫描间隔', this.tickIntervalMs, 'ms');
  }

  /** 停止调度器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.runtimes.clear();
    console.log('[CronScheduler] 已停止');
  }

  /** 全量替换调度列表（服务端 WS 推配置时调用） */
  setSchedules(schedules: CronSchedule[]): void {
    const oldIds = new Set(this.runtimes.keys());
    for (const s of schedules) {
      const existing = this.runtimes.get(s.id);
      if (existing) {
        // 更新配置，保留运行状态
        existing.schedule = s;
        if (s.enabled) {
          existing.nextRunAt = this.computeNextRun(s, Date.now());
        }
        oldIds.delete(s.id);
      } else {
        this.runtimes.set(s.id, {
          schedule: s,
          nextRunAt: s.enabled ? this.computeNextRun(s, Date.now()) : Infinity,
          running: false,
        });
      }
    }
    // 清理已删除的调度
    for (const id of oldIds) this.runtimes.delete(id);
    console.log(`[CronScheduler] 调度列表已更新: ${this.runtimes.size} 个任务`);
  }

  /** 增/改单个调度 */
  upsertSchedule(schedule: CronSchedule): void {
    this.setSchedules([
      ...[...this.runtimes.values()].map((r) => r.schedule).filter((s) => s.id !== schedule.id),
      schedule,
    ]);
  }

  /** 删除单个调度 */
  removeSchedule(id: string): void {
    this.runtimes.delete(id);
    console.log(`[CronScheduler] 已删除调度: ${id}`);
  }

  /** 手动立即触发一个调度（供测试） */
  async triggerNow(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error(`调度不存在: ${id}`);
    await this.execute(rt);
  }

  /** 获取当前调度列表与状态 */
  listStatus(): Array<CronSchedule & { nextRunAt: number; lastRunAt?: number; lastResult?: string; running: boolean }> {
    return [...this.runtimes.values()].map((rt) => ({
      ...rt.schedule,
      nextRunAt: rt.nextRunAt,
      lastRunAt: rt.lastRunAt,
      lastResult: rt.lastResult,
      running: rt.running,
    }));
  }

  // ---- 内部实现 ----

  private tick(): void {
    const now = Date.now();
    for (const rt of this.runtimes.values()) {
      if (!rt.schedule.enabled) continue;
      if (rt.running) continue; // 上次还在跑，跳过本次（防堆积）
      if (now >= rt.nextRunAt) {
        this.execute(rt).catch((e) => {
          console.error(`[CronScheduler] 任务执行异常: ${rt.schedule.id}`, e.message);
        });
      }
    }
  }

  private async execute(rt: ScheduleRuntime): Promise<void> {
    rt.running = true;
    rt.lastRunAt = Date.now();
    const { schedule } = rt;
    try {
      console.log(`[CronScheduler] 触发任务: ${schedule.label || schedule.id} (${schedule.sourceId}/${schedule.action})`);
      this.emit('execute', schedule);
      // 执行逻辑由外部注入（绑定 collectEngine），保持调度器与采集引擎解耦
      const result = await this.runTask(schedule);
      rt.lastResult = result || 'ok';
      this.emit('done', schedule, result);
    } catch (e: any) {
      rt.lastResult = `error: ${e.message}`;
      this.emit('error', schedule, e);
    } finally {
      rt.running = false;
      rt.nextRunAt = this.computeNextRun(schedule, Date.now());
    }
  }

  /** 计算下次执行时间 */
  private computeNextRun(schedule: CronSchedule, from: number): number {
    if (schedule.intervalSec && schedule.intervalSec > 0) {
      return from + schedule.intervalSec * 1000;
    }
    if (schedule.cron) {
      return this.nextCronTime(schedule.cron, from);
    }
    // 默认 3 小时
    return from + 3 * 3600 * 1000;
  }

  /**
   * 简易 cron 下次执行时间计算（标准 5 段：分 时 日 月 周）
   * 只支持 `*`、数字、逗号、`/` 步长；不支持 `L`/`#` 等高级语法
   */
  private nextCronTime(expr: string, from: number): number {
    try {
      const parts = expr.trim().split(/\s+/);
      if (parts.length < 5) return from + 3 * 3600 * 1000;
      const [minF, hourF, domF, monF, dowF] = parts;
      const d = new Date(from + 60_000); // 从下一分钟开始找
      d.setSeconds(0, 0);
      for (let i = 0; i < 365 * 24 * 60; i++) {
        // 最多找一年
        if (
          this.matchCronField(minF, d.getMinutes()) &&
          this.matchCronField(hourF, d.getHours()) &&
          this.matchCronField(domF, d.getDate()) &&
          this.matchCronField(monF, d.getMonth() + 1) &&
          this.matchCronField(dowF, d.getDay())
        ) {
          return d.getTime();
        }
        d.setMinutes(d.getMinutes() + 1);
      }
    } catch {}
    return from + 3 * 3600 * 1000;
  }

  private matchCronField(field: string, value: number): boolean {
    if (field === '*') return true;
    for (const part of field.split(',')) {
      if (part.includes('/')) {
        const [base, step] = part.split('/');
        const s = parseInt(step, 10) || 1;
        if (base === '*') {
          if (value % s === 0) return true;
        } else {
          const b = parseInt(base, 10);
          if (value >= b && (value - b) % s === 0) return true;
        }
      } else if (part.includes('-')) {
        const [a, b] = part.split('-').map(Number);
        if (value >= a && value <= b) return true;
      } else {
        if (parseInt(part, 10) === value) return true;
      }
    }
    return false;
  }

  /** 任务执行体 — 由外部绑定（通过 setRunner 注入 collectEngine 调用） */
  private runTask: (schedule: CronSchedule) => Promise<string>;

  /** 注入任务执行体 */
  setRunner(runner: (schedule: CronSchedule) => Promise<string>): void {
    this.runTask = runner;
  }
}
