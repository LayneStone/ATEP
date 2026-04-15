// Global type declarations for atep project
declare module 'ws' {
  export class WebSocket {
    constructor(url: string);
    on(event: string, callback: Function): void;
    send(data: string): void;
    close(): void;
    readyState: number;
  }
}

// Global type for fetch response
interface ApiResponse<T = any> {
  ok: boolean;
  data?: T;
  error?: string;
}

// Global type for indexer responses
interface TaskResponse {
  data: any[];
  total: number;
  page: number;
  limit: number;
}

interface VerifierResponse {
  ok: boolean;
  data: {
    whitelist: Array<{
      pubkey: string;
      sui_address?: string;
      effective_from?: number;
      expires_at?: number;
      added_at?: number;
    }>;
    total_count?: number;
    active_count?: number;
    last_updated?: number;
    source?: string;
  };
}
