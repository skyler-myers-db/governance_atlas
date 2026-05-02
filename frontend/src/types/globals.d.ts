interface Window {
  __GOVAT_BOOTSTRAP__?: {
    apiBase?: string;
    apiContract?: Record<string, string>;
    [key: string]: unknown;
  };
}

interface ImportMetaEnv {
  readonly VITE_GOVAT_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
