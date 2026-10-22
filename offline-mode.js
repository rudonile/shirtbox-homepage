/* Local testing only. Intercepts only the image generation endpoint in demo mode. */
(()=>{
 const KEY='shirtbox_offline_ai_mode';
 const panel=document.createElement('div');panel.style.cssText='position:fixed;bottom:12px;left:12px;z-index:2147483000;background:#14263a;color:white;padding:12px 15px;border:2px solid #f5c879;border-radius:12px;box-shadow:0 5px 22px #0007;font:14px Arial,sans-serif;max-width:300px';
 panel.innerHTML='<strong>ShirtBOX – OFFLINE-TEST</strong><br><label for="sb-test-mode">KI-Modus: </label><select id="sb-test-mode" style="margin:8px 0;padding:6px"><option value="demo">Testmodus (ohne KI)</option><option value="real">Echte KI (Internet)</option></select><div id="sb-test-info" style="font-size:12px;line-height:1.4"></div>';
 document.addEventListener('DOMContentLoaded',()=>{document.body.append(panel);const s=panel.querySelector('select');s.value=localStorage.getItem(KEY)==='real'?'real':'demo';const update=()=>{panel.querySelector('#sb-test-info').textContent=s.value==='demo'?'Es wird ein Beispiel-Shirt erzeugt, keine echte KI. Bestellungen nicht absenden.':'Verwendet den bestehenden Cloudflare-KI-Dienst. Internet, CORS-Freigabe und funktionierender Worker erforderlich.'};s.addEventListener('change',()=>{localStorage.setItem(KEY,s.value);update()});update()});
 const originalFetch=window.fetch.bind(window);
 window.fetch=async function(resource,options){
  const url=typeof resource==='string'?resource:resource?.url||'';
  if(!url.includes('black-snow-2fdf.r-n.workers.dev/generate')||localStorage.getItem(KEY)==='real')return originalFetch(resource,options);
  try{
   const form=options?.body;const supplied=form instanceof FormData?form.get('image'):null;
   const response=await originalFetch(supplied instanceof Blob?URL.createObjectURL(supplied):'anleitung/polo-api-vorlage.jpg');
   if(!response.ok)throw Error('Beispielbild nicht gefunden');
   const blob=await response.blob();const bitmap=await createImageBitmap(blob);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
   const data=canvas.toDataURL('image/jpeg',.85).split(',')[1];
   await new Promise(resolve=>setTimeout(resolve,650));
   return new Response(JSON.stringify({data:[{b64_json:data}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({error:'Offline-Testbild konnte nicht geladen werden: '+e.message}),{status:500,headers:{'Content-Type':'application/json'}})}
 };
})();
