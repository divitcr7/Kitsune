declare module '*.css' {
  const css: string;
  export default css;
}

interface Window {
  /** Set once Kitsune has started in this document (the module can be evaluated more than once). */
  __kitsuneTv?: boolean;
  tizen?: { application?: { getCurrentApplication(): { exit(): void } } };
}
