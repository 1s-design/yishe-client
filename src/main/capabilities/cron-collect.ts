/**
 * 定时采集能力（cron.collect）
 *
 * 命令面：
 *  - cron.collect.schedule    管理定时采集任务（upsert / remove / list / trigger）
 *  - cron.collect.status      查看调度器运行状态
 *
 * 服务端通过 WS 下发 schedule 配置；客户端本地执行采集，结果回传。
 */
import { CapabilityRegistry } from './registry';
import { CronScheduler, CronSchedule } from '../cron-scheduler';

let scheduler: CronScheduler | null = null;

export function getCronScheduler(): CronScheduler {
  if (!scheduler) {
    scheduler = new CronScheduler();
  }
  return scheduler;
}

const scheduleDef = {
  name: 'schedule',
  namespace: 'cron.collect',
  label: '定时采集任务管理',
  description: '管理客户端本地定时采集任务：upsert 添加/更新、remove 删除、list 列表、trigger 立即执行',
  executionMode: 'safe_write' as const,
  riskLevel: 'low' as const,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['upsert', 'remove', 'list', 'trigger', 'setAll'],
        description: '操作类型',
      },
      schedule: {
        type: 'object',
        description: '调度配置（upsert 时必传）',
        properties: {
          id: { type: 'string', description: '任务唯一 ID' },
          sourceId: { type: 'string', description: '采集源 ID' },
          action: { type: 'string', description: '采集方法（browse 类）' },
          params: { type: 'object', description: '方法参数' },
          materialTarget: { type: 'string', description: '入库目标（crawler_material / collect_file）' },
          intervalSec: { type: 'number', description: '间隔秒数' },
          cron: { type: 'string', description: 'cron 表达式（与 intervalSec 二选一）' },
          enabled: { type: 'boolean', description: '是否启用' },
          label: { type: 'string', description: '任务显示名' },
        },
      },
      schedules: {
        type: 'array',
        description: '批量调度配置（setAll 时必传）',
      },
      id: { type: 'string', description: '任务 ID（remove / trigger 时必传）' },
    },
    required: ['action'],
  },
  async execute(args: {
    action: string;
    schedule?: CronSchedule;
    schedules?: CronSchedule[];
    id?: string;
  }): Promise<any> {
    const s = getCronScheduler();
    switch (args.action) {
      case 'upsert': {
        if (!args.schedule) throw new Error('缺少 schedule 参数');
        s.upsertSchedule(args.schedule);
        return { ok: true, id: args.schedule.id };
      }
      case 'setAll': {
        if (!Array.isArray(args.schedules)) throw new Error('缺少 schedules 参数');
        s.setSchedules(args.schedules);
        return { ok: true, count: args.schedules.length };
      }
      case 'remove': {
        if (!args.id) throw new Error('缺少 id 参数');
        s.removeSchedule(args.id);
        return { ok: true, id: args.id };
      }
      case 'list': {
        return { schedules: s.listStatus() };
      }
      case 'trigger': {
        if (!args.id) throw new Error('缺少 id 参数');
        await s.triggerNow(args.id);
        return { ok: true, id: args.id };
      }
      default:
        throw new Error(`未知操作: ${args.action}`);
    }
  },
};

const statusDef = {
  name: 'status',
  namespace: 'cron.collect',
  label: '定时采集状态',
  description: '查看客户端定时采集调度器状态与任务列表',
  executionMode: 'readonly' as const,
  riskLevel: 'low' as const,
  inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<any> {
    const s = getCronScheduler();
    return {
      running: s.listStatus().length > 0,
      schedules: s.listStatus(),
    };
  },
};

export function registerCronCollectCapabilities(): void {
  CapabilityRegistry.registerAll([scheduleDef, statusDef]);
}
