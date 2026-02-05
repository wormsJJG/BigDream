// src/renderer/core/templateLoader.js
// Loads HTML partials (components + screens) into placeholders before app logic binds events.

async function fetchText(relativePath) {
    // In Electron, `fetch(file://...)` can be blocked depending on security settings.
    // Prefer reading via preload->main IPC when available.
    try {
        if (window?.bdScanner?.app?.readTextFile) {
            return await window.bdScanner.app.readTextFile(relativePath);
        }
    } catch (e) {
        console.warn('[templateLoader] IPC read failed, falling back to fetch:', e);
    }

    const url = new URL(relativePath, window.location.href);
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to load template: ${relativePath} (${res.status})`);
    }
    return await res.text();
}

export async function loadTemplates() {
    // Load components into elements marked with data-template
    const slots = Array.from(document.querySelectorAll('[data-template]'));
    await Promise.all(slots.map(async (el) => {
        const path = el.getAttribute('data-template');
        const html = await fetchText(`src/renderer/${path}`);
        el.innerHTML = html;
    }));

    // Load screens by id into their placeholder sections
    const screenIds = [
        'login-screen','support-screen','create-scan-screen','device-connection-screen','open-scan-screen',
        'scan-progress-screen','scan-results-screen','admin-screen','admin-report-detail-screen',
    ];

    for (const id of screenIds) {
        const host = document.getElementById(id);
        if (!host) continue;
        const html = await fetchText(`src/renderer/screens/${id}/view.html`);
        host.innerHTML = html;
    }
}
