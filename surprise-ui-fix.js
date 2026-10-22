document.addEventListener('DOMContentLoaded',()=>{
 const surprise=new URLSearchParams(location.search).has('surprise');
 const heading=document.querySelector('.wunschshirt-heading'),prompt=document.getElementById('ai-design-prompt'),form=document.getElementById('ai-design-form');
 if(!surprise||!prompt||!form)return;
 const hide=()=>{if(!form.classList.contains('sb-editing')){heading?.setAttribute('hidden','');prompt.setAttribute('hidden','');document.querySelector('.ai-design-buttons')?.setAttribute('hidden','');document.querySelector('.ai-photo-dropdown')?.setAttribute('hidden','');}};
 hide();
 document.getElementById('sb-edit-design')?.addEventListener('click',()=>{heading?.removeAttribute('hidden');prompt.removeAttribute('hidden');document.querySelector('.ai-design-buttons')?.removeAttribute('hidden');document.querySelector('.ai-photo-dropdown')?.removeAttribute('hidden');});
 document.getElementById('surprise-with')?.addEventListener('click',()=>{hide();});
 const observer=new MutationObserver(()=>{if(form.classList.contains('sb-editing')){heading?.removeAttribute('hidden');prompt.removeAttribute('hidden');document.querySelector('.ai-design-buttons')?.removeAttribute('hidden');document.querySelector('.ai-photo-dropdown')?.removeAttribute('hidden');}});
 observer.observe(form,{attributes:true,attributeFilter:['class']});
});
