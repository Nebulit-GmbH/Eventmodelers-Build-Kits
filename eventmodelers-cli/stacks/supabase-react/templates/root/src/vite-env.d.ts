/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_BASE: string;
  readonly VITE_DATA_MODE?: 'mock' | 'supabase';
  readonly VITE_MOCK_SAMPLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
