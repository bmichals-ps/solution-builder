import type { Plugin } from 'vite'

/**
 * SPA Fallback Plugin
 * Serves index.html for all routes except API and assets (for client-side routing)
 */
export function spaFallbackPlugin(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Skip API routes, Supabase functions, and assets
        if (req.url?.startsWith('/api/') || 
            req.url?.startsWith('/functions/') ||  // Supabase edge function proxies
            req.url?.startsWith('/@') || 
            req.url?.startsWith('/node_modules/') ||
            req.url?.includes('.')) {
          return next();
        }
        // Serve index.html for all other routes (SPA routing)
        req.url = '/';
        next();
      });
    }
  }
}
