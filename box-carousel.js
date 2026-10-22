(()=>{
 const gallery=document.getElementById('box-gallery'),cards=[...document.querySelectorAll('.box-item')],viewer=document.getElementById('box-viewer'),photo=document.getElementById('box-front-image');
 if(!gallery||!cards.length||!viewer||!photo)return;
 const count=cards.length, reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 let position=0,last=0,dragStart=null,dragPosition=0,dragging=false,skipClick=false;
 const wrap=x=>((x%count)+count)%count;
 function render(){
  const spacing=Math.min(gallery.clientWidth*.255,215);
  cards.forEach((card,i)=>{
   let d=wrap(i-position);if(d>count/2)d-=count;
   const abs=Math.abs(d),visible=abs<2.85;
   card.style.transform=`translate3d(calc(-50% + ${d*spacing}px),${abs*10}px,0) scale(${Math.max(.53,1.19-abs*.24)})`;
   card.style.opacity=visible?String(Math.max(0,1-Math.max(0,abs-2.1)*1.4)):'0';
   card.style.zIndex=String(30-Math.round(abs*4));
   card.style.pointerEvents=visible?'auto':'none';
   card.tabIndex=visible?0:-1;
  });
 }
 function frame(t){if(!last)last=t;const dt=Math.min(65,t-last);last=t;
  if(!dragging&&!viewer.open&&!document.hidden&&!reduced.matches)position=wrap(position+dt/3700);
  render();requestAnimationFrame(frame);
 }
 cards.forEach((card,i)=>card.addEventListener('click',()=>{
  if(skipClick)return;
  if(Math.abs(wrap(i-position))>.45&&Math.abs(wrap(position-i))>.45){position=i;render();return;}
  const img=card.querySelector('img');photo.src=img.src;photo.alt=img.alt;viewer.showModal();
 }));
 document.getElementById('box-close')?.addEventListener('click',()=>viewer.close());
 viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.close()});
 gallery.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){position=wrap(position+(e.key==='ArrowRight'?1:-1));render();e.preventDefault()}});
 gallery.addEventListener('pointerdown',e=>{if(e.button!==0)return;dragStart=e.clientX;dragPosition=position;dragging=true;skipClick=false});
 gallery.addEventListener('pointermove',e=>{if(!dragging||dragStart===null)return;const delta=e.clientX-dragStart;if(Math.abs(delta)>8)skipClick=true;position=wrap(dragPosition-delta/Math.min(gallery.clientWidth*.255,215));render()});
 const end=()=>{dragging=false;dragStart=null;if(skipClick)setTimeout(()=>skipClick=false,120)};
 gallery.addEventListener('pointerup',end);gallery.addEventListener('pointercancel',end);
 requestAnimationFrame(frame);
})();
