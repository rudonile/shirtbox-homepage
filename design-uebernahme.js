// Transfer der Shirt-Entwuerfe vom KI-Designer zur Bestellung (IndexedDB).
(() => {
  // Fehlt der Speicherbereich (alte oder leere Datenbank), wird er mit einer höheren Version neu angelegt.
  function database(version){return new Promise((resolve,reject)=>{const r=version?indexedDB.open('shirtbox-design-transfer',version):indexedDB.open('shirtbox-design-transfer');r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('designs'))r.result.createObjectStore('designs');};r.onsuccess=()=>{const db=r.result;if(db.objectStoreNames.contains('designs'))return resolve(db);const next=db.version+1;db.close();database(next).then(resolve,reject);};r.onerror=()=>reject(r.error);});}
  async function transaction(mode,operation){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('designs',mode);const request=operation(tx.objectStore('designs'));tx.oncomplete=()=>{const result=request?.result;db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};});}

  // Bilder werden NICHT als Blob in der Datenbank abgelegt, sondern als reine Daten (ArrayBuffer + Typ), und beim Laden
  // jedes Mal als frische Blobs im Arbeitsspeicher neu erzeugt.
  // Grund: Safari (iPhone/iPad) macht Blobs, die aus IndexedDB gelesen wurden, ungültig, sobald derselbe Eintrag neu
  // gespeichert wird (zweites Öffnen der Bestellung, Design löschen, "mit KI weiterbearbeiten"). Dann zeigten Bestellung
  // und Designer nur noch Fragezeichen statt Bilder.
  async function pack(value){
    if(value instanceof Blob)return {sbBlob:1,type:value.type,data:await value.arrayBuffer()};
    if(Array.isArray(value))return Promise.all(value.map(pack));
    if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=await pack(v);return out;}
    return value;
  }
  // Ältere Einträge (noch als Blob gespeichert) werden ebenfalls in frische Kopien umgewandelt.
  // Lässt sich ein Bild nicht mehr lesen, wird es zu null – die übrigen Designs bleiben trotzdem erhalten.
  async function unpack(value){
    try{
      if(value instanceof Blob){const data=await value.arrayBuffer();return data.byteLength?new Blob([data],{type:value.type}):null;}
      if(value&&value.sbBlob===1)return value.data&&value.data.byteLength?new Blob([value.data],{type:value.type}):null;
    }catch{return null;}
    if(Array.isArray(value))return Promise.all(value.map(unpack));
    if(value&&typeof value==='object'){const out={};for(const [k,v] of Object.entries(value))out[k]=await unpack(v);return out;}
    return value;
  }
  window.ShirtboxDesignTransfer={
    save:async blobs=>{const packed=await pack(Array.isArray(blobs)?blobs:[blobs]);return transaction('readwrite',s=>s.put({blobs:packed,savedAt:Date.now(),format:2},'latest'));},
    load:async()=>{const saved=await transaction('readonly',s=>s.get('latest'));if(!saved)return saved;const list=saved.blobs||(saved.blob?[saved.blob]:[]);return {...saved,blobs:await unpack(list)};},
    clear:()=>transaction('readwrite',s=>s.delete('latest'))
  };

  const form=document.getElementById('bestellung');if(!form)return;
  function note(text,error=false){const el=document.getElementById('design-transfer-status');if(!el)return;el.textContent=text;el.hidden=!text;el.style.color=error?'#b91c1c':'#166534';el.style.fontWeight='700';}
  (async()=>{
    try{
      const saved=await window.ShirtboxDesignTransfer.load();
      if(!saved||!saved.blobs?.length){note('Noch kein Shirt in der Bestellung. Bitte im Shirt-Gestalter dein Shirt auswählen und auf „T-Shirt zur Bestellung“ klicken.',true);return;}
      const blobs=saved.blobs;
      if(blobs.length>100)throw Error('Ungültige Anzahl Designs');
      if(typeof DataTransfer!=='function')throw Error('Dieser Browser unterstützt die automatische Dateiübernahme nicht. Bitte aktualisiere Safari');
      // Jedes Design einzeln übernehmen: Ein defektes Bild blockiert die anderen nicht mehr (früher fehlten dann alle folgenden).
      const broken=[];
      for(let i=0;i<blobs.length;i++){
        const item=blobs[i];const blob=item?.blob||item;const number=item?.number||i+1;
        try{
          if(!(blob instanceof Blob)||!blob.size)throw Error('kein Bild');
          const added=window.ShirtboxOrderDesigns.add();const input=added?.file;
          if(!input)throw Error('Das Bestellformular konnte kein Designfeld erstellen.');
          const png=blob.type==='image/png';
          const file=new File([blob],`shirtbox-design-${number}.${png?'png':'jpg'}`,{type:png?'image/png':'image/jpeg'});
          const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
          if(!input.files||!input.files.length)throw Error('Die Dateiübernahme wurde vom Browser blockiert.');
          input.dispatchEvent(new Event('change',{bubbles:true}));
          window.ShirtboxOrderDesigns.attachOriginals(input,(item.originals||[]).filter(o=>o&&o.file instanceof Blob),item.placement||'');
          window.ShirtboxOrderDesigns.restoreDetails?.(input,number);
        }catch(error){console.error('ShirtBOX Design-Übernahme, Design '+number+':',error);broken.push(number);}
      }
      note(broken.length?`Design ${broken.join(', ')} konnte nicht geladen werden. Bitte im Shirt-Gestalter erneut auf „T-Shirt zur Bestellung“ klicken.`:'',!!broken.length);
      if(broken.length<blobs.length)document.getElementById('design-list')?.scrollIntoView({block:'start',behavior:'smooth'});
    }catch(error){console.error('ShirtBOX Design-Übernahme:',error);note('Das Shirt konnte nicht übernommen werden: '+(error?.message||'Unbekannter Fehler')+'. Bitte im Shirt-Gestalter erneut auf „T-Shirt zur Bestellung“ klicken.',true);}
  })();
})();
