export function toDateSafe(value) {
    if (!value) return null;

    if (value instanceof Date) return value;

    if (typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === 'string') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }

    if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
            try {
                const d = value.toDate();
                if (d instanceof Date) return d;
                const dd = new Date(d);
                return isNaN(dd.getTime()) ? null : dd;
            } catch (_) {}
        }

        const sec = (typeof value.seconds === 'number')
            ? value.seconds
            : (typeof value._seconds === 'number' ? value._seconds : null);

        const nsec = (typeof value.nanoseconds === 'number')
            ? value.nanoseconds
            : (typeof value._nanoseconds === 'number' ? value._nanoseconds : 0);

        if (sec !== null) {
            const ms = sec * 1000 + Math.floor((nsec || 0) / 1e6);
            const d = new Date(ms);
            return isNaN(d.getTime()) ? null : d;
        }

        if (typeof value.milliseconds === 'number') {
            const d = new Date(value.milliseconds);
            return isNaN(d.getTime()) ? null : d;
        }
    }

    return null;
}

export function formatDateKR(value) {
    const d = toDateSafe(value);
    return d ? d.toLocaleDateString('ko-KR') : '-';
}

export function formatDateTimeKR(value) {
    const d = toDateSafe(value);
    return d ? d.toLocaleString('ko-KR') : '-';
}

export function normalizeCompanyName(value) {
    return String(value || '').trim();
}

export function normalizeCompanyNameLower(value) {
    return normalizeCompanyName(value).toLowerCase();
}

export function isExpectedFirestoreFallbackError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('failed-precondition')
        || message.includes('requires an index')
        || message.includes('the query requires an index');
}

export function buildQuotaHistoryGlobalEntry({
    uid,
    companyName,
    userId,
    change,
    beforeQuota,
    afterQuota,
    reason,
    actorUid,
    actorEmail,
    actionType,
    createdAt,
    createdAtMs
}) {
    return {
        uid,
        companyName: companyName || '미등록 업체',
        companyNameLower: normalizeCompanyNameLower(companyName),
        userId: userId || uid || '-',
        change: Number(change || 0),
        beforeQuota: Number(beforeQuota || 0),
        afterQuota: Number(afterQuota || 0),
        reason: reason || '-',
        actorUid: actorUid || null,
        actorEmail: actorEmail || 'unknown',
        createdAt,
        createdAtMs,
        actionType: actionType || 'adjust'
    };
}

export function encodeActionValue(value) {
    return encodeURIComponent(String(value ?? ''));
}
