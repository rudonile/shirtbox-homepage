(() => {
  // Beim Öffnen oben beginnen, auch nach mobilen Wiederherstellungen.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const startAtTop = () => { if (location.hash) { const target = document.getElementById(location.hash.slice(1)); if (target) target.scrollIntoView({block:'start'}); } else window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); };
  window.addEventListener('pageshow', () => {
    startAtTop();
    window.requestAnimationFrame(startAtTop);
  });
  const help = document.getElementById('design-hilfe');
  if (!help) return;
  document.querySelectorAll('[data-open-help]').forEach(link => {
    link.addEventListener('click', () => { help.open = true; });
  });
})();

(() => {
  // Read the persistent order independently on every page, even if the
  // design-transfer module is not loaded on that particular page.
  async function hasSavedOrder(){
    if(window.ShirtboxDesignTransfer?.load){
      const saved=await window.ShirtboxDesignTransfer.load();
      return !!(saved?.blobs?.length || saved?.blob);
    }
    if(!window.indexedDB)return false;
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(!settled){settled=true;resolve(value);}};
      try{
        const request=indexedDB.open('shirtbox-design-transfer',1);
        request.onupgradeneeded=()=>{};
        request.onerror=()=>finish(false);
        request.onsuccess=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('designs')){db.close();finish(false);return;}
          const tx=db.transaction('designs','readonly');
          const get=tx.objectStore('designs').get('latest');
          get.onsuccess=()=>{const data=get.result;finish(!!(data?.blobs?.length||data?.blob));};
          get.onerror=()=>finish(false);
          tx.oncomplete=tx.onabort=()=>db.close();
        };
      }catch{finish(false);}
    });
  }
  let sequence=0;
  async function updateOrderLink(){
    const nav=document.querySelector('.masthead nav');if(!nav)return;
    const current=++sequence;
    let has=false;
    try{has=await hasSavedOrder();}catch{}
    if(current!==sequence)return;
    document.querySelectorAll('.mobile-order-shortcut').forEach(el=>{el.hidden=!has;el.setAttribute('aria-hidden',String(!has));});
    let link=nav.querySelector('.order-return-link');
    if(has&&!link){
      link=document.createElement('a');link.href='bestellen.html#bestellen';
      link.className='order-return-link';link.textContent='🛒 Zur Bestellung';
      nav.append(link);
    }
    if(!has&&link)link.remove();
  }
  window.ShirtboxRefreshOrderLink=updateOrderLink;
  window.addEventListener('pageshow',updateOrderLink);
  window.addEventListener('focus',updateOrderLink);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateOrderLink();});
  document.addEventListener('DOMContentLoaded',updateOrderLink);
  updateOrderLink();
})();
