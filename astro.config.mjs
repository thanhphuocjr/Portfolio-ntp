import { resolve } from 'node:path';
import { defineConfig } from 'astro/config';

/** Reloads the browser whenever noi-dung.txt or anything inside media/ changes. */
const reloadOnContentChange = {
  name: 'reload-on-content-change',
  configureServer(server) {
    const content = resolve('noi-dung.txt');
    const mediaDir = resolve('media');
    server.watcher.add([content, mediaDir]);
    const reload = (file) => {
      if (file !== content && !file.startsWith(mediaDir)) return;
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: 'full-reload' });
    };
    server.watcher.on('change', reload);
    server.watcher.on('add', reload);
    server.watcher.on('unlink', reload);
  },
};

export default defineConfig({
  devToolbar: { enabled: false },
  vite: {
    plugins: [reloadOnContentChange],
    // Pre-bundled up front, so the very first page load never hits a mid-load re-optimise.
    optimizeDeps: { include: ['gsap', 'gsap/ScrollTrigger', 'gsap/SplitText', 'lenis'] },
  },
});
