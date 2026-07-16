/// <reference types="vite/client" />

interface Window {
  /** Set by main.tsx when the browser fires beforeinstallprompt.
   *  Calling it triggers the native install prompt. Null when not available. */
  __pwaInstall: (() => Promise<'accepted' | 'dismissed'>) | null;
}
