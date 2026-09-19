import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';

export const makeStore = () => configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: (gdm) => gdm().concat(api.middleware) });
export const store = makeStore();
setupListeners(store.dispatch); // refetchOnFocus/Reconnect → also refreshes expiring presigned image URLs
