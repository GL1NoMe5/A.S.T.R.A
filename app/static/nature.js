/* Decorative atmosphere, unrelated to measured/modelled weather. No network assets. */
(() => {
  'use strict';
  const MODES = new Set(['auto', 'wind', 'sun', 'rain', 'snow', 'off']);
  const STORAGE_KEY = 'astra:nature-mode';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const random = (lo, hi) => lo + Math.random() * (hi - lo);
  const resolveAtmosphere = (preferred, theme, reduced) => reduced || preferred === 'off' ? 'off' : preferred === 'auto' ? theme === 'christmas' ? 'snow' : theme === 'dark' ? 'lycoris' : 'wind' : preferred === 'wind' && theme === 'dark' ? 'lycoris' : preferred;

  // Active time only: hidden pages never accumulate flights to replay on return.
  function createFlightClock(interval = 120, duration = 5) {
    let elapsed = 0;
    return {
      reset() { elapsed = 0; },
      advance(seconds, active = true) {
        if (!active) return null;
        if (Number.isFinite(seconds) && seconds > 0) elapsed += seconds;
        if (elapsed < interval) return null;
        const phase = (elapsed - interval) % interval;
        return phase < duration ? phase / duration : null;
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createFlightClock, resolveAtmosphere};
  if (typeof document === 'undefined') return;

  function initNature() {
    if (document.getElementById('nature-atmosphere')) return;
    const select = document.getElementById('nature-mode');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function makeCanvas(id, className) {
      const c = document.createElement('canvas'); c.id = id; c.className = className;
      c.setAttribute('aria-hidden', 'true'); c.setAttribute('tabindex', '-1');
      document.body.prepend(c); return c;
    }
    const canvas = makeCanvas('nature-atmosphere', 'nature-canvas');
    const flightCanvas = makeCanvas('holiday-flight', 'holiday-flight');
    const ctx = canvas.getContext('2d', {alpha:true});
    const flightCtx = flightCanvas.getContext('2d', {alpha:true});
    if (!ctx || !flightCtx) {
      canvas.remove(); flightCanvas.remove();
      if (select) { select.value = 'off'; select.disabled = true; }
      return;
    }
    let preferredMode = 'auto';
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (MODES.has(stored)) preferredMode = stored;
      if (localStorage.getItem('astra:atmosphere-version') !== '2') {
        if (preferredMode !== 'off') preferredMode = 'auto';
        localStorage.setItem(STORAGE_KEY, preferredMode);
        localStorage.setItem('astra:atmosphere-version', '2');
      }
    } catch (_) {}
    let theme = document.documentElement.dataset.theme || 'forest';
    let dark = theme !== 'forest';
    let mode = 'off', width = 1, height = 1, particles = [], ripples = [];
    let frameId = 0, previousFrame = null, elapsed = 0, pageActive = true;
    let pointerX = -1000, pointerY = -1000, previousPointerX = null, windTarget = 0, wind = 0;
    const flightClock = createFlightClock();

    function makeParticle(initial = false) {
      if (mode === 'snow') return {x:random(-30,width+30), y:initial?random(-height,height):random(-60,-10), speed:random(12,31), size:random(1.1,3.2), phase:random(0,Math.PI*2), alpha:random(.3,.7)};
      if (mode === 'rain') return {x:random(-40,width+40), y:initial?random(-height,height):random(-80,-20), speed:random(180,280), size:random(9,19), alpha:random(.08,.16)};
      if (mode === 'sun') return {x:random(0,width),y:random(0,height),speed:random(3,8),size:random(.6,1.5),phase:random(0,Math.PI*2),alpha:random(.10,.25)};
      const flower = mode === 'lycoris';
      return {x:initial?random(-20,width):random(-90,-30),y:initial?random(50,height):random(65,height*.7),speed:flower?random(2,6):random(8,18),size:flower?random(15,24):random(5,10),phase:random(0,Math.PI*2),rotation:random(-.8,.8),alpha:flower?random(.34,.6):random(.14,.27),olive:Math.random()>.65};
    }
    function seedParticles() {
      const small = width < 640;
      const count = mode === 'snow' ? (small?24:46) : mode === 'rain' ? (small?24:42) : mode === 'lycoris' ? (small?4:8) : mode === 'sun' ? (small?8:15) : (small?9:16);
      particles = mode === 'off' ? [] : Array.from({length:count}, () => makeParticle(true)); ripples = [];
    }
    function resize() {
      width = Math.max(1,document.documentElement.clientWidth||window.innerWidth); height = Math.max(1,window.innerHeight);
      const ratio = Math.min(window.devicePixelRatio||1,1.5);
      for (const [c, context] of [[canvas,ctx],[flightCanvas,flightCtx]]) {
        c.width=Math.round(width*ratio);c.height=Math.round(height*ratio);context.setTransform(ratio,0,0,ratio,0,0);
      }
      seedParticles();
    }
    function drift(p,dt) {
      const dx=p.x-pointerX,dy=p.y-pointerY,distance=Math.hypot(dx,dy);
      const near=distance<150?(1-distance/150)*13:0;
      // A broad 14-second gust adds movement even when the pointer is still.
      const gust=Math.pow(Math.max(0,Math.sin(elapsed*.45)),6)*34;
      p.x+=(16+gust+wind*1.5+Math.sin(elapsed*.45+p.phase)*5+Math.sign(dx)*near)*dt;
      p.y+=(p.speed+Math.cos(elapsed*.6+p.phase)*4+Math.sign(dy)*near)*dt;
      p.rotation+=(Math.sin(elapsed*.5+p.phase)*.22+wind*.009+gust*.004)*dt;
      if(p.x>width+60||p.y>height+50||p.x< -130)Object.assign(p,makeParticle());
    }
    function drawLeaf(p,dt) {
      drift(p,dt);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation);
      ctx.scale(.5+Math.abs(Math.sin(elapsed*.45+p.phase))*.5,1);ctx.globalAlpha=p.alpha;
      ctx.fillStyle=p.olive?'#929361':'#52765b';ctx.beginPath();ctx.moveTo(0,-p.size);
      ctx.bezierCurveTo(p.size,-p.size*.6,p.size*.8,p.size*.8,0,p.size);
      ctx.bezierCurveTo(-p.size*.8,p.size*.5,-p.size*.8,-p.size*.7,0,-p.size);ctx.fill();
      ctx.strokeStyle='#35573e';ctx.lineWidth=.55;ctx.beginPath();ctx.moveTo(0,-p.size*.7);ctx.quadraticCurveTo(-1,0,0,p.size*1.2);ctx.stroke();ctx.restore();
    }
    function drawLycoris(p,dt) {
      drift(p,dt);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation);ctx.scale(p.size/22,p.size/22);ctx.globalAlpha=p.alpha;
      // A small umbel of recurved red flowers, each with long projecting stamens.
      ctx.strokeStyle='#9d3850';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(0,8);ctx.quadraticCurveTo(-2,18,2,30);ctx.stroke();
      for(let bloom=0;bloom<4;bloom++) {
        const angle=bloom*Math.PI/2+.25,cx=Math.cos(angle)*6,cy=Math.sin(angle)*5;
        ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);
        for(let petal=0;petal<6;petal++) {
          ctx.save();ctx.rotate(petal*Math.PI/3);
          ctx.fillStyle=petal%2?'#dc4b58':'#f16a65';ctx.beginPath();ctx.moveTo(0,1);
          ctx.bezierCurveTo(2,-5,9,-11,7,-14);ctx.bezierCurveTo(12,-11,7,-4,1,3);ctx.closePath();ctx.fill();
          ctx.strokeStyle='#f48880';ctx.lineWidth=.55;ctx.beginPath();ctx.moveTo(0,1);ctx.bezierCurveTo(-2,-5,-1,-15,5,-20);ctx.stroke();
          ctx.fillStyle='#f4b19c';ctx.beginPath();ctx.ellipse(5,-20,1.1,.55,-.5,0,Math.PI*2);ctx.fill();ctx.restore();
        }
        ctx.restore();
      }
      ctx.restore();
    }
    function drawCelestial(moon=false) {
      const small=width<640,x=width-(small?49:84),y=small?113:111,r=small?20:33;
      const halo=ctx.createRadialGradient(x,y,r*.3,x,y,r*4.5);
      halo.addColorStop(0,moon?'rgba(195,221,208,.11)':'rgba(237,196,92,.14)');halo.addColorStop(1,'rgba(230,213,152,0)');
      ctx.fillStyle=halo;ctx.fillRect(x-r*5,y-r*5,r*10,r*10);
      ctx.save();ctx.translate(x,y);
      if(moon) {
        ctx.fillStyle='#bbd3b7';ctx.globalAlpha=.31;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#4a715c';ctx.globalAlpha=.24;
        for(const [a,b,s] of [[-.3,-.25,.2],[.3,.1,.15],[-.1,.45,.12],[.25,-.48,.1]]){ctx.beginPath();ctx.arc(a*r,b*r,s*r,0,Math.PI*2);ctx.fill();}
      } else {
        ctx.rotate(elapsed*.015);ctx.strokeStyle='rgba(182,137,44,.20)';ctx.lineWidth=1.3;
        for(let i=0;i<12;i++){ctx.rotate(Math.PI/6);const pulse=1+Math.sin(elapsed*.7+i)*.07;ctx.beginPath();ctx.moveTo(0,r*1.25);ctx.lineTo(0,r*1.75*pulse);ctx.stroke();}
        ctx.fillStyle='rgba(219,173,59,.23)';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
    function drawSun(dt,particlesToo=false) {
      drawCelestial(false);
      const x=width*.87,y=-height*.1,radius=Math.max(width*.7,height);
      const glow=ctx.createRadialGradient(x,y,0,x,y,radius);glow.addColorStop(0,'rgba(222,184,89,.07)');glow.addColorStop(1,'rgba(234,210,141,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
      ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(elapsed*.06)*.025);ctx.fillStyle='rgba(214,178,93,.023)';
      for(let i=0;i<5;i++){const a=1.3+i*.18,l=Math.max(width,height)*1.8;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*l,Math.sin(a)*l);ctx.lineTo(Math.cos(a+.035)*l,Math.sin(a+.035)*l);ctx.closePath();ctx.fill();}ctx.restore();
      if(particlesToo)for(const p of particles){p.x+=(Math.sin(elapsed*.3+p.phase)*2+wind*.15)*dt;p.y-=p.speed*dt;if(p.y< -5){p.y=height+5;p.x=random(0,width);}ctx.fillStyle=`rgba(163,136,71,${p.alpha*(.65+Math.sin(elapsed*.7+p.phase)*.25)})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}
    }
    function drawWindLines() {
      ctx.strokeStyle=dark?'rgba(173,194,160,.045)':'rgba(92,129,74,.06)';ctx.lineWidth=.65;
      const gust=Math.pow(Math.max(0,Math.sin(elapsed*.45)),6);
      for(let i=0;i<3;i++){const x=((elapsed*50+i*width*.33)%(width+240))-200,y=height*(.26+i*.24);ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+35,y-8,x+70,y+8,x+100+gust*70,y);ctx.stroke();}
    }
    function drawRain(dt) {
      for(const p of particles){const drift=-15+wind*.6;p.x+=drift*dt;p.y+=p.speed*dt;if(p.y>height+10){if(ripples.length<6)ripples.push({x:clamp(p.x,0,width),y:height-random(4,28),age:0});Object.assign(p,makeParticle());}ctx.strokeStyle=`rgba(${dark?'160,199,196':'75,111,108'},${p.alpha})`;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+drift*.04,p.y+p.size);ctx.stroke();}
      ripples=ripples.filter(r=>r.age<1.2);for(const p of ripples){p.age+=dt;const r=2+p.age*14;ctx.strokeStyle=`rgba(115,154,148,${Math.max(0,.12*(1-p.age/1.2))})`;ctx.lineWidth=.6;ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.22,0,0,Math.PI*2);ctx.stroke();}
    }
    function drawSnow(dt) {
      for(const p of particles){p.x+=(Math.sin(elapsed*.45+p.phase)*9+wind*.6)*dt;p.y+=p.speed*dt;if(p.y>height+8||p.x< -45||p.x>width+45)Object.assign(p,makeParticle());ctx.fillStyle=dark?`rgba(231,243,235,${p.alpha})`:`rgba(107,143,150,${p.alpha*.6})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}
    }
    function drawDeer(c,x,y,phase,lead) {
      c.save();c.translate(x,y);c.fillStyle='#e8d4a4';c.strokeStyle='#e8d4a4';c.lineWidth=1.8;c.lineCap='round';
      c.beginPath();c.ellipse(0,0,11,4.4,0,0,Math.PI*2);c.fill();
      c.beginPath();c.moveTo(6,-1);c.lineTo(10,-11);c.lineTo(17,-12);c.lineTo(20,-8);c.lineTo(11,-6);c.closePath();c.fill();
      for(const leg of [-6,5]){const swing=Math.sin(phase+(leg<0?0:Math.PI))*4;c.beginPath();c.moveTo(leg,2);c.lineTo(leg+5+swing,8);c.lineTo(leg+9+swing,6);c.stroke();}
      c.beginPath();c.moveTo(-10,-1);c.lineTo(-15,-5);c.moveTo(11,-11);c.lineTo(10,-20);c.lineTo(7,-24);c.moveTo(10,-19);c.lineTo(14,-23);c.moveTo(10,-16);c.lineTo(5,-19);c.stroke();
      c.fillStyle=lead?'#e46d5f':'#513c2a';c.beginPath();c.arc(19,-9,1.6,0,Math.PI*2);c.fill();c.restore();
    }
    function drawFlight(progress) {
      if(progress===null){flightCanvas.hidden=true;flightCanvas.dataset.active='false';return;}
      flightCanvas.hidden=false;flightCanvas.dataset.active='true';
      const c=flightCtx,small=width<640,scale=small?.65:1;
      const x=-320*scale+progress*(width+640*scale),y=small?210:155;
      c.save();c.translate(x,y+Math.sin(progress*Math.PI*2)*12);c.scale(scale,scale);c.globalAlpha=.72;
      // Reins and four reindeer precede the sleigh. They are noninteractive art.
      c.strokeStyle='#c0b27c';c.lineWidth=.8;c.beginPath();c.moveTo(36,-9);c.bezierCurveTo(90,2,180,-15,245,-16);c.stroke();
      for(let i=0;i<4;i++)drawDeer(c,90+i*48,-8-i*2,elapsed*15+i,i===3);
      c.strokeStyle='#e6c77b';c.lineWidth=2.1;c.beginPath();c.moveTo(-25,15);c.quadraticCurveTo(20,20,48,12);c.quadraticCurveTo(57,6,50,2);c.moveTo(-14,9);c.lineTo(-10,16);c.moveTo(29,8);c.lineTo(32,16);c.stroke();
      c.fillStyle='#a84c43';c.beginPath();c.moveTo(-28,-6);c.quadraticCurveTo(-19,10,-4,10);c.lineTo(32,9);c.quadraticCurveTo(46,7,46,-8);c.lineTo(37,-5);c.lineTo(32,0);c.lineTo(-9,0);c.lineTo(-18,-10);c.closePath();c.fill();
      c.fillStyle='#957c48';c.beginPath();c.ellipse(-14,-14,13,14,-.3,0,Math.PI*2);c.fill();
      c.fillStyle='#bd4a42';c.beginPath();c.ellipse(15,-17,11,13,.15,0,Math.PI*2);c.fill();
      c.fillStyle='#f5ddbd';c.beginPath();c.arc(18,-31,6.8,0,Math.PI*2);c.fill();
      c.fillStyle='#f4efdf';c.beginPath();c.moveTo(12,-31);c.quadraticCurveTo(8,-20,20,-21);c.quadraticCurveTo(25,-26,23,-31);c.closePath();c.fill();
      c.fillStyle='#bf4c43';c.beginPath();c.moveTo(11,-35);c.quadraticCurveTo(16,-48,30,-37);c.lineTo(20,-35);c.closePath();c.fill();c.fillStyle='#f5efdf';c.beginPath();c.arc(29,-37,3,0,Math.PI*2);c.fill();c.fillRect(10,-36,15,2.5);
      c.strokeStyle='#d56f55';c.lineWidth=5;c.beginPath();c.moveTo(19,-20);c.lineTo(31,-14);c.lineTo(37,-19);c.stroke();
      c.restore();
    }
    function updateTitle() {
      if(!select)return;const tr=window.AstraI18n?.t;
      select.title=reducedMotion.matches?(tr?tr('nature.reducedMotion'):'Анимации отключены настройкой уменьшения движения в системе.'):(tr?tr('nature.description'):'Декоративный фон по теме; не фактическая погода.');
      select.setAttribute('aria-description',tr?tr('nature.description'):'Декоративный фон по теме; не фактическая погода.');
    }
    function stop(){if(frameId)cancelAnimationFrame(frameId);frameId=0;previousFrame=null;}
    function canAnimate(){return mode!=='off'&&!document.hidden&&pageActive;}
    function frame(time) {
      frameId=0;if(!canAnimate())return;
      if(previousFrame!==null&&time-previousFrame<1000/30){frameId=requestAnimationFrame(frame);return;}
      const realDt=previousFrame===null?0:Math.max(0,(time-previousFrame)/1000),dt=Math.min(realDt,.06);previousFrame=time;elapsed+=dt;
      wind+=(windTarget-wind)*Math.min(1,dt*2.5);windTarget*=Math.exp(-dt*2);
      ctx.clearRect(0,0,width,height);flightCtx.clearRect(0,0,width,height);
      if(mode==='wind'){drawSun(dt);drawWindLines();for(const p of particles)drawLeaf(p,dt);}
      else if(mode==='lycoris'){drawCelestial(true);drawWindLines();for(const p of particles)drawLycoris(p,dt);}
      else if(mode==='sun')drawSun(dt,true);else if(mode==='rain')drawRain(dt);else if(mode==='snow')drawSnow(dt);
      // Limit a single stalled frame to one active second; suspended laptops cannot queue a fly-by.
      drawFlight(flightClock.advance(Math.min(realDt,1),theme==='christmas'));
      frameId=requestAnimationFrame(frame);
    }
    function start(){if(!frameId&&canAnimate()){previousFrame=null;frameId=requestAnimationFrame(frame);}}
    function applyMode(resetFlight=true) {
      stop();mode=resolveAtmosphere(preferredMode,theme,reducedMotion.matches);
      canvas.hidden=mode==='off';flightCanvas.hidden=true;flightCanvas.dataset.active='false';
      document.body.dataset.natureMode=mode;document.body.dataset.naturePreference=preferredMode;
      if(resetFlight)flightClock.reset();
      if(select){select.value=reducedMotion.matches?'off':preferredMode;select.disabled=reducedMotion.matches;updateTitle();}
      ctx.clearRect(0,0,width,height);flightCtx.clearRect(0,0,width,height);seedParticles();start();
    }
    select?.addEventListener('change',()=>{preferredMode=MODES.has(select.value)?select.value:'off';try{localStorage.setItem(STORAGE_KEY,preferredMode);}catch(_){}applyMode();});
    window.addEventListener('pointermove',e=>{if(!canAnimate()||e.pointerType==='touch')return;if(previousPointerX!==null)windTarget=clamp((e.clientX-previousPointerX)*.8,-24,24);pointerX=e.clientX;pointerY=e.clientY;previousPointerX=e.clientX;},{passive:true});
    document.addEventListener('pointerleave',()=>{pointerX=pointerY=-1000;previousPointerX=null;windTarget=0;},{passive:true});
    window.addEventListener('resize',resize,{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();flightCanvas.hidden=true;}else start();});
    window.addEventListener('pagehide',()=>{pageActive=false;stop();flightCanvas.hidden=true;});
    window.addEventListener('pageshow',()=>{pageActive=true;start();});
    document.addEventListener('astra:themechange',()=>{const next=document.documentElement.dataset.theme||'forest';const changed=next!==theme;theme=next;dark=theme!=='forest';applyMode(changed);});
    document.addEventListener('astra:languagechange',updateTitle);
    reducedMotion.addEventListener('change',()=>applyMode());resize();applyMode();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initNature,{once:true});else initNature();
})();
