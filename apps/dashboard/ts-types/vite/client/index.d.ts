/// <reference path="../../../../node_modules/vite/client.d.ts" />

// Ensure CSS modules resolve even if the Vite client reference path is unavailable.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {}
