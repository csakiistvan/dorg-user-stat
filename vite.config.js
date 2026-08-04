import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import devApi from './dev/api-plugin.js';

export default defineConfig({
  plugins: [react(), devApi()],
});
