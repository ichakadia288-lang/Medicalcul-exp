// sw.js — mode hors-ligne de MediCalcul Express
const CACHE = 'medicalcul-v3';
const CACHE_PARTAGE = 'partage'; // fichier reçu depuis une autre application
const FICHIERS = ['/', '/index.html', '/manifest.json', '/favicon.png', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/logo.png', '/assistant-icon.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE)
            .then((c) => Promise.allSettled(FICHIERS.map((f) => c.add(f))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((cles) => Promise.all(cles.filter((k) => k !== CACHE && k !== CACHE_PARTAGE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);

    // Réception d'un fichier partagé depuis une autre application (Android)
    if (req.method === 'POST' && url.pathname === '/share-target') {
        e.respondWith((async () => {
            try {
                const data = await req.formData();
                const f = data.get('fichier');
                const cache = await caches.open(CACHE_PARTAGE);
                await cache.delete('/fichier-partage');
                if (f && f.size) {
                    await cache.put('/fichier-partage', new Response(f, {
                        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nom': encodeURIComponent(f.name || 'fichier') }
                    }));
                }
                const texte = String(data.get('text') || data.get('title') || '').slice(0, 500);
                return Response.redirect('/?partage=1' + (texte ? '&t=' + encodeURIComponent(texte) : ''), 303);
            } catch (err) {
                return Response.redirect('/', 303);
            }
        })());
        return;
    }

    if (req.method !== 'GET') return;
    // L'assistant IA (/api/) et les autres sites ne sont jamais mis en cache
    if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

    // Pages : réseau d'abord (mises à jour immédiates), cache si hors-ligne
    if (req.mode === 'navigate') {
        e.respondWith(
            fetch(req)
                .then((r) => {
                    const copie = r.clone();
                    caches.open(CACHE).then((c) => c.put('/index.html', copie));
                    return r;
                })
                .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
        );
        return;
    }

    // Images, manifest, etc. : cache d'abord, mis à jour en arrière-plan
    e.respondWith(
        caches.match(req).then((cache) => {
            const reseau = fetch(req)
                .then((r) => {
                    if (r && r.status === 200) {
                        const copie = r.clone();
                        caches.open(CACHE).then((c) => c.put(req, copie));
                    }
                    return r;
                })
                .catch(() => cache);
            return cache || reseau;
        })
    );
});
