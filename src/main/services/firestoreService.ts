import { createFirestoreService as createFirestoreServiceJs } from './firestoreService.js';

type FirestoreCallPayload = {
    op: string;
    path: string[];
    data?: Record<string, unknown>;
    options?: Record<string, unknown>;
    constraints?: Array<Record<string, unknown>>;
};

type FirestoreService = {
    ensureFirebase(): void;
    login(email: string, password: string): Promise<{ ok: true; uid: string | null }>;
    logout(): Promise<{ ok: true }>;
    createUser(email: string, password: string): Promise<{ ok: true; uid: string | null }>;
    call(payload: FirestoreCallPayload, options?: { requireAuth?: boolean }): Promise<unknown>;
    getDocPublic(pathSegments: string[]): Promise<{ exists: boolean; id: string; data: unknown }>;
};

export function createFirestoreService(): FirestoreService {
    return createFirestoreServiceJs() as FirestoreService;
}

