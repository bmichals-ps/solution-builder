/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMPOSIO_API_KEY: string;
  readonly VITE_PYPESTREAM_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
