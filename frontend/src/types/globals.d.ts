interface Window {
  __GOVHUB_BOOTSTRAP__?: {
    apiBase?: string;
    apiContract?: Record<string, string>;
    [key: string]: unknown;
  };
}

interface ImportMetaEnv {
  readonly VITE_GOVHUB_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
