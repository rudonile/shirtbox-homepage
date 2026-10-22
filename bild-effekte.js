// Shared pixel effects for the preview. Original uploaded files remain unchanged.
(() => {
  'use strict';
  const defaults={opacity:100,fade:0,brightness:100,contrast:100,saturation:100,flipX:false,flipY:false,removeWhite:false,blend:false};
  function process(data,width,height,settings={}) {
    const s={...defaults,...settings},count=width*height;
    if(s.removeWhite){
      // Remove only near-white pixels connected to an outer image edge.
      const seen=new Uint8Array(count),queue=new Int32Array(count);let head=0,tail=0;
      const white=p=>{const i=p*4,min=Math.min(data[i],data[i+1],data[i+2]),max=Math.max(data[i],data[i+1],data[i+2]);return data[i+3]===0||(min>=230&&max-min<=20);};
      const visit=p=>{if(!seen[p]&&white(p)){seen[p]=1;queue[tail++]=p;}};
      for(let x=0;x<width;x++){visit(x);visit((height-1)*width+x);}for(let y=0;y<height;y++){visit(y*width);visit(y*width+width-1);}
      while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);if(x)visit(p-1);if(x+1<width)visit(p+1);if(y)visit(p-width);if(y+1<height)visit(p+width);data[p*4+3]=0;}
    }
    const edge=Math.min(width,height)*Math.max(0,s.fade)/200;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4,lum=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
      for(let c=0;c<3;c++){let v=lum+(data[i+c]-lum)*s.saturation/100;v=(v-128)*s.contrast/100+128;data[i+c]=Math.max(0,Math.min(255,v*s.brightness/100));}
      let alpha=s.opacity/100;
      if(edge>0){const distance=Math.min(x,y,width-1-x,height-1-y),t=Math.max(0,Math.min(1,distance/edge));alpha*=t*t*(3-2*t);}
      data[i+3]=Math.round(data[i+3]*alpha);
    }
    return data;
  }
  window.ShirtboxImageEffects={defaults,process};
})();
