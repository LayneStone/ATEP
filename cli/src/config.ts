/**
 * CLI 配置系统
 * 去中心化设计，用户必须指定索引器或使用中继扫描
 */

export interface DataSourceConfig {
  /** 用户指定的索引器 */
  customIndexer: {
    enabled: boolean;
    url: string;
    priority: number;
  };

  /** 直接扫描中继器（去中心化兜底方案） */
  relayScan: {
    enabled: boolean;
    relays: string[];
    priority: number;
  };

  /** 社区索引器列表（用户可选择性信任） */
  communityIndexers: Array<{
    enabled: boolean;
    name: string;
    url: string;
    priority: number;
    trusted: boolean;
  }>;
}

/**
 * 内置默认配置 - 去中心化
 * 不包含任何中心化索引器，用户必须指定或使用中继扫描
 */
export const DEFAULT_CONFIG: DataSourceConfig = {
  customIndexer: {
    enabled: false,  // 默认关闭，用户必须通过 --indexer-url 指定
    url: '',
    priority: 1,
  },
  relayScan: {
    enabled: true,  // 默认开启中继扫描作为去中心化兜底方案
    relays: [
      'wss://relay.damus.io',
      'wss://relay.nostr.band',
      'wss://nos.lol',
      'wss://offchain.pub',
    ],
    priority: 2,
  },
  communityIndexers: [],  // 用户可自行添加社区索引器
};

export class CliConfig {
  private config: DataSourceConfig;

  /**
   * 创建配置实例
   * 如果不传参数，使用内置默认配置（开箱即用）
   */
  constructor(customConfig?: Partial<DataSourceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
  }

  /**
   * 加载配置，如果不存在则创建默认配置
   * 开箱即用，无需用户手动创建配置文件
   */
  static loadOrCreate(filepath?: string): CliConfig {
    const fs = require('fs');
    const path = require('path');
    
    // 默认配置文件路径
    const defaultPath = filepath || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atep', 'config.json');
    
    try {
      // 尝试加载已有配置
      if (fs.existsSync(defaultPath)) {
        const content = fs.readFileSync(defaultPath, 'utf8');
        const savedConfig = JSON.parse(content);
        console.log(`[CliConfig] 已加载配置文件: ${defaultPath}`);
        return new CliConfig(savedConfig);
      }
    } catch (error) {
      console.warn('[CliConfig] 加载配置文件失败，使用默认配置:', error);
    }
    
    // 使用内置默认配置
    console.log('[CliConfig] 使用内置默认配置（开箱即用）');
    return new CliConfig();
  }

  /**
   * 保存配置到本地文件
   * 用户修改配置后调用此方法保存
   */
  saveToFile(filepath?: string): void {
    const fs = require('fs');
    const path = require('path');
    
    const defaultPath = filepath || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.atep', 'config.json');
    
    // 确保目录存在
    const dir = path.dirname(defaultPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(defaultPath, JSON.stringify(this.config, null, 2), 'utf8');
    console.log(`[CliConfig] 配置已保存: ${defaultPath}`);
  }

  getConfig(): DataSourceConfig {
    return { ...this.config };
  }

  /** 启用/禁用中继扫描 */
  setRelayScan(enabled: boolean, relays?: string[]) {
    this.config.relayScan.enabled = enabled;
    if (relays) {
      this.config.relayScan.relays = relays;
    }
  }

  /** 设置自定义索引器 */
  setCustomIndexer(url: string, priority: number = 1) {
    this.config.customIndexer.enabled = true;
    this.config.customIndexer.url = url;
    this.config.customIndexer.priority = priority;
  }

  /** 添加社区索引器 */
  addCommunityIndexer(name: string, url: string, priority: number = 3, trusted: boolean = false) {
    this.config.communityIndexers.push({
      enabled: true,
      name,
      url,
      priority,
      trusted,
    });
    this.config.communityIndexers.sort((a, b) => a.priority - b.priority);
  }

  /** 移除社区索引器 */
  removeCommunityIndexer(name: string) {
    this.config.communityIndexers = this.config.communityIndexers.filter(
      (idx) => idx.name !== name
    );
  }

  /** 获取启用的数据源，按优先级排序 */
  getEnabledSources(): Array<{ type: 'custom' | 'relay' | 'community'; config: any }> {
    const sources: Array<{ type: 'custom' | 'relay' | 'community'; config: any; priority: number }> = [];

    if (this.config.customIndexer.enabled) {
      sources.push({ type: 'custom', config: this.config.customIndexer, priority: this.config.customIndexer.priority });
    }

    if (this.config.relayScan.enabled) {
      sources.push({ type: 'relay', config: this.config.relayScan, priority: this.config.relayScan.priority });
    }

    for (const indexer of this.config.communityIndexers) {
      if (indexer.enabled) {
        sources.push({ type: 'community', config: indexer, priority: indexer.priority });
      }
    }

    return sources.sort((a, b) => a.priority - b.priority);
  }

  /** @deprecated 使用 loadOrCreate 替代 */
  static loadFromFile(filepath: string): CliConfig {
    return CliConfig.loadOrCreate(filepath);
  }
}
