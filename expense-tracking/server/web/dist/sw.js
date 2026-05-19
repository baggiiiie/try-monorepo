const CACHE='expenses-pwa-v1';
const SHELL=['/','/index.html','/styles.css','/app.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))))});
async function networkFirst(req,timeout=3000){const c=await caches.open(CACHE);let timer;try{const res=await Promise.race([fetch(req),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error('timeout')),timeout)})]);clearTimeout(timer);if(req.method==='GET'&&res.ok)c.put(req,res.clone());return res}catch(e){clearTimeout(timer);const hit=await c.match(req);if(hit)return hit;throw e}}
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin)return;if(e.request.mode==='navigate'){e.respondWith(networkFirst(e.request).catch(()=>caches.match('/index.html')));return}if(u.pathname.startsWith('/api/')&&e.request.method==='GET'){e.respondWith(networkFirst(e.request));return}if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});
