import { spawn } from 'child_process';
import { isPackagedRuntime } from './playwrightRuntime.js';

function resolveAutoOpenValue() {
    const explicitValue = process.env.YISHE_OPEN_BROWSER_ON_START ?? process.env.UPLOADER_OPEN_BROWSER_ON_START;
    if (explicitValue !== undefined) {
        return ['1', 'true', 'yes'].includes(String(explicitValue).trim().toLowerCase());
    }

    if (process.env.CI) {
        return false;
    }

    return isPackagedRuntime();
}

export function shouldAutoOpenBrowserOnStart() {
    return resolveAutoOpenValue();
}

export function openExternalUrl(url) {
    const normalizedUrl = String(url || '').trim();
    if (!normalizedUrl) {
        return false;
    }

    let command;
    if (process.platform === 'darwin') {
        command = ['open', normalizedUrl];
    } else if (process.platform === 'win32') {
        command = ['cmd', '/c', 'start', '""', normalizedUrl];
    } else {
        command = ['xdg-open', normalizedUrl];
    }

    try {
        const child = spawn(command[0], command.slice(1), {
            stdio: 'ignore',
            detached: true,
        });
        child.unref();
        return true;
    } catch {
        return false;
    }
}
