import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { store } from './store';
import './index.css';
import { registerServiceWorker } from './registerSW';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}><BrowserRouter><ToastProvider><App /></ToastProvider></BrowserRouter></Provider>
  </React.StrictMode>,
);

registerServiceWorker();
