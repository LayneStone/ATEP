import type { NostrTaskEvent } from "./task-events";
import type { TaskKind } from "./task-kinds";

/**
 * 事件过滤器
 *
 * 支持按 Kind、Task ID 和协议标识过滤事件
 */
export interface TaskEventFilter {
  /** 事件类型过滤 */
  kinds?: TaskKind[];

  /** 任务 ID 过滤 */
  taskId?: string;

  /** 协议标识过滤（默认为 "atep"） */
  protocol?: string;
}

export type TaskEventHandler = (event: NostrTaskEvent) => void | Promise<void>;

interface LocalSubscriber {
  id: string;
  filter: TaskEventFilter;
  handler: TaskEventHandler;
}

/**
 * 检查事件是否匹配过滤器
 */
function eventMatchesFilter(event: NostrTaskEvent, filter: TaskEventFilter): boolean {
  // Kind 过滤
  if (filter.kinds && filter.kinds.length > 0 && !filter.kinds.includes(event.kind)) {
    return false;
  }

  // Task ID 过滤
  if (filter.taskId) {
    const matched = event.tags.some((tag) => tag[0] === "task_id" && tag[1] === filter.taskId);
    if (!matched) {
      return false;
    }
  }

  // 协议标识过滤
  if (filter.protocol) {
    const protocolTag = event.tags.find((tag) => tag[0] === "protocol");
    if (!protocolTag || protocolTag[1] !== filter.protocol) {
      return false;
    }
  }

  return true;
}

/**
 * 本地内存版 relay：
 * - 不联网，不会发到公共 Nostr
 * - 用于先验证业务流程（发布/订阅/过滤/状态机）
 */
export class LocalTestRelay {
  private subscribers: LocalSubscriber[] = [];

  subscribe(filter: TaskEventFilter, handler: TaskEventHandler): () => void {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.subscribers.push({ id, filter, handler });
    return () => {
      this.subscribers = this.subscribers.filter((item) => item.id !== id);
    };
  }

  async publish(event: NostrTaskEvent): Promise<void> {
    for (const sub of this.subscribers) {
      if (eventMatchesFilter(event, sub.filter)) {
        await sub.handler(event);
      }
    }
  }
}

