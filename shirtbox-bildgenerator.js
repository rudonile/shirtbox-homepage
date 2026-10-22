(() => {
  const form=document.getElementById('ai-design-form');if(!form)return;
  const base='https://black-snow-2fdf.r-n.workers.dev';
  const uploadOnly=form.dataset.uploadOnly==='true';
  const prompt=document.getElementById('ai-design-prompt'),status=document.getElementById('ai-design-status'),picture=document.getElementById('ai-design-image');
  const create=document.getElementById('ai-create'),reset=document.getElementById('ai-reset'),download=document.getElementById('ai-download'),order=document.getElementById('ai-order'),actions=document.getElementById('ai-result-actions'),add=document.getElementById('ai-add-design'),slots=document.getElementById('ai-design-slots'),selection=document.getElementById('ai-selection'),selectionTotal=document.getElementById('ai-selection-total'),newDesignActions=document.getElementById('ai-new-design-actions');
  const designs=[{blob:null,url:'',prompt:'',selected:false}];let active=0,busy=false,saving=false;let editingOrder=false;
  const editor=window.ShirtboxUpload;
  const current=()=>designs[active];const isDictating=()=>form.dataset.dictating==='true';
  function message(text){status.textContent=text;}
  // After generating or updating a design, place the finished shirt in the visible centre.
  function centreShirtResult(){
    const preview=picture.closest('.ai-design-preview')||picture;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const rect=preview.getBoundingClientRect();
      const header=document.querySelector('.masthead');
      const headerHeight=header?header.getBoundingClientRect().height:0;
      const visibleHeight=Math.max(100,window.innerHeight-headerHeight);
      const desiredTop=headerHeight+Math.max(8,(visibleHeight-Math.min(rect.height,visibleHeight))/2);
      const destination=Math.max(0,window.scrollY+rect.top-desiredTop);
      window.scrollTo({top:destination,behavior:'smooth'});
    }));
  }

  function finished(){return designs.filter(d=>d.blob);}
  function chosen(){const ready=finished();return ready.length===1?ready:(ready.some(d=>d.selected)?ready.filter(d=>d.selected):ready);}
  function selectionSummary(){const ready=finished(),count=chosen().length;selection.hidden=!ready.length;selectionTotal.textContent=count?`${count} Shirt${count===1?'':'s'} ausgewählt · ${window.ShirtboxOrder.money(window.ShirtboxOrder.totalForQuantity(count))} inklusive Mehrwertsteuer und Versand. Grössen und Stückzahlen wählen Sie im nächsten Schritt (maximal fünf Shirts insgesamt).`:'Bitte mindestens ein Design für die Bestellung ankreuzen.';order.textContent=ready.length===1?'Dieses Shirt bestellen ↗':'Ausgewählte Shirts bestellen ↗';}
  function controls(){
    if(busy){create.replaceChildren();const icon=document.createElement('span');icon.className='ai-hourglass';icon.setAttribute('aria-hidden','true');icon.textContent='⏳';create.append(icon,document.createTextNode('Generierung des Shirts ist im Gange'));}else create.textContent=current().blob?'Zusätzlichen Text oben eingeben und weiter generieren ↗':'Jetzt Shirt generieren';
    const locked=busy||saving||isDictating()||form.dataset.uploadDirty==='true';create.disabled=locked;reset.disabled=busy||saving||isDictating()||(!current().blob&&!prompt.value.trim()&&!current().uploads?.length&&form.dataset.uploadDirty!=='true');order.disabled=locked||!chosen().length;newDesignActions.hidden=!current().blob;add.disabled=locked||designs.length>=5||!current().blob;add.textContent=designs.length>=5?'Fünf Designs angelegt':'+ Ein weiteres Design erstellen';prompt.disabled=busy||saving;
    const speech=document.getElementById('ai-speech');if(speech)speech.disabled=busy||saving||speech.dataset.unsupported==='true';form.setAttribute('aria-busy',String(busy));editor?.lock(busy||saving||isDictating());slots.querySelectorAll('button, input').forEach(el=>el.disabled=locked);
  }
  function render(){
    const d=current();picture.src=d.url||'anleitung/polo-api-vorlage.jpg';picture.alt=d.blob?`Design ${active+1}: Vorderseite und Rückseite`:'Weisse Polo-Vorlage mit Vorderseite und Rückseite';prompt.value=d.prompt;slots.replaceChildren();
    designs.forEach((item,i)=>{
      if(!item.blob)return;
      const card=document.createElement('div');card.className='ai-design-card';
      const button=document.createElement('button');button.type='button';button.setAttribute('aria-pressed',String(i===active));button.setAttribute('aria-label',`Design ${i+1} ansehen`);
      const img=document.createElement('img');img.src=item.url;img.alt=`Vorschau Design ${i+1}`;button.append(img,document.createTextNode(`Design ${i+1} ansehen`));
      button.addEventListener('click',()=>{if(busy||saving||isDictating())return;current().prompt=prompt.value;active=i;render();message(uploadOnly?`Design ${i+1} wird angezeigt. Passen Sie Ihre Bilder an und übernehmen Sie die Bildgestaltung.`:`Design ${i+1} wird angezeigt. Für Änderungen beschreiben Sie den Wunsch und klicken Sie auf „Zusätzlichen Text oben eingeben und weiter generieren“.`);});card.append(button);
      if(finished().length>1){const label=document.createElement('label');label.className='ai-order-choice';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=item.selected;checkbox.setAttribute('aria-label',`Design ${i+1} bestellen`);checkbox.addEventListener('change',()=>{item.selected=checkbox.checked;selectionSummary();controls();});label.append(checkbox,document.createTextNode(`Design ${i+1} bestellen`));card.append(label);}
      slots.append(card);
    });editor?.bind(current());if(frontPhoto)frontPhoto.value='';if(backPhoto)backPhoto.value='';if(current().frontFile||current().backFile)refreshPhotoPreview();selectionSummary();controls();
  }
  form.addEventListener('dictationchange',controls);
  editor?.connect({changed:controls,commit:async blob=>{const d=current();if(d.url)URL.revokeObjectURL(d.url);d.blob=blob;d.url=URL.createObjectURL(blob);d.prompt=prompt.value;render();message('Ihre Bilder wurden übernommen. Wählen Sie unten Ihr Design für die Bestellung. ');}});
  reset.addEventListener('click',()=>{const d=current();if(d.url)URL.revokeObjectURL(d.url);d.url='';d.blob=null;d.prompt='';d.selected=false;d.uploads=[];d.frontFile=null;d.backFile=null;if(d.previewUrl)URL.revokeObjectURL(d.previewUrl);d.previewUrl='';d.printOriginals=[];d.uploadBase='';d.uploadBaseBlob=null;d.shirtColour='#ffffff';editor?.clear();render();message(uploadOnly?'Laden Sie eigene Bilder für Ihr Shirt hoch.':'Beschreiben Sie Ihr Wunschshirt. ');});
  add.addEventListener('click',()=>{if(busy||saving||isDictating()||designs.length>=5||!current().blob)return;current().prompt=prompt.value;designs.push({blob:null,url:'',prompt:'',selected:false});active=designs.length-1;render();message(uploadOnly?`Laden Sie Ihre Bilder für Design ${active+1} hoch. Ihre bisherigen Entwürfe bleiben erhalten.`:`Beschreiben Sie Design ${active+1}. Ihre bisherigen Entwürfe bleiben erhalten.`);if(uploadOnly)editor?.focus();else prompt.focus();});
  const frontPhoto=document.getElementById('ai-photo-front'),backPhoto=document.getElementById('ai-photo-back');
  const previewBase='anleitung/polo-api-vorlage.jpg';
  async function refreshPhotoPreview(){
    if(uploadOnly)return;
    const d=current();
    const front=frontPhoto?.files[0]||d.frontFile,back=backPhoto?.files[0]||d.backFile;
    if(!front&&!back){picture.src=d.url||previewBase;return;}
    const notice=document.getElementById('ai-photo-status');
    try{
      const response=await fetch(d.url||previewBase);
      if(!response.ok)throw Error('Vorschau konnte nicht geladen werden.');
      const baseImage=await createImageBitmap(await response.blob());
      const canvas=document.createElement('canvas');canvas.width=baseImage.width;canvas.height=baseImage.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(baseImage,0,0);baseImage.close();
      for(const [file,side] of [[front,0],[back,1]]){
        if(!file)continue;
        const photo=await photoLayer(file);const half=canvas.width/2;
        const scale=Math.min(half*.48/photo.width,canvas.height*.40/photo.height);
        const dw=photo.width*scale,dh=photo.height*scale;
        ctx.drawImage(photo,side*half+(half-dw)/2,canvas.height*.36,dw,dh);photo.close();
      }
      if(d.previewUrl)URL.revokeObjectURL(d.previewUrl);
      d.previewUrl=URL.createObjectURL(await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9)));
      picture.src=d.previewUrl;
      if(notice)notice.textContent='Ihr Foto ist jetzt auf dem Polo sichtbar. Beschreiben Sie die gewünschten KI-Änderungen und klicken Sie auf „Jetzt Shirt generieren“. ';
    }catch(error){if(notice)notice.textContent=error.message;}
  }
  for(const [input,key] of [[frontPhoto,'frontFile'],[backPhoto,'backFile']])input?.addEventListener('change',()=>{current()[key]=input.files[0]||null;if(!window.shirtboxSurprisePhoto)refreshPhotoPreview();controls();});
  async function photoLayer(file){
    if(!file)return null;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Bitte PNG, JPG oder WebP mit höchstens 5 MB pro Foto verwenden.');
    return createImageBitmap(file);
  }
  async function composePhotoReference(baseBlob){
    const front=await photoLayer(frontPhoto?.files[0]||current().frontFile),back=await photoLayer(backPhoto?.files[0]||current().backFile);
    if(!front&&!back)return baseBlob;
    const baseImage=await createImageBitmap(baseBlob);
    const canvas=document.createElement('canvas');canvas.width=baseImage.width;canvas.height=baseImage.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(baseImage,0,0);
    for(const [photo,side] of [[front,0],[back,1]]){
      if(!photo)continue;
      const half=canvas.width/2,maxW=half*.48,maxH=canvas.height*.40;
      const scale=Math.min(maxW/photo.width,maxH/photo.height);
      const dw=photo.width*scale,dh=photo.height*scale;
      ctx.drawImage(photo,side*half+(half-dw)/2,canvas.height*.36, dw,dh);
      photo.close();
    }
    baseImage.close();
    return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Foto konnte nicht verarbeitet werden.')),'image/jpeg',.9));
  }
  async function generate(mode){
    if(uploadOnly||busy||saving||isDictating()||form.dataset.uploadDirty==='true'||!form.reportValidity()||(mode==='edit'&&!current().blob))return;
    current().prompt=prompt.value;busy=true;controls();status.replaceChildren();const hourglass=document.createElement('span');hourglass.className='ai-hourglass';hourglass.setAttribute('aria-hidden','true');hourglass.textContent='⏳';status.append(hourglass,document.createTextNode('Generierung des Shirts ist im Gange. Das kann bis zu drei Minuten dauern …'));centreShirtResult();
    const body=new FormData();body.set('prompt',prompt.value.trim());if(window.shirtboxSurprisePhoto){window.shirtboxSurprisePhoto=false;picture.scrollIntoView({behavior:'smooth',block:'center'});}
    const hasPhotos=!!(frontPhoto?.files.length||backPhoto?.files.length||current().frontFile||current().backFile);
    let reference=current().blob;
    if(hasPhotos){
      try{if(!reference){const res=await fetch('anleitung/polo-api-vorlage.jpg');if(!res.ok)throw Error('Polo-Vorlage nicht erreichbar.');reference=await res.blob();}reference=await composePhotoReference(reference);}
      catch(error){busy=false;controls();message(error.message);return;}
    }
    const requestMode=reference?'edit':mode;
    body.set('mode',requestMode);if(reference)body.set('image',reference,'shirtbox-mit-fotos.jpg');
    try{
      const response=await fetch(`${base}/generate`,{method:'POST',body,signal:AbortSignal.timeout(195000)});const result=await response.json();
      if(!response.ok)throw Error(result.error||'Die Bildgestaltung ist momentan nicht verfügbar.');
      const b64=result.data?.[0]?.b64_json;if(typeof b64!=='string'||!b64)throw Error('Es wurde kein Bild zurückgegeben.');
      const binary=atob(b64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const d=current();if(d.url)URL.revokeObjectURL(d.url);d.printOriginals=[...(d.printOriginals||[]),...(d.uploads||[])];d.uploads=[];d.uploadBase='';d.uploadBaseBlob=null;editor?.clear();if(frontPhoto)frontPhoto.value='';if(backPhoto)backPhoto.value='';d.frontFile=null;d.backFile=null;if(d.previewUrl)URL.revokeObjectURL(d.previewUrl);d.previewUrl='';d.blob=new Blob([bytes],{type:'image/jpeg'});d.url=URL.createObjectURL(d.blob);render();message(`Design ${active+1} ist bereit. Erstellen Sie bei Bedarf ein weiteres Design und wählen Sie unten aus, welche Designs Sie bestellen möchten.`);centreShirtResult();
    }catch(error){message(['TimeoutError','AbortError'].includes(error.name)?'Die Anfrage dauert zu lange. Bitte später erneut versuchen. ':error.message==='Failed to fetch'?'Die Bildgestaltung ist noch nicht erreichbar. Bitte versuchen Sie es später erneut.':error.message);}
    finally{busy=false;controls();}
  }
  form.addEventListener('submit',event=>{event.preventDefault();generate(current().blob?'edit':'new');});
  prompt.addEventListener('input',controls);
  order.addEventListener('click',async()=>{if(busy||saving)return;const blobs=(editingOrder?finished():chosen()).map(d=>({blob:d.blob,number:d.number||designs.indexOf(d)+1,prompt:d.prompt,originals:[...(d.printOriginals||[]),...(d.uploads||[])].map(l=>({file:l.file,region:l.region,x:l.x,y:l.y,width:l.width,angle:l.angle,effects:l.effects||{}})),placement:editor?.describe(d)||''}));if(!blobs.length)return;if(blobs.reduce((sum,d)=>sum+d.blob.size+d.originals.reduce((n,l)=>n+l.file.size,0),0)>9*1024*1024){message('Die ausgewählten Designs und Originalbilder sind zusammen grösser als 9 MB. Bitte kleinere Bilder verwenden oder weniger Designs auswählen.');return;}saving=true;controls();try{if(editingOrder){const old=await window.ShirtboxDesignTransfer.load();const previous=old?.blobs||[];for(const item of blobs){const position=previous.findIndex((entry,i)=>(entry.number||i+1)===item.number);if(position>=0)previous[position]=item;else previous.push(item);}await window.ShirtboxDesignTransfer.save(previous);}else{await window.ShirtboxDesignTransfer.save(blobs);}location.href='bestellen.html#bestellen';}catch{message('Ihre Entwürfe konnten nicht für die Bestellung gespeichert werden. Bitte erlauben Sie die Speicherung in diesem Browser und versuchen Sie es erneut.');saving=false;controls();}});
  async function restoreForEditing(){
    const number=new URLSearchParams(location.search).get('weiterbearbeiten');
    if(!number || uploadOnly || !window.ShirtboxDesignTransfer?.load)return false;
    try{
      const saved=await window.ShirtboxDesignTransfer.load();
      const items=saved?.blobs||[];
      const item=items.find((x,i)=>String(x.number||i+1)===number);
      if(!item)throw Error('Design nicht gefunden');
      const blob=item.blob||item;
      if(!(blob instanceof Blob))throw Error('Bild nicht verfügbar');
      editingOrder=true;designs.splice(0,designs.length,...items.map((entry,i)=>({blob:entry.blob||entry,url:URL.createObjectURL(entry.blob||entry),prompt:entry.prompt||'',selected:true,originals:entry.originals||[],number:entry.number||i+1})));active=items.indexOf(item);
      render();message('Ihr bestehendes Shirt wurde geladen. Geben Sie Ihre Änderung ein und klicken Sie auf „Generieren“.');
      return true;
    }catch(e){message('Das gespeicherte Design konnte nicht geladen werden. Bitte übernehmen Sie es erneut aus der Bestellung.');return false;}
  }
  render();restoreForEditing().then(loaded=>{if(!loaded && !new URLSearchParams(location.search).has('weiterbearbeiten'))message(uploadOnly?'Laden Sie Ihre Bilder hoch und wählen Sie die Platzierung.':'Beschreiben Sie Ihr Wunschshirt.');});
})();
