/**
 * 简化的时间工具类
 * 只处理必要的时间转换和显示，不进行复杂验证
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
   * 解析用户输入的时间
   * 支持多种格式: 秒、毫秒、ISO字符串
   */
  static parseUserInput(input: string): number {
    // 尝试解析为数字 (秒或毫秒)
    const num = parseInt(input, 10);
    if (Number.isFinite(num)) {
      // 如果数字很大 (超过当前年份的毫秒数)，认为是毫秒
      if (num > 1000000000000) { // 2001年以后的毫秒数
        return num;
      } else {
        // 否则认为是秒
        return num * 1000;
      }
    }

    // 尝试解析为 ISO 字符串
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }

    throw new Error(`无法解析时间输入: ${input}`);
  }

  /**
   * 验证时间戳是否合理
   * 简单验证，不强制
   */
  static isValidTimestamp(timestamp: number): boolean {
    const now = this.nowMs();
    // 时间戳应该在合理范围内: 2020年到10年后
    return timestamp >= 1577836800000 && timestamp <= now + 10 * 365 * 24 * 60 * 60 * 1000;
  }
}

/**
 * 用户输入时间转换助手
 */
export class TimeInputHelper {
  /**
   * 处理用户输入的时间参数
   * 自动检测单位并转换为毫秒
   */
  static processTimeInput(input: string | number, description: string = '时间'): number {
    try {
      const strInput = String(input);
      
      // 如果是数字字符串，尝试解析
      if (/^\d+$/.test(strInput)) {
        const num = parseInt(strInput, 10);
        
        // 如果数字很大，认为是毫秒
        if (num > 1000000000000) {
          console.log(`📅 ${description}: ${SimpleTimeUtils.formatTimestamp(num)}`);
          return num;
        } else {
          // 否则认为是秒
          const ms = num * 1000;
          console.log(`📅 ${description}: ${SimpleTimeUtils.formatTimestamp(ms)}`);
          return ms;
        }
      }

      // 尝试解析为 ISO 字符串
      const ms = SimpleTimeUtils.parseUserInput(strInput);
      console.log(`📅 ${description}: ${SimpleTimeUtils.formatTimestamp(ms)}`);
      return ms;

    } catch (error: any) {
      throw new Error(`无效的${description}输入: ${input}. 错误: ${error.message}`);
    }
  }

  /**
   * 显示时间输入示例
   */
  static showInputExamples(): void {
    console.log('⏰ 时间输入格式示例:');
    console.log('   - 秒级时间戳: 1704067200');
    console.log('   - 毫秒级时间戳: 1704067200000');
    console.log('   - ISO 字符串: 2024-01-01T00:00:00Z');
    console.log('   - 本地时间: 2024-01-01 08:00:00');
  }
}
