/**
 * GitHub 搜索能力 - https://github.com
 * API: api.github.com (REST + GraphQL)
 */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';

const API_BASE = 'https://api.github.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export interface GithubRepo {
  id: number; name: string; full_name: string; description: string; html_url: string;
  language: string; stargazers_count: number; forks_count: number; open_issues_count: number;
  created_at: string; updated_at: string; pushed_at: string; topics: string[];
  license: { name: string; spdx_id: string } | null; owner: { login: string; avatar_url: string; html_url: string };
  watchers_count: number; default_branch: string; archived: boolean; fork: boolean;
}

export interface GithubUser {
  id: number; login: string; avatar_url: string; html_url: string; type: string;
  name: string; bio: string; public_repos: number; followers: number; following: number;
  created_at: string; location: string; blog: string; twitter_username: string;
}

export interface GithubSearchResult<T> {
  success: boolean; query: string; count: number; total: number; items: T[]; error?: string;
}

async function getFetchImpl() {
  if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  return fetch;
}

export async function getGithubStatus() {
  const site = await checkSiteAvailability('https://github.com', { timeoutMs: 8000 });
  return { key: 'github', pluginKey: 'github', label: 'GitHub', connected: site.ok, available: site.ok, status: site.ok ? 'connected' : 'error', state: site.ok ? 'idle' : 'offline', message: site.ok ? 'GitHub 可用' : `无法连接: ${site.error || '超时'}`, lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'fetch', 'status'] };
}

export async function searchGithubRepos(query: string, options: { sort?: 'stars' | 'forks' | 'updated'; order?: 'asc' | 'desc'; perPage?: number; page?: number; language?: string; created?: string; pushed?: string } = {}): Promise<GithubSearchResult<GithubRepo>> {
  const perPage = Math.min(options.perPage || 30, 100);
  try {
    const fetchFn = await getFetchImpl();
    const q = [query, options.language ? `language:${options.language}` : '', options.created ? `created:>${options.created}` : '', options.pushed ? `pushed:>${options.pushed}` : ''].filter(Boolean).join(' ');
    const params = new URLSearchParams({ q, sort: options.sort || 'stars', order: options.order || 'desc', per_page: String(perPage), page: String(options.page || 1) });
    const res = await fetchFn(`${API_BASE}/search/repositories?${params}`, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, query, count: data.items?.length || 0, total: data.total_count || 0, items: data.items || [] };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function getGithubRepo(owner: string, repo: string): Promise<GithubRepo | null> {
  try {
    const fetchFn = await getFetchImpl();
    const res = await fetchFn(`${API_BASE}/repos/${owner}/${repo}`, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github.v3+json' } });
    return res.ok ? res.json() : null;
  } catch { return null; }
}

export async function searchGithubUsers(query: string, options: { sort?: 'followers' | 'repositories' | 'joined'; order?: 'asc' | 'desc'; perPage?: number; page?: number } = {}): Promise<GithubSearchResult<GithubUser>> {
  const perPage = Math.min(options.perPage || 30, 100);
  try {
    const fetchFn = await getFetchImpl();
    const params = new URLSearchParams({ q: query, sort: options.sort || 'followers', order: options.order || 'desc', per_page: String(perPage), page: String(options.page || 1) });
    const res = await fetchFn(`${API_BASE}/search/users?${params}`, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, query, count: data.items?.length || 0, total: data.total_count || 0, items: data.items || [] };
  } catch (error: any) {
    return { success: false, query, count: 0, total: 0, items: [], error: error?.message || '搜索失败' };
  }
}

export async function syncGithubToLibrary(_clientId: string, data: { metadata?: Record<string, any> }) {
  return { success: true, message: '数据已获取', data: { ...data.metadata, source: 'github', syncedAt: new Date().toISOString() } };
}
