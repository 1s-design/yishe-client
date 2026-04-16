import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
}

export function normalizePriceText(value) {
    const text = sanitizeText(value);
    if (!text) return '';
    return text.replace(/([A-Za-z$€£¥￥]+)(\d)/g, '$1 $2');
}

export function sanitizeUrl(value, baseUrl = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    try {
        return new URL(raw, baseUrl || undefined).toString();
    } catch {
        return raw;
    }
}

function extractStructuredRecordKey(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const patterns = [
        { pattern: /\/dp\/([A-Z0-9]{10})/i, prefix: 'dp' },
        { pattern: /\/itm(?:\/[^/?#]+)?\/(\d+)(?:[/?#]|$)/i, prefix: 'itm' },
        { pattern: /\/item\/(\d+)\.html/i, prefix: 'item' },
        { pattern: /\/product\/([^/?#]+)/i, prefix: 'product' },
        { pattern: /[?&]sku=([^&#]+)/i, prefix: 'sku' },
        { pattern: /[?&]id=(\d+)/i, prefix: 'id' },
    ];

    for (const { pattern, prefix } of patterns) {
        const matched = text.match(pattern);
        if (matched?.[1]) {
            return `${prefix}:${matched[1]}`;
        }
    }

    return '';
}

export function normalizeRecordKey(recordKey, sourceUrl = '') {
    const primary = String(recordKey || '').trim();
    const fallback = String(sourceUrl || '').trim();
    const candidate = primary || fallback;

    if (!candidate) {
        return '';
    }

    if (candidate.length <= 180) {
        return candidate;
    }

    const structuredKey =
        extractStructuredRecordKey(primary) ||
        extractStructuredRecordKey(fallback);
    if (structuredKey) {
        return structuredKey;
    }

    return `hash:${crypto.createHash('sha1').update(candidate).digest('hex')}`;
}

export function normalizeSourceUrlForStorage(value, maxLength = 500) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return {
            sourceUrl: '',
            originalSourceUrl: '',
        };
    }

    if (normalized.length <= maxLength) {
        return {
            sourceUrl: normalized,
            originalSourceUrl: '',
        };
    }

    try {
        const url = new URL(normalized);
        url.search = '';
        url.hash = '';

        const simplified = url.toString();
        if (simplified.length <= maxLength) {
            return {
                sourceUrl: simplified,
                originalSourceUrl: normalized,
            };
        }

        return {
            sourceUrl: simplified.slice(0, maxLength),
            originalSourceUrl: normalized,
        };
    } catch {
        return {
            sourceUrl: normalized.slice(0, maxLength),
            originalSourceUrl: normalized,
        };
    }
}

function sanitizePathSegment(value, fallback = 'runtime') {
    const sanitized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);

    return sanitized || fallback;
}

export function ensureSnapshotDir(options = {}) {
    const workspaceDir =
        options && typeof options === 'object' && typeof options.workspaceDir === 'string'
            ? options.workspaceDir.trim()
            : '';
    const runFolder = sanitizePathSegment(
        options && typeof options === 'object'
            ? options.runId || `${options.platform || 'runtime'}-${options.collectScene || 'scene'}-${Date.now()}`
            : options,
        'runtime',
    );

    const dir = workspaceDir
        ? path.resolve(workspaceDir, 'browser-automation', 'ecom-collect', 'screenshots', runFolder)
        : path.join(os.tmpdir(), 'yishe-ecom-collect', runFolder);

    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

export function nowIso() {
    return new Date().toISOString();
}
