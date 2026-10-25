const CACHE='iron-v19';
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html','./manifest.json','./icon-192.png'])));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  /* API do servidor próprio, envios (POST/PUT) e sites de outras origens vão direto pra rede, sem cache */
  if(e.request.method!=='GET'||u.pathname.indexOf('/api/')>=0||(u.origin!==self.location.origin&&!/cdnjs|fonts\./.test(u.href)))return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r})
      .catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
      if(res.ok&&(e.request.url.startsWith(self.location.origin)||e.request.url.includes('cdnjs')||e.request.url.includes('fonts.'))){
        const cl=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));
      }
      return res;
    }).catch(()=>e.request.mode==='navigate'?caches.match('./index.html'):Response.error()))
  );
});
