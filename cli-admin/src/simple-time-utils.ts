/**
 * 简化的时间工具类 (CLI-Admin 版本)
 * 只处理必要的时间转换和显示
 */

/**
 * 时间单位转换工具
 */
export class SimpleTimeUtils {
  /**
   * 秒转毫秒
   * 用于用户输入的秒级时间戳转换为毫秒
   */
  static secToMs(sec: number | string): number {
    const numSec = typeof sec === 'string' ? parseInt(sec, 10) : sec;
    if (!Number.isFinite(numSec) || numSec < 0) {
      throw new Error(`无效的秒数: ${sec}`);
    }
    return numSec * 1000;
  }

  /**
   * 毫秒转秒
   * 用于显示和 Nostr 事件
   */
  static msToSec(ms: number | string): number {
    const numMs = typeof ms === 'string' ? parseInt(ms, 10) : ms;
    if (!Number.isFinite(numMs) || numMs < 0) {
      throw new Error(`无效的毫秒数: ${ms}`);
    }
    return Math.floor(numMs / 1000);
  }

  /**
   * 获取当前秒级时间戳
   * 用于 Nostr 事件创建
   */
  static nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * 获取当前毫秒级时间戳
   * 用于一般用途
   */
  static nowMs(): number {
    return Date.now();
  }

  /**
   * 格式化时间戳为可读字符串
   * 用于显示给用户
   */
  static formatTimestamp(timestamp: number | string, unit: 'ms' | 'sec' = 'ms'): string {
    const ms = unit === 'sec' ? this.secToMs(timestamp) : timestamp;
    return new Date(ms).toLocaleString();
  }

  /**
   * 格式化剩余时间
   * 用于显示给用户
   */
  static formatRemainingTime(deadline: number | string, unit: 'ms' | 'sec' = 'ms'): string {
    const deadlineMs = unit === 'sec' ? this.secToMs(deadline) : Number(deadline);
    const nowMs = this.nowMs();
    const remainingMs = deadlineMs - nowMs;

    if (remainingMs <= 0) {
      return '已过期';
    }

    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const minutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}天${remainingHours}小时`;
    } else if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else {
      return `${minutes}分钟`;
    }
  }

  /**
   * 管理员时间锁常量 (24小时)
   */
  static readonly ADMIN_TIME_LOCK_MS = 86_400_000; // 24小时

  /**
   * 检查管理员时间锁是否过期
   * 简化版本，只做基本检查
   */
  static isAdminTimeLockExpired(proposalTimeMs: number | string, nowMs?: number): boolean {
    const proposalMs = typeof proposalTimeMs === 'string' ? parseInt(proposalTimeMs, 10) : proposalTimeMs;
    const now = nowMs || this.nowMs();
    const deadlineMs = proposalMs + this.ADMIN_TIME_LOCK_MS;
    return now >= deadlineMs;
  }

  /**
   * 获取管理员时间锁剩余时间
   */
  static getAdminTimeLockRemaining(proposalTimeMs: number | string, nowMs?: number): string {
    const proposalMs = typeof proposalTimeMs === 'string' ? parseInt(proposalTimeMs, 10) : proposalTimeMs;
    const now = nowMs || this.nowMs();
    const deadlineMs = proposalMs + this.ADMIN_TIME_LOCK_MS;
    return this.formatRemainingTime(deadlineMs, 'ms');
  }

  /**
   * 格式化管理员时间锁状态
   */
  static formatAdminTimeLockStatus(proposalTimeMs: number | string, nowMs?: number): {
    isExpired: boolean;
    remainingTime: string;
    deadline: string;
  } {
    const proposalMs = typeof proposalTimeMs === 'string' ? parseInt(proposalTimeMs, 10) : proposalTimeMs;
    const now = nowMs || this.nowMs();
    const deadlineMs = proposalMs + this.ADMIN_TIME_LOCK_MS;
    
    return {
      isExpired: this.isAdminTimeLockExpired(proposalMs, now),
      remainingTime: this.getAdminTimeLockRemaining(proposalMs, now),
      deadline: this.formatTimestamp(deadlineMs),
    };
  }
}
