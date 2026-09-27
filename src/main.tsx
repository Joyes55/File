import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

registerSW({
  immediate: true,
  onNeedReload() {
    // Avoid automatic page reload loops inside preview iframe
  },
  onRegisterError() {
    // Gracefully ignore restricted iframe service worker errors
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
