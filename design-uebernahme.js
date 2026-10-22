// Store the selected JPEG designs locally for the order form.
(() => {
  function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('shirtbox-design-transfer',1);r.onupgradeneeded=()=>r.result.createObjectStore('designs');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function transaction(mode,operation){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('designs',mode);const request=operation(tx.objectStore('designs'));tx.oncomplete=()=>{const result=request?.result;db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};});}
  window.ShirtboxDesignTransfer={save:blobs=>transaction('readwrite',s=>s.put({blobs:Array.isArray(blobs)?blobs:[blobs],savedAt:Date.now()},'latest')),load:()=>transaction('readonly',s=>s.get('latest')),clear:()=>transaction('readwrite',s=>s.delete('latest'))};
  const form=document.getElementById('bestellung');if(!form)return;
  function note(text){const el=document.getElementById('design-transfer-status');el.textContent=text;el.hidden=false;}
  (async()=>{
    try{
      const saved=await transaction('readonly',s=>s.get('latest'));
      if(!saved){note('Bitte gestalten Sie zuerst Ihr Shirt und übernehmen Sie den Entwurf aus dem Shirt-Designer.');return;}
      
      const blobs=saved.blobs || [saved.blob];
      if(!blobs.length||blobs.length>5)throw Error('Ungültige Anzahl Designs');
      for (let i=0;i<Math.min(blobs.length,5);i++) {
        const input=window.ShirtboxOrderDesigns.add()?.file;
        if(!input)throw Error('Design fehlt');
        const item=blobs[i];const blob=item.blob||item;const number=item.number||i+1;
        const file=new File([blob],`shirtbox-design-${number}.jpg`,{type:blob.type||'image/jpeg'});
        const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
        if(input.files[0]?.name!==file.name)throw Error('Transfer unavailable');
        input.dispatchEvent(new Event('change',{bubbles:true}));
        window.ShirtboxOrderDesigns.attachOriginals(input,item.originals||[],item.placement||'');
        window.ShirtboxOrderDesigns.restoreDetails?.(input,number);
      }
      note(`${blobs.length} Design${blobs.length===1?'':'s'} automatisch übernommen. Bitte wählen Sie für jedes Design Grössen und Stückzahlen und bestätigen Sie die Bildrechte.`);
    }catch{note('Der Entwurf konnte nicht übernommen werden. Bitte öffnen Sie den Shirt-Designer und wählen Sie Ihre Designs unten aus und klicken Sie auf „Ausgewählte Shirts bestellen“.');}
  })();
})();
