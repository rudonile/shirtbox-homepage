// Transfer der Shirt-Entwuerfe vom KI-Designer zur Bestellung (IndexedDB).
//
// Bilder werden NICHT als Blob gespeichert, sondern als reine Bytes (ArrayBuffer + Bildtyp).
// Grund: Safari auf iPhone/iPad liefert in IndexedDB gespeicherte Blobs nach dem Seitenwechsel teils leer
// (0 Byte) zurück oder kann sie im privaten Modus gar nicht speichern – Folge war „Design 1 enthält kein Bild“.
// ArrayBuffer funktioniert in allen Browsern zuverlässig. Nach außen liefert load() weiterhin Blobs/Files,
// alle bestehenden Aufrufer (Gestalter, Bestellformular, Danke-Seite, Bildgenerator) bleiben unverändert.
// Ältere Einträge im Blob-Format werden weiterhin gelesen.
(() => {
  // Fehlt der Speicherbereich (alte oder leere Datenbank), wird er mit einer höheren Version neu angelegt.
  function database(version){return new Promise((resolve,reject)=>{const r=version?indexedDB.open('shirtbox-design-transfer',version):indexedDB.open('shirtbox-design-transfer');r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('designs'))r.result.createObjectStore('designs');};r.onsuccess=()=>{const db=r.result;if(db.objectStoreNames.contains('designs'))return resolve(db);const next=db.version+1;db.close();database(next).then(resolve,reject);};r.onerror=()=>reject(r.error);});}
  async function transaction(mode,operation){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('designs',mode);const request=operation(tx.objectStore('designs'));tx.oncomplete=()=>{const result=request?.result;db.close();resolve(result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error);};});}

  const bytes=blob=>typeof blob.arrayBuffer==='function'?blob.arrayBuffer():new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsArrayBuffer(blob);});
  const plain=v=>v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype;
  // Blob -> {__sbBlob, data, type, name}; Arrays und einfache Objekte werden rekursiv umgewandelt.
  async function pack(v){
    if(v instanceof Blob)return {__sbBlob:1,data:await bytes(v),type:v.type||'',name:typeof v.name==='string'?v.name:''};
    if(Array.isArray(v))return Promise.all(v.map(pack));
    if(plain(v)){const o={};for(const k of Object.keys(v))o[k]=await pack(v[k]);return o;}
    return v;
  }
  function unpack(v){
    if(v&&v.__sbBlob){const type=v.type||'image/png';if(v.name&&typeof File==='function'){try{return new File([v.data],v.name,{type});}catch{}}return new Blob([v.data],{type});}
    if(Array.isArray(v))return v.map(unpack);
    if(plain(v)){const o={};for(const k of Object.keys(v))o[k]=unpack(v[k]);return o;}
    return v;
  }
  const mainBlob=item=>item?.blob||item;
  // Ein Design ohne Bilddaten (z. B. alter, kaputter Eintrag aus früheren Versuchen) ist unbrauchbar.
  const usable=item=>{const b=mainBlob(item);return b instanceof Blob&&b.size>0;};
  const rawSize=item=>{const b=item?.blob||item;return b?.__sbBlob?(b.data?.byteLength||0):(b instanceof Blob?b.size:0);};

  async function save(blobs){
    const list=(Array.isArray(blobs)?blobs:[blobs]).filter(usable);
    if(!list.length)throw Error('Kein Design mit Bilddaten zum Speichern.');
    const packed=await pack(list);
    await transaction('readwrite',s=>s.put({blobs:packed,savedAt:Date.now(),format:2},'latest'));
    // Kontrolle: Erst wenn alle Bilder vollständig wieder lesbar sind, gilt das Speichern als gelungen.
    const back=await transaction('readonly',s=>s.get('latest'));
    const stored=back?.blobs||[];
    if(stored.length!==list.length||stored.some((item,i)=>rawSize(item)!==mainBlob(list[i]).size))throw Error('Die Bilddaten wurden nicht vollständig gespeichert.');
  }
  async function load(){
    const saved=await transaction('readonly',s=>s.get('latest'));
    if(!saved)return saved;
    const out=unpack(saved);
    if(!out.blobs&&out.blob)out.blobs=[out.blob];
    // Leere Altlasten (0 Byte) gar nicht erst herausgeben: Sie würden sonst als „Design 1“ jede Bestellung blockieren
    // und die Nummerierung neuer Shirts verschieben. Wie viele es waren, steht in dropped.
    const all=out.blobs||[];
    out.blobs=all.filter(usable);out.dropped=all.length-out.blobs.length;
    if(!out.blobs.length)return undefined;
    return out;
  }
  window.ShirtboxDesignTransfer={save,load,clear:()=>transaction('readwrite',s=>s.delete('latest'))};

  const form=document.getElementById('bestellung');if(!form)return;
  function note(text,error=false){const el=document.getElementById('design-transfer-status');if(!el)return;el.textContent=text;el.hidden=!text;el.style.color=error?'#b91c1c':'#166534';el.style.fontWeight='700';}
  (async()=>{
    try{
      const raw=await transaction('readonly',s=>s.get('latest'));
      const saved=await load();
      // Nur kaputte Einträge gespeichert: aufräumen, damit der nächste Versuch sauber beginnt.
      if(raw&&!saved){try{await window.ShirtboxDesignTransfer.clear();}catch{}window.ShirtboxRefreshOrderLink?.();note('Ihr zuvor gespeichertes Shirt war beschädigt und wurde entfernt. Bitte im Shirt-Gestalter erneut auf „T-Shirt zur Bestellung“ klicken – das Shirt wird jetzt zuverlässig übernommen.',true);return;}
      if(!saved){note('Noch kein Shirt in der Bestellung. Bitte im Shirt-Gestalter Ihr Shirt auswählen und auf „T-Shirt zur Bestellung“ klicken.',true);return;}
      const blobs=saved.blobs;
      if(blobs.length>100)throw Error('Ungültige Anzahl Designs');
      // Leere Altlasten dauerhaft entfernen (im neuen, sicheren Format speichern).
      if(saved.dropped){try{await save(blobs);}catch(e){console.error(e);}}
      for(let i=0;i<blobs.length;i++){
        const item=blobs[i];const blob=mainBlob(item);
        const added=window.ShirtboxOrderDesigns.add();const input=added?.file;
        if(!input)throw Error('Das Bestellformular konnte kein Designfeld erstellen.');
        const number=item.number||i+1;
        const png=blob.type==='image/png';
        const file=new File([blob],`shirtbox-design-${number}.${png?'png':'jpg'}`,{type:png?'image/png':'image/jpeg'});
        const transfer=typeof DataTransfer==='function' ? new DataTransfer() : null;
        if(!transfer)throw Error('Dieser Browser unterstützt die automatische Dateiübernahme nicht. Bitte aktualisieren Sie Safari oder wählen Sie das Design direkt als Datei aus.');
        transfer.items.add(file);input.files=transfer.files;
        if(!input.files || !input.files.length)throw Error('Die Dateiübernahme wurde vom Browser blockiert.');
        input.dispatchEvent(new Event('change',{bubbles:true}));
        window.ShirtboxOrderDesigns.attachOriginals(input,item.originals||[],item.placement||'');
        window.ShirtboxOrderDesigns.attachSidePrints(input,item.sidePrints||null,!!item.uploadOnly);
        window.ShirtboxOrderDesigns.restoreDetails?.(input,number);
      }
      note(saved.dropped?'Ein früher fehlerhaft gespeichertes Design wurde entfernt. Ihre übrigen Shirts sind in der Bestellung.':'');
      document.getElementById('design-list')?.scrollIntoView({block:'start',behavior:'smooth'});
    }catch(error){console.error('ShirtBOX Design-Übernahme:',error);note('Das Shirt konnte nicht übernommen werden: '+(error?.message||'Unbekannter Fehler')+'. Bitte im Shirt-Gestalter erneut auf „T-Shirt zur Bestellung“ klicken.',true);}
  })();
})();
