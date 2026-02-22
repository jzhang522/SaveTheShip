import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  plugins: [
    {
      name: 'rewrite-game-to-index',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/game' || req.url === '/game/' || req.url.startsWith('/game?')) {
            req.url = req.url.replace(/^\/game/, '') || '/';
          }
          next();
        });
      }
    }
  ],
  build: {
    target: 'esnext',
    minify: 'terser'
  }
})
