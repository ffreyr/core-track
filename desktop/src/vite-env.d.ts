/// <reference types="vite/client" />

/** Build-time environment variables exposed by Vite (must start with `VITE_`). */
interface ImportMetaEnv {
  /** Default backend address, e.g. `http://localhost:8000`. Overridable in Settings. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
