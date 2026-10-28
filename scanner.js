// On-device A4-style document scanning. No video frames leave the browser.
export function createScanner({onCapture,onError}) {
  const root=document.querySelector('#scanner'), video=document.querySelector('#scanVideo');
  const overlay=document.querySelector('#scanOverlay'), ctx=overlay.getContext('2d');
  const status=document.querySelector('#scanStatus'), meter=document.querySelector('#scanProgress');
  const thumb=document.querySelector('#scanThumb'), count=document.querySelector('#scanCount');
  const probe=document.createElement('canvas'), pctx=probe.getContext('2d',{willReadFrequently:true});
  let stream=null, running=false, raf=0, lastTick=0, stable=0, prior=null, candidate=null, armed=true, lost=0, shots=[], processing=false;
  const W=320;
  function message(t){status.textContent=t}
  function polygon(g,w,h){const fit=Math.min(w/video.videoWidth,h/video.videoHeight),iw=video.videoWidth*fit,ih=video.videoHeight*fit,ox=(w-iw)/2,oy=(h-ih)/2;ctx.lineWidth=4;ctx.strokeStyle=stable>=9?'#4df0b1':'#41cbd4';ctx.fillStyle='rgba(42,222,204,.11)';ctx.beginPath();g.forEach((p,i)=>i?ctx.lineTo(ox+p[0]*iw,oy+p[1]*ih):ctx.moveTo(ox+p[0]*iw,oy+p[1]*ih));ctx.closePath();ctx.fill();ctx.stroke();for(const [x,y] of g){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ox+x*iw,oy+y*ih,5,0,Math.PI*2);ctx.fill()}}
  function detect(){
    const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh)return null;
    const w=W,h=Math.round(W*vh/vw);probe.width=w;probe.height=h;pctx.drawImage(video,0,0,w,h);
    const pixels=pctx.getImageData(0,0,w,h).data,n=w*h;
    const lum=new Uint8Array(n),hist=new Uint32Array(256),edge=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let i=y*w+x,k=i*4,r=pixels[k],g=pixels[k+1],b=pixels[k+2];
      let l=Math.round(.299*r+.587*g+.114*b);lum[i]=l;hist[l]++;
      if(y<8||x<8||y>=h-8||x>=w-8)edge.push(l);
    }
    edge.sort((a,b)=>a-b);const bg=edge[Math.floor(edge.length*.5)];
    let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sumB=0,wB=0,max=0,otsu=150;
    for(let i=0;i<256;i++){wB+=hist[i];if(!wB)continue;let wF=n-wB;if(!wF)break;sumB+=i*hist[i];let diff=sumB/wB-(sum-sumB)/wF,variance=wB*wF*diff*diff;if(variance>max){max=variance;otsu=i}}
    const thresh=Math.max(115,Math.min(222,Math.max(otsu,bg+24)));
    const mask=new Uint8Array(n);
    for(let i=0;i<n;i++)mask[i]=lum[i]>thresh?1:0;
    // Connected component of bright pixels, with nearby gaps bridged by sampling 2px neighbors.
    const seen=new Uint8Array(n),queue=new Int32Array(n);let best=null;
    for(let sy=8;sy<h-8;sy+=3)for(let sx=8;sx<w-8;sx+=3){let start=sy*w+sx;if(!mask[start]||seen[start])continue;
      let head=0,tail=1;queue[0]=start;seen[start]=1;
      let minX=w,maxX=0,minY=h,maxY=0,tl=[w+h,0,0],tr=[-w-h,0,0],br=[-w-h,0,0],bl=[w+h,0,0];
      while(head<tail){let i=queue[head++],x=i%w,y=(i/w)|0;
        if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        let s=x+y,d=x-y;if(s<tl[0])tl=[s,x,y];if(s>br[0])br=[s,x,y];if(d>tr[0])tr=[d,x,y];if(d<bl[0])bl=[d,x,y];
        const neighbors=[i-1,i+1,i-w,i+w];for(const j of neighbors){if(j<0||j>=n||seen[j]||!mask[j]||Math.abs(j%w-x)>1)continue;seen[j]=1;queue[tail++]=j}
      }
      if(tail<n*.11||tail>n*.9)continue;
      const bw=maxX-minX,bh=maxY-minY;if(bw<w*.25||bh<h*.25||minX<=3||minY<=3||maxX>=w-4||maxY>=h-4)continue;
      const corners=[[tl[1],tl[2]],[tr[1],tr[2]],[br[1],br[2]],[bl[1],bl[2]]];
      const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      let top=dist(corners[0],corners[1]),bot=dist(corners[3],corners[2]),left=dist(corners[0],corners[3]),right=dist(corners[1],corners[2]);
      const aspect=(top+bot)/(left+right);if(aspect<.49||aspect>2.05)continue;
      const area=((top+bot)/2)*((left+right)/2),fill=tail/Math.max(1,area);if(fill<.48||fill>1.6)continue;
      let score=tail*(1-Math.min(.3,Math.abs(Math.log(aspect/0.707))*.12));
      if(!best||score>best.score)best={score,corners:corners.map(p=>[p[0]/w,p[1]/h])};
    }
    return best?.corners||null;
  }
  function jitter(a,b){if(!a||!b)return Infinity;return a.reduce((s,p,i)=>s+Math.hypot(p[0]-b[i][0],p[1]-b[i][1]),0)/4}
  function step(t){if(!running)return;raf=requestAnimationFrame(step);if(t-lastTick<105)return;lastTick=t;
    overlay.width=video.clientWidth*devicePixelRatio;overlay.height=video.clientHeight*devicePixelRatio;
    const g=detect();candidate=g;
    if(g){lost=0;polygon(g,overlay.width,overlay.height);stable=jitter(g,prior)<.018?Math.min(14,stable+1):Math.max(0,stable-3);prior=g;
      if(armed){meter.style.width=Math.min(100,stable/11*100)+'%';message(stable>=9?'已鎖定 A4 紙張，正在拍照…':'偵測到紙張，請保持手機穩定');if(stable>=11&&!processing)capture(true)}
      else{message('已拍攝！移開紙張再放下一張，或點「再次掃描」');meter.style.width='100%'}
    }else{stable=0;prior=null;lost++;if(!armed&&lost>=7){armed=true;meter.style.width='0%'}if(armed){message('請將完整 A4 紙張放入畫面，避免背景太亮');meter.style.width='0%'}}
  }
  // Warp quadrilateral to a rectangular page via homography (bilinear pixel interpolation).
  function rectify(corners){
    const src=document.createElement('canvas');src.width=video.videoWidth;src.height=video.videoHeight;const s=src.getContext('2d',{willReadFrequently:true});s.drawImage(video,0,0);
    if(!corners)return src;
    const p=corners.map(([x,y])=>[x*src.width,y*src.height]);
    const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);let pw=(distance(p[0],p[1])+distance(p[3],p[2]))/2,ph=(distance(p[0],p[3])+distance(p[1],p[2]))/2;
    const portrait=ph>=pw,ow=portrait?1050:1485,oh=portrait?1485:1050;
    const out=document.createElement('canvas');out.width=ow;out.height=oh;
    // Solve 8 coefficients mapping output unit square to source quadrilateral.
    const A=[],b=[];for(let k=0;k<4;k++){let u=[0,1,1,0][k],v=[0,0,1,1][k],x=p[k][0],y=p[k][1];A.push([u,v,1,0,0,0,-u*x,-v*x]);b.push(x);A.push([0,0,0,u,v,1,-u*y,-v*y]);b.push(y)}
    for(let j=0;j<8;j++){let pivot=j;for(let i=j+1;i<8;i++)if(Math.abs(A[i][j])>Math.abs(A[pivot][j]))pivot=i;[A[j],A[pivot]]=[A[pivot],A[j]];[b[j],b[pivot]]=[b[pivot],b[j]];let div=A[j][j];if(Math.abs(div)<1e-8)return src;for(let z=j;z<8;z++)A[j][z]/=div;b[j]/=div;for(let i=0;i<8;i++){if(i===j)continue;let fac=A[i][j];for(let z=j;z<8;z++)A[i][z]-=fac*A[j][z];b[i]-=fac*b[j]}}
    const img=s.getImageData(0,0,src.width,src.height),dst=out.getContext('2d'),outImg=dst.createImageData(ow,oh),srcD=img.data,outD=outImg.data,sw=src.width,sh=src.height;
    for(let y=0;y<oh;y++){let v=y/(oh-1);for(let x=0;x<ow;x++){let u=x/(ow-1),den=b[6]*u+b[7]*v+1,sx=(b[0]*u+b[1]*v+b[2])/den,sy=(b[3]*u+b[4]*v+b[5])/den,ix=Math.max(0,Math.min(sw-1,Math.round(sx))),iy=Math.max(0,Math.min(sh-1,Math.round(sy))),si=(iy*sw+ix)*4,di=(y*ow+x)*4;outD[di]=srcD[si];outD[di+1]=srcD[si+1];outD[di+2]=srcD[si+2];outD[di+3]=255}}
    dst.putImageData(outImg,0,0);return out;
  }
  async function capture(auto=false){if(processing||!running||(!armed&&auto))return;processing=true;armed=false;try{
    const canvas=rectify(candidate);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.88));if(!blob)throw Error('無法產生圖片');shots.push(blob);
    const url=URL.createObjectURL(blob);if(thumb.dataset.url)URL.revokeObjectURL(thumb.dataset.url);thumb.dataset.url=url;thumb.src=url;thumb.hidden=false;count.textContent=`已掃描 ${shots.length} 頁`;
    navigator.vibrate?.(90);onCapture?.(blob,shots.length);message(auto?'已自動拍照！移開紙張掃描下一頁':'已拍照！移開紙張掃描下一頁');
  }catch(e){armed=true;onError?.(e)}finally{stable=0;processing=false}}
  async function start(){if(running)return;root.classList.remove('hidden');shots=[];armed=true;stable=0;lost=0;prior=null;thumb.hidden=true;count.textContent='已掃描 0 頁';meter.style.width='0%';message('正在啟動相機…');try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('請使用 HTTPS 網址或 localhost 開啟，才能使用即時相機');
    stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});video.srcObject=stream;await video.play();running=true;raf=requestAnimationFrame(step);
  }catch(e){stop();onError?.(e);message('無法啟動相機：'+e.message)}}
  function stop(){running=false;cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(x=>x.stop());stream=null;video.pause();video.srcObject=null;root.classList.add('hidden')}
  return {start,stop,capture:()=>capture(false),rearm(){armed=true;stable=0;prior=null;meter.style.width='0%';message('請保持紙張完整入鏡')},getShots:()=>shots.slice(),isRunning:()=>running};
}
