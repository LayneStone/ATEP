import { type TaskKind, type TaskPayloadByKind } from "./task-kinds";
export type NostrTag = [string, ...string[]];
export interface NostrTaskEvent<K extends TaskKind = TaskKind> {
    kind: K;
    pubkey: string;
    created_at: number;
    tags: NostrTag[];
    content: string;
    sig?: string;
    id?: string;
}
export declare function createTaskEvent<K extends TaskKind>(args: {
    kind: K;
    pubkey: string;
    created_at?: number;
    payload: TaskPayloadByKind[K];
    extraTags?: NostrTag[];
}): NostrTaskEvent<K>;
export declare function parseTaskEventPayload<K extends TaskKind>(event: NostrTaskEvent<K>): TaskPayloadByKind[K];
//# sourceMappingURL=task-events.d.ts.map