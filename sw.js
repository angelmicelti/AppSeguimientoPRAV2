// Service Worker - Gestión PRA-R
// Versión: 1.0.0

const CACHE_NAME = 'pra-r-cache-v5.1';

// Archivos esenciales para cachear en la instalación
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './favicon.ico',
    './icons/favicon-16x16.png',
    './icons/favicon-32x32.png',
    './icons/apple-touch-icon.png',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/safari-pinned-tab.svg'
];

// Dependencias externas a cachear (CDN)
const CDN_URLS = [
    'https://unpkg.com/tailwindcss-cdn@3.4.10/tailwindcss.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.29/jspdf.plugin.autotable.min.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js'
];

// --- EVENTO: INSTALL ---
// Precachea los archivos estáticos de la app
self.addEventListener('install', event => {
    console.log('[SW] Instalando Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Precacheando archivos estáticos...');
                // Cachear cada archivo individualmente (no falla si uno no existe)
                const localPromises = PRECACHE_URLS.map(url =>
                    fetch(url)
                        .then(response => {
                            if (response.ok) {
                                return cache.put(url, response);
                            } else {
                                console.warn('[SW] No se pudo cachear (status ' + response.status + '): ' + url);
                            }
                        })
                        .catch(err => console.warn('[SW] Error al cachear: ' + url, err.message))
                );
                return Promise.allSettled(localPromises).then(() => {
                    // Intentar cachear CDN (no fallar si alguno no está disponible)
                    return Promise.allSettled(
                        CDN_URLS.map(url =>
                            fetch(url, { mode: 'cors' })
                                .then(response => {
                                    if (response.ok) {
                                        return cache.put(url, response);
                                    }
                                })
                                .catch(() => console.log('[SW] No se pudo cachear CDN: ' + url))
                        )
                    );
                });
            })
            .then(() => console.log('[SW] Instalación completada.'))
            .catch(err => console.error('[SW] Error en instalación:', err))
    );
    // Activar inmediatamente sin esperar a que se cierre la ventana
    self.skipWaiting();
});

// --- EVENTO: ACTIVATE ---
// Limpia caches antiguas
self.addEventListener('activate', event => {
    console.log('[SW] Activando Service Worker...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => {
                            console.log('[SW] Eliminando cache antigua:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => {
                console.log('[SW] Activación completada.');
                // Tomar control de todas las pestañas abiertas inmediatamente
                return self.clients.claim();
            })
    );
});

// --- EVENTO: FETCH ---
// Estrategia: Network First con fallback a Cache
// Para Firebase: siempre network (datos dinámicos)
// Para assets estáticos: cache first
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // --- Firebase Realtime Database: SIEMPRE Network ---
    if (url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseapp.com')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Clonar y cachear respuestas exitosas de Firebase
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback offline: servir desde caché si existe
                    return caches.match(event.request);
                })
        );
        return;
    }

    // --- Recursos estáticos locales ---
    if (url.origin === self.location.origin) {
        var reqUrl = event.request ? event.request.url : '';
        // HTML y Service Worker: SIEMPRE desde la red (para actualizar la app)
        if (reqUrl.endsWith('.html') || 
            reqUrl.endsWith('.js') ||
            reqUrl.endsWith('.json') ||
            url.pathname === '/' ||
            url.pathname.endsWith('/')) {
            event.respondWith(
                fetch(event.request)
                    .then(response => {
                        if (response.ok) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, responseClone).catch(() => {});
                            });
                        }
                        return response;
                    })
                    .catch(() => caches.match(event.request))
            );
            return;
        }

        // Imágenes e iconos: Cache First
        event.respondWith(
            caches.match(event.request)
                .then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    return fetch(event.request)
                        .then(response => {
                            if (response.ok) {
                                const responseClone = response.clone();
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(event.request, responseClone).catch(() => {});
                                });
                            }
                            return response;
                        });
                })
        );
        return;
    }

    // --- CDN y otros recursos externos: Stale While Revalidate ---
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                const fetchPromise = fetch(event.request)
                    .then(networkResponse => {
                        // Actualizar caché con la nueva versión
                        if (networkResponse.ok) {
                            try {
                                const responseToCache = networkResponse.clone();
                                caches.open(CACHE_NAME).then(cache => {
                                    cache.put(event.request, responseToCache).catch(() => {});
                                });
                            } catch(e) {
                                // Si clone() falla (body ya consumido), ignorar silenciosamente
                            }
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // Si falla el network y no hay caché, devolver error
                        if (!cachedResponse) {
                            return new Response('Offline', { status: 503, statusText: 'Sin conexión' });
                        }
                        return cachedResponse;
                    });

                // Devolver caché inmediatamente si existe, sino esperar al network
                return cachedResponse || fetchPromise;
            })
    );
});

// --- EVENTO: MESSAGE ---
// Comunicación con la app principal
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() => {
            console.log('[SW] Caché borrada por solicitud del usuario.');
        });
    }
});
