import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  // Detects if the build is running on GitHub Actions
  const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

  return {
    // Uses subfolder for GitHub, root for Netlify and local development
    base: isGitHubPages ? '/payment-reconciler/' : '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
