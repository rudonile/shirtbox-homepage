param([string]$Dir)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class Vorlage {
  static float L(byte[] p,int i){ return (p[i]+p[i+1]+p[i+2])/3f; }
  public static string Build(string src, string dst) {
    var bmp = new Bitmap(src); int W=bmp.Width, H=bmp.Height;
    var d = bmp.LockBits(new Rectangle(0,0,W,H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    int st=d.Stride; var px=new byte[st*H]; Marshal.Copy(d.Scan0,px,0,px.Length); bmp.UnlockBits(d); bmp.Dispose();
    // Hintergrund pro Grobzelle (nur dunkle Pixel), LÃ¼cken aus Nachbarn auffÃ¼llen
    int G=32; int gx=(W+G-1)/G, gy=(H+G-1)/G; var bs=new double[gx*gy*3]; var bn=new int[gx*gy];
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){ int i=y*st+x*3; if(L(px,i)<140){ int c=(y/G)*gx+x/G; bs[c*3]+=px[i];bs[c*3+1]+=px[i+1];bs[c*3+2]+=px[i+2];bn[c]++; } }
    var bg=new double[gx*gy*3]; var ok=new bool[gx*gy];
    for(int c=0;c<gx*gy;c++) if(bn[c]>G*G/8){ ok[c]=true; for(int k=0;k<3;k++) bg[c*3+k]=bs[c*3+k]/bn[c]; }
    for(int it=0;it<200;it++){ bool any=false; var nok=(bool[])ok.Clone();
      for(int cy=0;cy<gy;cy++) for(int cx=0;cx<gx;cx++){ int c=cy*gx+cx; if(ok[c]) continue; double r=0,g=0,b=0; int n=0;
        for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ int xx=cx+dx,yy=cy+dy; if(xx<0||yy<0||xx>=gx||yy>=gy) continue; int e=yy*gx+xx; if(!ok[e]) continue; r+=bg[e*3];g+=bg[e*3+1];b+=bg[e*3+2];n++; }
        if(n>0){ bg[c*3]=r/n;bg[c*3+1]=g/n;bg[c*3+2]=b/n; nok[c]=true; } else any=true; }
      ok=nok; if(!any) break; }
    Func<int,int,int,double> B=(x,y,k)=>{ double fx=Math.Max(0,Math.Min(gx-1.001,(x+.5)/G-.5)), fy=Math.Max(0,Math.Min(gy-1.001,(y+.5)/G-.5)); int x0=(int)fx,y0=(int)fy; double ax=fx-x0, ay=fy-y0;
      return (bg[(y0*gx+x0)*3+k]*(1-ax)+bg[(y0*gx+x0+1)*3+k]*ax)*(1-ay)+(bg[((y0+1)*gx+x0)*3+k]*(1-ax)+bg[((y0+1)*gx+x0+1)*3+k]*ax)*ay; };
    // Weiche Alpha-Maske aus Helligkeit Ã¼ber lokalem Hintergrund, Farbe entmischen (keine hellen/dunklen SÃ¤ume)
    var A=new float[W*H]; var F=new float[W*H*3];
    for(int y=0;y<H;y++) for(int x=0;x<W;x++){ int i=y*st+x*3; double lb=(B(x,y,0)+B(x,y,1)+B(x,y,2))/3; double a=(L(px,i)-lb-14)/56.0; a=Math.Max(0,Math.Min(1,a)); A[y*W+x]=(float)a;
      for(int k=0;k<3;k++){ double c=px[i+k]; double f=a>0.04?(c-(1-a)*B(x,y,k))/a:c; F[(y*W+x)*3+k]=(float)Math.Max(0,Math.Min(255,f)); } }
    // Trennlinie pro Zeile: dort, wo zwischen den inneren Ã„rmeln am wenigsten Stoff ist (nicht starr in der Bildmitte)
    // Geschlossene Innenflaechen (z. B. Schatten im Kragen) bleiben Stoff: nur vom Bildrand erreichbare Flaechen sind Hintergrund
    { var outside=new bool[W*H]; var q=new System.Collections.Generic.Stack<int>();
      Action<int> push=i=>{ if(!outside[i]&&A[i]<0.5f){ outside[i]=true; q.Push(i);} };
      for(int x=0;x<W;x++){ push(x); push((H-1)*W+x); } for(int y=0;y<H;y++){ push(y*W); push(y*W+W-1); }
      while(q.Count>0){ int i=q.Pop(), x=i%W; if(x>0)push(i-1); if(x<W-1)push(i+1); if(i>=W)push(i-W); if(i<W*(H-1))push(i+W); }
      for(int i=0;i<W*H;i++) if(!outside[i]&&A[i]<1f){ bool nearOut=false; int x=i%W,y=i/W; for(int dy=-2;dy<=2&&!nearOut;dy++) for(int dx=-2;dx<=2;dx++){ int xx=x+dx,yy=y+dy; if(xx>=0&&yy>=0&&xx<W&&yy<H&&outside[yy*W+xx]){nearOut=true;break;} }
        if(!nearOut){ A[i]=1f; int j=y*st+x*3; for(int k=0;k<3;k++) F[i*3+k]=px[j+k]; } } }
    // Trennlinie pro Zeile in der Luecke; wo sich die Aermel beruehren, Linie der naechsten Zeile mit echter Luecke
    var cut=new int[H]; var real=new bool[H];
    for(int y=0;y<H;y++){ int best=W/2; double bv=1e9; for(int x=W/2-40;x<=W/2+40;x++){ double v=0; for(int k=-2;k<=2;k++) v+=A[y*W+x+k]; v+=Math.Abs(x-W/2)*0.001; if(v<bv){bv=v;best=x;} } cut[y]=best; real[y]=bv<0.6; }
    { var c2=(int[])cut.Clone(); for(int y=0;y<H;y++){ if(real[y]) continue; for(int dd=1;dd<H;dd++){ if(y-dd>=0&&real[y-dd]){c2[y]=cut[y-dd];break;} if(y+dd<H&&real[y+dd]){c2[y]=cut[y+dd];break;} } } cut=c2; }
    Func<int,int,int> side=(x,y)=> x<cut[y]?0:1;
    // Pro Seite nur das groesste zusammenhaengende Shirt behalten (keine Splitter des Nachbarshirts)
    { var lab=new int[W*H]; var sizes=new System.Collections.Generic.List<int>{0}; var sideOf=new System.Collections.Generic.List<int>{-1}; var st2=new System.Collections.Generic.Stack<int>();
      for(int s0=0;s0<W*H;s0++){ if(A[s0]<=0.35f||lab[s0]!=0) continue; int id=sizes.Count, h=side(s0%W,s0/W), n=0; lab[s0]=id; st2.Push(s0);
        while(st2.Count>0){ int i=st2.Pop(), x=i%W, y=i/W; n++; int[] nb={x>0?i-1:-1, x<W-1?i+1:-1, i-W, i+W}; foreach(int j in nb){ if(j<0||j>=W*H||lab[j]!=0||A[j]<=0.35f||side(j%W,j/W)!=h) continue; lab[j]=id; st2.Push(j);} }
        sizes.Add(n); sideOf.Add(h); }
      int[] big={0,0}; for(int id=1;id<sizes.Count;id++){ int h=sideOf[id]; if(big[h]==0||sizes[id]>sizes[big[h]]) big[h]=id; }
      var keep=new bool[W*H]; for(int i=0;i<W*H;i++){ if(lab[i]==0) continue; if(lab[i]!=big[sideOf[lab[i]]]) continue; int x=i%W,y=i/W; for(int dy=-2;dy<=2;dy++) for(int dx=-2;dx<=2;dx++){ int xx=x+dx,yy=y+dy; if(xx>=0&&yy>=0&&xx<W&&yy<H&&side(xx,yy)==sideOf[lab[i]]) keep[yy*W+xx]=true; } }
      for(int i=0;i<W*H;i++) if(!keep[i]) A[i]=0; }
    // Duenne Auslaeufer (Reste der frueheren Beruehrungsstelle) entfernen: Oeffnung (Erosion + Dilatation) je Seite, r=4
    { int r=4; var M=new bool[W*H]; for(int y=0;y<H;y++) for(int x=0;x<W;x++) M[y*W+x]=A[y*W+x]>0.35f;
      var E=new bool[W*H]; for(int y=r;y<H-r;y++) for(int x=r;x<W-r;x++){ if(!M[y*W+x]) continue; int h=side(x,y); bool all=true; for(int dy=-r;dy<=r&&all;dy++) for(int dx=-r;dx<=r;dx++){ if(dx*dx+dy*dy>r*r) continue; int xx=x+dx,yy=y+dy; if(!M[yy*W+xx]||side(xx,yy)!=h){all=false;break;} } E[y*W+x]=all; }
      int R2=r+1; var O=new bool[W*H]; for(int y=0;y<H;y++) for(int x=0;x<W;x++){ if(!E[y*W+x]) continue; for(int dy=-R2;dy<=R2;dy++) for(int dx=-R2;dx<=R2;dx++){ if(dx*dx+dy*dy>R2*R2) continue; int xx=x+dx,yy=y+dy; if(xx<0||yy<0||xx>=W||yy>=H) continue; O[yy*W+xx]=true; } }
      for(int i=0;i<W*H;i++) if(!O[i]) A[i]=0; }
    // Begrenzungsrahmen je HÃ¤lfte
    int[] bx0={W,W}, bx1={-1,-1}, by0={H,H}, by1={-1,-1};
    for(int y=0;y<H;y++) for(int x=0;x<W;x++) if(A[y*W+x]>0.5f){ int h=side(x,y); bx0[h]=Math.Min(bx0[h],x); bx1[h]=Math.Max(bx1[h],x); by0[h]=Math.Min(by0[h],y); by1[h]=Math.Max(by1[h],y); }
    int OW=1536, OH=1024; double gap=96, smar=72, vmar=78; double wmax=(OW-2*smar-gap)/2, hmax=OH-2*vmar;
    double sw=Math.Max(bx1[0]-bx0[0], bx1[1]-bx0[1])+1, sh=Math.Max(by1[0],by1[1])-Math.Min(by0[0],by0[1])+1;
    double s=Math.Min(1, Math.Min(wmax/sw, hmax/sh));
    double top=(OH-sh*s)/2 - Math.Min(by0[0],by0[1])*s;
    // Hintergrund: gleichmÃ¤ssiges Neutralgrau mit dezenter Aufhellung zur Mitte
    var o=new byte[OW*OH*3];
    for(int y=0;y<OH;y++) for(int x=0;x<OW;x++){ double dx=(x-OW/2.0)/(OW/2.0), dy=(y-OH/2.0)/(OH/2.0); double v=116-10*Math.Min(1,(dx*dx+dy*dy)/2); int i=(y*OW+x)*3; o[i]=o[i+1]=o[i+2]=(byte)Math.Round(v); }
    for(int h=0;h<2;h++){
      double w=(bx1[h]-bx0[h]+1)*s; double left = h==0 ? OW/2.0-gap/2-w : OW/2.0+gap/2; double ox=left-bx0[h]*s;
      int X0=(int)Math.Floor(left)-2, X1=(int)Math.Ceiling(left+w)+2, Y0=Math.Max(0,(int)Math.Floor(top+Math.Min(by0[0],by0[1])*s)-2), Y1=Math.Min(OH-1,(int)Math.Ceiling(top+Math.Max(by1[0],by1[1])*s)+2);
      for(int y=Y0;y<=Y1;y++) for(int x=Math.Max(0,X0);x<=Math.Min(OW-1,X1);x++){
        // Supersampling 3x3 aus der Quelle (nur diese HÃ¤lfte)
        double ar=0,fr=0,fg=0,fb=0; for(int sy=0;sy<3;sy++) for(int sx=0;sx<3;sx++){ double u=(x+(sx+.5)/3-ox)/s, v=(y+(sy+.5)/3-top)/s; int ui=(int)u, vi=(int)v; if(ui<0||vi<0||ui>=W||vi>=H) continue; if(side(ui,vi)!=h) continue; int j=vi*W+ui; double a=A[j]; ar+=a; fr+=F[j*3]*a; fg+=F[j*3+1]*a; fb+=F[j*3+2]*a; }
        if(ar<=0) continue; double al=ar/9; int i=(y*OW+x)*3; double[] f={fr/ar,fg/ar,fb/ar}; for(int k=0;k<3;k++) o[i+k]=(byte)Math.Round(f[k]*al+o[i+k]*(1-al)); }
    }
    var ob=new Bitmap(OW,OH,PixelFormat.Format24bppRgb); var od=ob.LockBits(new Rectangle(0,0,OW,OH),ImageLockMode.WriteOnly,PixelFormat.Format24bppRgb);
    for(int y=0;y<OH;y++) Marshal.Copy(o,y*OW*3,od.Scan0+y*od.Stride,OW*3); ob.UnlockBits(od);
    var enc=Array.Find(ImageCodecInfo.GetImageEncoders(),e=>e.MimeType=="image/jpeg"); var ep=new EncoderParameters(1); ep.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,95L);
    ob.Save(dst,enc,ep); ob.Dispose();
    return String.Format("Skalierung {0:F3}, Shirtbreite {1:F0}px, Shirthoehe {2:F0}px", s, sw*s, sh*s);
  }
}
'@
foreach($n in 'polo','zip','tshirt','oversize'){ "$n : " + [Vorlage]::Build("$Dir\$n-api-vorlage.jpg","$Dir\$n-vorlage-3x2.jpg") }

