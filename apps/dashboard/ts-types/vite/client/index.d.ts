declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {}

interface ImportMetaEnv {
  readonly [key: string]: string | undefined;
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: {
    readonly accept: (cb?: (mod: unknown) => void) => void;
    readonly dispose: (cb: () => void) => void;
    readonly invalidate: () => void;
  };
}
