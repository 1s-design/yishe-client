/** Open-Meteo 天气 - https://api.open-meteo.com */
import { net } from 'electron';
import { checkSiteAvailability } from './siteAvailability';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
export interface WeatherData { latitude: number; longitude: number; current_weather: { temperature: number; windspeed: number; winddirection: number; weathercode: number; time: string }; hourly?: any; daily?: any; }
export interface WeatherResult { success: boolean; query: string; data?: WeatherData; error?: string; }
async function getFetchImpl() { if (net && typeof net.fetch === 'function') return net.fetch.bind(net); return fetch; }
export async function getOpenMeteoStatus() { const s = await checkSiteAvailability('https://api.open-meteo.com', { timeoutMs: 8000 }); return { key: 'openmeteo', pluginKey: 'openmeteo', label: 'Open-Meteo 天气', connected: s.ok, available: s.ok, status: s.ok ? 'connected' : 'error', state: s.ok ? 'idle' : 'offline', message: s.ok ? 'Open-Meteo 可用' : '无法连接', lastCheckedAt: new Date().toISOString(), supportedCommands: ['search', 'status'] }; }
export const getOpenmeteoStatus = getOpenMeteoStatus;

export async function searchOpenMeteo(opts: { latitude: number; longitude: number; current?: boolean; hourly?: string; daily?: string; timezone?: string; forecast_days?: number }): Promise<WeatherResult> {
  try {
    const fetchFn = await getFetchImpl();
    const params = new URLSearchParams({ latitude: String(opts.latitude), longitude: String(opts.longitude), timezone: opts.timezone || 'auto' });
    if (opts.current) params.set('current_weather', 'true');
    if (opts.hourly) params.set('hourly', opts.hourly);
    if (opts.daily) params.set('daily', opts.daily);
    if (opts.forecast_days) params.set('forecast_days', String(opts.forecast_days));
    const res = await fetchFn(`https://api.open-meteo.com/v1/forecast?${params}`, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return { success: false, query: `${opts.latitude},${opts.longitude}`, error: `HTTP ${res.status}` };
    return { success: true, query: `${opts.latitude},${opts.longitude}`, data: await res.json() };
  } catch (e: any) { return { success: false, query: `${opts.latitude},${opts.longitude}`, error: e?.message || '获取失败' }; }
}
export async function syncOpenMeteoToLibrary(_c: string, d: any) { return { success: true, message: '数据已获取', data: { ...d?.metadata, source: 'openmeteo', syncedAt: new Date().toISOString() } }; }
