declare module '*.css' {
  const css: string;
  export default css;
}

interface Window {
  /** Set once Kitsune has started in this document (the module can be evaluated more than once). */
  __kitsuneTv?: boolean;
  /** Development harness only (tv/tizen/dev): force a mode without being on anime.nexus. */
  __kitsuneDev?: { mode: 'ui' | 'player' | 'login'; episode?: { id: string; slug: string } };
  ReactNativeWebView?: { postMessage(data: string): void };
  __kitsuneCmd?: (cmd: string, arg?: number) => void;
  __kitsuneRan?: number;
  tizen?: { application?: { getCurrentApplication(): { exit(): void } } };
}
