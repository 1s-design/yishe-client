/**
 * 客户端通用能力 — 网络诊断
 * Ping/HTTP 探测/端口检测/DNS 解析/本地服务发现
 */

import { z } from 'zod';
import net from 'net';
import http from 'http';
import https from 'https';
import dns from 'dns';
import { promisify } from 'util';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';

const dnsResolve = promisify(dns.resolve);
const dnsLookup = promisify(dns.lookup);

// ─── net_http_check ─────────────────────────────────────
const httpCheckDef: CapabilityDefinition = {
  name: 'http_check',
  namespace: 'network',
  description: '检测 URL 可达性（状态码/响应时间/重定向）',
  riskLevel: 'read',
  argsSchema: z.object({
    url: z.string().describe('要检测的 URL'),
    timeout: z.number().optional().default(10000).describe('超时毫秒'),
    followRedirects: z.boolean().optional().default(true).describe('是否跟随重定向'),
    method: z.enum(['GET', 'HEAD']).optional().default('HEAD').describe('请求方法'),
  }),
  handler: async ({ url, timeout, followRedirects, method }) => {
    const start = Date.now();
    return new Promise((resolve) => {
      try {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request(
          url,
          {
            method,
            timeout,
            headers: { 'User-Agent': 'yishe-client-netcheck/1.0' },
            rejectUnauthorized: false,
          },
          (res) => {
            const duration = Date.now() - start;
            // 处理重定向
            if (followRedirects && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              resolve({
                success: true,
                data: {
                  url,
                  statusCode: res.statusCode,
                  redirected: true,
                  redirectUrl: res.headers.location,
                  duration,
                  headers: res.headers,
                },
              });
              return;
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              resolve({
                success: true,
                data: {
                  url,
                  statusCode: res.statusCode,
                  statusMessage: res.statusMessage,
                  redirected: false,
                  duration,
                  contentLength: body.length,
                  contentType: res.headers['content-type'],
                  headers: res.headers,
                },
              });
            });
          }
        );
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: `请求超时 (${timeout}ms)`, data: { url, duration: Date.now() - start } });
        });
        req.on('error', (err) => {
          resolve({ success: false, error: err.message, data: { url, duration: Date.now() - start } });
        });
        req.end();
      } catch (err: any) {
        resolve({ success: false, error: err?.message || '请求失败' });
      }
    });
  },
};

// ─── net_port_check ─────────────────────────────────────
const portCheckDef: CapabilityDefinition = {
  name: 'port_check',
  namespace: 'network',
  description: '检测指定主机和端口是否开放',
  riskLevel: 'read',
  argsSchema: z.object({
    host: z.string().describe('主机地址'),
    port: z.number().describe('端口号'),
    timeout: z.number().optional().default(5000).describe('超时毫秒'),
  }),
  handler: async ({ host, port, timeout }) => {
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.once('connect', () => {
        socket.destroy();
        resolve({
          success: true,
          data: { host, port, open: true, duration: Date.now() - start },
        });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve({
          success: true,
          data: { host, port, open: false, reason: 'timeout', duration: Date.now() - start },
        });
      });
      socket.once('error', (err: any) => {
        resolve({
          success: true,
          data: { host, port, open: false, reason: err.code || err.message, duration: Date.now() - start },
        });
      });
      socket.connect(port, host);
    });
  },
};

// ─── net_dns_resolve ────────────────────────────────────
const dnsResolveDef: CapabilityDefinition = {
  name: 'dns_resolve',
  namespace: 'network',
  description: 'DNS 解析（获取域名对应的 IP 地址）',
  riskLevel: 'read',
  argsSchema: z.object({
    hostname: z.string().describe('域名'),
    type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS']).optional().default('A').describe('记录类型'),
  }),
  handler: async ({ hostname, type }) => {
    try {
      const start = Date.now();
      const records = await dnsResolve(hostname, type);
      return {
        success: true,
        data: {
          hostname,
          type,
          records: Array.isArray(records) ? records : [records],
          duration: Date.now() - start,
        },
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'DNS 解析失败' };
    }
  },
};

// ─── net_dns_lookup ─────────────────────────────────────
const dnsLookupDef: CapabilityDefinition = {
  name: 'dns_lookup',
  namespace: 'network',
  description: 'DNS lookup（获取域名的 IP 和 TTL 等）',
  riskLevel: 'read',
  argsSchema: z.object({
    hostname: z.string().describe('域名'),
    family: z.union([z.literal(4), z.literal(6)]).optional().describe('IP 版本'),
  }),
  handler: async ({ hostname, family }) => {
    try {
      const start = Date.now();
      const result = await dnsLookup(hostname, family ? { family } : undefined);
      return {
        success: true,
        data: {
          hostname,
          address: result.address,
          family: result.family,
          duration: Date.now() - start,
        },
      };
    } catch (err: any) {
      return { success: false, error: err?.message || 'DNS lookup 失败' };
    }
  },
};

// ─── net_local_ports ────────────────────────────────────
const localPortsDef: CapabilityDefinition = {
  name: 'local_ports',
  namespace: 'network',
  description: '扫描本地常用端口，发现运行中的服务',
  riskLevel: 'read',
  argsSchema: z.object({
    ports: z.array(z.number()).optional().describe('要扫描的端口列表'),
  }),
  handler: async ({ ports }) => {
    const defaultPorts = [80, 443, 1519, 1520, 1521, 3000, 3001, 5000, 5173, 8000, 8080, 8888, 9000, 9222, 9333, 9334, 1596];
    const targetPorts = ports || defaultPorts;
    const results: Array<{ port: number; open: boolean }> = [];

    await Promise.all(
      targetPorts.map(async (port) => {
        const result = await new Promise<boolean>((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(500);
          socket.once('connect', () => { socket.destroy(); resolve(true); });
          socket.once('timeout', () => { socket.destroy(); resolve(false); });
          socket.once('error', () => { socket.destroy(); resolve(false); });
          socket.connect(port, '127.0.0.1');
        });
        results.push({ port, open: result });
      })
    );

    const openPorts = results.filter((r) => r.open).sort((a, b) => a.port - b.port);
    return {
      success: true,
      data: {
        openPorts,
        scanned: targetPorts.length,
        openCount: openPorts.length,
      },
    };
  },
};

// ─── net_ping ───────────────────────────────────────────
const pingDef: CapabilityDefinition = {
  name: 'ping',
  namespace: 'network',
  description: '通过 TCP 连接模拟 Ping（检测主机可达性和延迟）',
  riskLevel: 'read',
  argsSchema: z.object({
    host: z.string().describe('目标主机'),
    port: z.number().optional().default(80).describe('检测端口'),
    count: z.number().optional().default(4).describe('检测次数'),
    timeout: z.number().optional().default(5000).describe('单次超时毫秒'),
  }),
  handler: async ({ host, port, count, timeout }) => {
    const results: Array<{ attempt: number; latency: number; success: boolean }> = [];
    for (let i = 0; i < count; i++) {
      const start = Date.now();
      const success = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeout);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
      });
      results.push({ attempt: i + 1, latency: Date.now() - start, success });
      if (i < count - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const successful = results.filter((r) => r.success);
    const latencies = successful.map((r) => r.latency);
    return {
      success: true,
      data: {
        host,
        port,
        attempts: count,
        successful: successful.length,
        failed: count - successful.length,
        minLatency: latencies.length > 0 ? Math.min(...latencies) : null,
        maxLatency: latencies.length > 0 ? Math.max(...latencies) : null,
        avgLatency: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
        details: results,
      },
    };
  },
};

// ─── 注册所有网络诊断能力 ──────────────────────────────────
export function registerNetworkCapabilities(): void {
  CapabilityRegistry.registerAll([
    httpCheckDef,
    portCheckDef,
    dnsResolveDef,
    dnsLookupDef,
    localPortsDef,
    pingDef,
  ]);
}
