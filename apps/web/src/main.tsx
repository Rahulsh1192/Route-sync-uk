import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// ── PWA: service worker (production only — avoids breaking Vite HMR in dev) ──
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ── PWA: capture the install prompt so we can surface it in the UI later ──────
// The prompt is stored on window so any component can call window.__pwaInstall()
window.__pwaInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // prevent the default mini-infobar on Android
  window.__pwaInstall = async () => {
    (e as any).prompt();
    const { outcome } = await (e as any).userChoice;
    window.__pwaInstall = null; // clear after one use
    return outcome; // 'accepted' | 'dismissed'
  };
  // Tell the app the install option is available (simple DOM event)
  window.dispatchEvent(new Event('pwa-installable'));
});

window.addEventListener('appinstalled', () => {
  window.__pwaInstall = null;
});
