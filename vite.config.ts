import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] },
});
