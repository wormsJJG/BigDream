export type FirestoreConstraintPayload =
    | { __type: 'where'; field: string; op: string; value: unknown }
    | { __type: 'orderBy'; field: string; direction?: 'asc' | 'desc' }
    | { __type: 'limit'; n: number }
    | { __type: 'startAfter'; value: unknown };

export type FirestorePayloadRecord = Record<string, unknown>;
export type FirestoreDocData = FirestorePayloadRecord | null;
export type FirestoreSetOptions = {
    merge?: boolean;
    mergeFields?: string[];
};

export type FirestoreCallPayload = {
    op: string;
    path: string[];
    data?: FirestorePayloadRecord;
    options?: FirestoreSetOptions;
    constraints?: FirestoreConstraintPayload[];
};

export type FirestoreLoginResult = {
    ok: true;
    uid: string | null;
};

export type FirestoreLogoutResult = {
    ok: true;
};

export type FirestoreCreateUserResult = {
    ok: true;
    uid: string | null;
};

export type FirestoreDocReadResult = {
    exists: boolean;
    id?: string;
    data: FirestoreDocData;
};

export type FirestoreMutationResult = {
    ok: true;
};

export type FirestoreAddDocResult = {
    ok: true;
    id: string;
};

export type FirestoreQueryResult = {
    docs: Array<{ id: string; data: FirestoreDocData }>;
};

export type FirestoreCallResult =
    | FirestoreDocReadResult
    | FirestoreMutationResult
    | FirestoreAddDocResult
    | FirestoreQueryResult;

export function createFirestoreService() {
    let firebaseApp: { name?: string } | null = null;
    let firebaseAuth: { currentUser?: { uid?: string | null } | null } | null = null;
    let firestoreDb: { type?: 'firestore' } | null = null;

    const firebaseConfig = {
        apiKey: 'AIzaSyDGTvT4En8iXJENDU3miHSJnD_n6MUF10M',
        authDomain: 'bigdream-216cb.firebaseapp.com',
        projectId: 'bigdream-216cb',
        storageBucket: 'bigdream-216cb.firebasestorage.app',
        messagingSenderId: '495577029138',
        appId: '1:495577029138:web:23c815b526932fc71196cb',
        measurementId: 'G-TEQ25W7CGZ'
    };

    function isPayloadRecord(value: unknown): value is FirestorePayloadRecord {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function getFirebaseModules(): {
        initializeApp(config: FirestorePayloadRecord, name?: string): { name?: string };
        getApps(): Array<{ name?: string }>;
        deleteApp(app: { name?: string }): Promise<void>;
        getAuth(app: { name?: string }): { currentUser?: { uid?: string | null } | null };
        signInWithEmailAndPassword(auth: { currentUser?: { uid?: string | null } | null }, email: string, password: string): Promise<{
            user?: { uid?: string | null };
        }>;
        signOut(auth: { currentUser?: { uid?: string | null } | null }): Promise<void>;
        createUserWithEmailAndPassword(auth: { currentUser?: { uid?: string | null } | null }, email: string, password: string): Promise<{
            user?: { uid?: string | null };
        }>;
        getFirestore(app: { name?: string }): { type?: 'firestore' };
    } {
        const appModule = require('firebase/app');
        const authModule = require('firebase/auth');
        const firestoreModule = require('firebase/firestore');

        return {
            initializeApp: appModule.initializeApp,
            getApps: appModule.getApps,
            deleteApp: appModule.deleteApp,
            getAuth: authModule.getAuth,
            signInWithEmailAndPassword: authModule.signInWithEmailAndPassword,
            signOut: authModule.signOut,
            createUserWithEmailAndPassword: authModule.createUserWithEmailAndPassword,
            getFirestore: firestoreModule.getFirestore,
        };
    }

    function ensureFirebase(): void {
        if (firebaseApp && firebaseAuth && firestoreDb) return;

        const { initializeApp, getApps, getAuth, getFirestore } = getFirebaseModules();
        const apps = getApps();
        firebaseApp = apps.length === 0 ? initializeApp(firebaseConfig) : apps[0];
        firebaseAuth = getAuth(firebaseApp);
        firestoreDb = getFirestore(firebaseApp);
    }

    function requireAuthIfNeeded(requireAuth: boolean): void {
        ensureFirebase();
        if (requireAuth && !firebaseAuth?.currentUser) {
            const err = new Error('NOT_AUTHENTICATED_IN_MAIN') as Error & { code?: string };
            err.code = 'NOT_AUTHENTICATED_IN_MAIN';
            throw err;
        }
    }

    async function login(email: string, password: string): Promise<FirestoreLoginResult> {
        ensureFirebase();
        const { signInWithEmailAndPassword } = getFirebaseModules();
        if (!email || !password) throw new Error('email/password required');
        const cred = await signInWithEmailAndPassword(firebaseAuth as { currentUser?: { uid?: string | null } | null }, email, password);
        return { ok: true as const, uid: cred?.user?.uid || null };
    }

    async function logout(): Promise<FirestoreLogoutResult> {
        ensureFirebase();
        const { signOut } = getFirebaseModules();
        await signOut(firebaseAuth as { currentUser?: { uid?: string | null } | null });
        return { ok: true as const };
    }

    async function createUser(email: string, password: string): Promise<FirestoreCreateUserResult> {
        ensureFirebase();
        if (!email || !password) throw new Error('email/password required');

        const { initializeApp, deleteApp, getAuth, createUserWithEmailAndPassword } = getFirebaseModules();
        const secondaryName = `secondaryApp-${Date.now()}`;
        const secondaryApp = initializeApp(firebaseConfig, secondaryName);
        try {
            const secondaryAuth = getAuth(secondaryApp);
            const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            return { ok: true as const, uid: cred?.user?.uid || null };
        } finally {
            try { await deleteApp(secondaryApp); } catch (_e) { /* noop */ }
        }
    }

    function decodeFieldValue(v: unknown): unknown {
        if (isPayloadRecord(v) && v.__op === 'increment') {
            const { increment } = require('firebase/firestore');
            const encoded = v as {
                __op?: 'increment' | 'serverTimestamp';
                n?: unknown;
                operand?: unknown;
                increment?: unknown;
                value?: unknown;
            };
            const raw =
                (encoded.n !== undefined ? encoded.n : undefined) ??
                (encoded.operand !== undefined ? encoded.operand : undefined) ??
                (encoded.increment !== undefined ? encoded.increment : undefined) ??
                (encoded.value !== undefined ? encoded.value : undefined) ??
                0;
            return increment(Number(raw || 0));
        }
        if (isPayloadRecord(v) && v.__op === 'serverTimestamp') {
            const { serverTimestamp } = require('firebase/firestore');
            return serverTimestamp();
        }
        return v;
    }

    function decodeData(obj: unknown): unknown {
        if (Array.isArray(obj)) return obj.map(decodeData);
        if (!isPayloadRecord(obj)) return decodeFieldValue(obj);

        const decoded = decodeFieldValue(obj);
        if (decoded !== obj) return decoded;

        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) out[k] = decodeData(v);
        return out;
    }

    function docRef(pathSegments: string[]) {
        const { doc } = require('firebase/firestore');
        return doc(firestoreDb, ...pathSegments);
    }

    function colRef(pathSegments: string[]) {
        const { collection } = require('firebase/firestore');
        return collection(firestoreDb, ...pathSegments);
    }

    function applyConstraints(baseQuery: unknown, constraints: FirestoreConstraintPayload[]) {
        const { where, orderBy, limit, startAfter, query } = require('firebase/firestore');
        const clauses: unknown[] = [];
        for (const c of (constraints || [])) {
            if (!c || !c.__type) continue;
            if (c.__type === 'where') clauses.push(where(c.field, c.op, c.value));
            if (c.__type === 'orderBy') clauses.push(orderBy(c.field, c.direction || 'asc'));
            if (c.__type === 'limit') clauses.push(limit(Number(c.n || 0)));
            if (c.__type === 'startAfter') clauses.push(startAfter(c.value));
        }
        return query(baseQuery, ...clauses);
    }

    async function getDocPublic(pathSegments: string[]): Promise<FirestoreDocReadResult> {
        ensureFirebase();
        const { getDoc } = require('firebase/firestore');
        const snap = await getDoc(docRef(pathSegments)) as {
            exists(): boolean;
            id: string;
            data(): FirestoreDocData;
        };
        return { exists: snap.exists(), id: snap.id, data: snap.exists() ? snap.data() : null };
    }

    async function call(payload: FirestoreCallPayload, { requireAuth = true } = {}): Promise<FirestoreCallResult> {
        requireAuthIfNeeded(requireAuth);

        const op = payload?.op;
        const pathSegments = payload?.path;

        if (!op || !Array.isArray(pathSegments) || pathSegments.length === 0) {
            throw new Error('Invalid firestore payload');
        }

        const firestore = require('firebase/firestore');
        const { getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocs } = firestore;

        switch (op) {
            case 'getDoc': {
                const snap = await getDoc(docRef(pathSegments)) as {
                    exists(): boolean;
                    id: string;
                    data(): FirestoreDocData;
                };
                return { exists: snap.exists(), id: snap.id, data: snap.exists() ? snap.data() : null };
            }
            case 'setDoc': {
                await setDoc(docRef(pathSegments), decodeData(payload.data || {}), payload.options || {});
                return { ok: true };
            }
            case 'updateDoc': {
                await updateDoc(docRef(pathSegments), decodeData(payload.data || {}));
                return { ok: true };
            }
            case 'deleteDoc': {
                await deleteDoc(docRef(pathSegments));
                return { ok: true };
            }
            case 'addDoc': {
                const added = await addDoc(colRef(pathSegments), decodeData(payload.data || {}));
                return { ok: true, id: added.id };
            }
            case 'query': {
                const base = colRef(pathSegments);
                const qq = applyConstraints(base, payload.constraints || []);
                const snap = await getDocs(qq) as {
                    forEach(callback: (doc: { id: string; data(): FirestoreDocData }) => void): void;
                };
                const docs: Array<{ id: string; data: FirestoreDocData }> = [];
                snap.forEach((d) => docs.push({ id: d.id, data: d.data() }));
                return { docs };
            }
            default:
                throw new Error(`Unsupported firestore op: ${op}`);
        }
    }

    return {
        ensureFirebase,
        login,
        logout,
        createUser,
        call,
        getDocPublic,
    };
}
