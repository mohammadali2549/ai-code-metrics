declare module 'https' {
  // Minimal subset of the https API used in this project.
  export interface RequestOptions {
    method?: string;
    host?: string;
    path?: string;
    headers?: Record<string, string | number | undefined>;
  }

  export interface IncomingMessage {
    statusCode?: number;
    on(event: 'data', listener: (chunk: any) => void): void;
    on(event: 'end', listener: () => void): void;
  }

  export interface ClientRequest {
    on(event: 'error', listener: (err: Error) => void): void;
    write(chunk: any): void;
    end(): void;
  }

  export function request(
    options: RequestOptions,
    callback: (res: IncomingMessage) => void,
  ): ClientRequest;
}

// Minimal Node globals used in the PayPal helper implementation.
declare const process: {
  env: {
    [key: string]: string | undefined;
  };
};

declare const Buffer: {
  from(input: string): { toString(encoding?: string): string };
  byteLength(input: string): number;
};


