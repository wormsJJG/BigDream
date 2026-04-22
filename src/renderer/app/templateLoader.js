// Synced from TypeScript preview output. Source of truth: templateLoader.ts
import { SCREEN_IDS, getScreenTemplateCandidates } from './screenPaths.js';
async function fetchText(relativePath) {
    try {
        if (window?.bdScanner?.app?.readTextFile) {
            return await window.bdScanner.app.readTextFile(relativePath);
        }
    }
    catch (e) {
        console.warn('[templateLoader] IPC read failed, falling back to fetch:', e);
    }
    const url = new URL(relativePath, window.location.href);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to load template: ${relativePath} (${res.status})`);
    }
    return await res.text();
}
async function fetchFirstAvailableText(candidatePaths) {
    let lastError = null;
    for (const candidatePath of candidatePaths) {
        try {
            return await fetchText(candidatePath);
        }
        catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error(`Failed to load template from candidates: ${candidatePaths.join(', ')}`);
}
export async function loadTemplates() {
    const slots = Array.from(document.querySelectorAll('[data-template]'));
    await Promise.all(slots.map(async (el) => {
        const path = el.getAttribute('data-template');
        if (!path)
            return;
        const html = await fetchText(`src/renderer/${path}`);
        el.innerHTML = html;
    }));
    for (const id of SCREEN_IDS) {
        const host = document.getElementById(id);
        if (!host)
            continue;
        const html = await fetchFirstAvailableText(getScreenTemplateCandidates(id));
        host.innerHTML = html;
    }
}
