// Transfer der Shirt-Entwuerfe vom KI-Designer zur Bestellung (IndexedDB).
(() => {
  function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('shirtbox-design-transfer',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('designs'))r.result.createObjectStore('designs');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function transaction(mode,operation){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('designs',mode);const request=operation(tx.objectStore('designs'));tx.oncomplete=()=>{const result=request?.result;db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};});}
  window.ShirtboxDesignTransfer={save:blobs=>transaction('readwrite',s=>s.put({blobs:Array.isArray(blobs)?blobs:[blobs],savedAt:Date.now()},'latest')),load:()=>transaction('readonly',s=>s.get('latest')),clear:()=>transaction('readwrite',s=>s.delete('latest'))};
  const form=document.getElementById('bestellung');if(!form)return;
  function note(text,error=false){const el=document.getElementById('design-transfer-status');if(!el)return;el.textContent=text;el.hidden=false;el.style.color=error?'#b91c1c':'#166534';el.style.fontWeight='700';}
  (async()=>{
    try{
      const saved=await window.ShirtboxDesignTransfer.load();
      if(!saved){note('Noch kein Shirt in der Bestellung. Bitte im KI-Designer Ihr Shirt auswählen und auf „Ausgewählte Shirts bestellen“ klicken.',true);return;}
      const blobs=saved.blobs||[saved.blob];
      if(!blobs.length||blobs.length>100)throw Error('Ungültige Anzahl Designs');
      let count=0;
      for(let i=0;i<blobs.length;i++){
        const item=blobs[i];const blob=item?.blob||item;
        if(!(blob instanceof Blob)||!blob.size)throw Error('Design '+(i+1)+' enthält kein Bild.');
        const added=window.ShirtboxOrderDesigns.add();const input=added?.file;
        if(!input)throw Error('Das Bestellformular konnte kein Designfeld erstellen.');
        const number=item.number||i+1;
        const file=new File([blob],`shirtbox-design-${number}.jpg`,{type:'image/jpeg'});
        const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
        input.dispatchEvent(new Event('change',{bubbles:true}));
        window.ShirtboxOrderDesigns.attachOriginals(input,item.originals||[],item.placement||'');
        window.ShirtboxOrderDesigns.restoreDetails?.(input,number);
        count++;
      }
      note('');
      document.getElementById('design-list')?.scrollIntoView({block:'start',behavior:'smooth'});
    }catch(error){console.error('ShirtBOX Design-Übernahme:',error);note('Das Shirt konnte nicht übernommen werden: '+(error?.message||'Unbekannter Fehler')+'. Bitte im KI-Designer erneut auf „Ausgewählte Shirts bestellen“ klicken.',true);}
  })();
})();
