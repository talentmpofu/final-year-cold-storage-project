// Service Worker for Cold Storage PWA
// Enables offline functionality and caching

const CACHE_NAME = "cold-storage-v3";
const OFFLINE_URL = "/offline.html";

// Files to cache for offline use
const STATIC_CACHE_URLS = [
  "/",
  "/index.html",
  "/login.html",
  "/assets/css/styles.css",
  "/assets/js/app.js",
  "/manifest.json",
  OFFLINE_URL,
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
  console.log("🔧 Service Worker installing...");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("📦 Caching static assets");
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("✅ Service Worker activated");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("🗑️ Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Network-first strategy for API calls
  if (request.url.includes("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone response and cache it
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cache if offline
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline page for navigation requests
            if (request.mode === "navigate") {
              return caches.match(OFFLINE_URL);
            }
          });
        })
    );
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((response) => {
          // Don't cache non-successful responses
          if (
            !response ||
            response.status !== 200 ||
            response.type === "error"
          ) {
            return response;
          }

          // Clone and cache the response
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });

          return response;
        })
        .catch(() => {
          // Return offline page for navigation requests
          if (request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
        });
    })
  );
});

// Push notification event
self.addEventListener("push", (event) => {
  console.log("🔔 Push notification received");

  const options = {
    body: event.data ? event.data.text() : "Cold Storage Alert",
    icon: "/assets/img/icon-192.png",
    badge: "/assets/img/icon-192.png",
    vibrate: [200, 100, 200],
    tag: "cold-storage-notification",
    requireInteraction: true,
    actions: [
      {
        action: "view",
        title: "View Dashboard",
      },
      {
        action: "dismiss",
        title: "Dismiss",
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification("Cold Storage Alert", options)
  );
});

// Notification click event
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "view") {
    event.waitUntil(clients.openWindow("/"));
  }
});

// Background sync event (for offline data)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-metrics") {
    console.log("🔄 Syncing offline metrics...");
    event.waitUntil(syncOfflineMetrics());
  }
});

// Sync offline metrics when back online
async function syncOfflineMetrics() {
  // Placeholder for syncing cached data when back online
  console.log("📡 Connection restored, syncing data...");
}

// Periodic background sync (if supported)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "update-metrics") {
    event.waitUntil(updateMetricsInBackground());
  }
});

async function updateMetricsInBackground() {
  try {
    const response = await fetch("/api/metrics");
    const data = await response.json();
    console.log("🔄 Background metrics updated:", data);
  } catch (error) {
    console.error("❌ Background sync failed:", error);
  }
}
