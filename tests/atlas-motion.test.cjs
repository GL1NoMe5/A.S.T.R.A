'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser() {
  let rafId = 0, now = 0;
  const rafs = new Map(), observers = [];
  function node() {
    return {dataset:{},disabled:false,style:{values:{},setProperty(k,v){this.values[k]=v;}},events:new Map(),
      setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events.set(k,fn);},removeEventListener(k){this.events.delete(k);},
      fire(k,event={}){this.events.get(k)?.(event);},getBoundingClientRect(){return {width:1000,height:500,top:40,bottom:540,left:0};}};
  }
  const hero=node(),canvas=node(),breeze=node(),pause=node(),body=node(),html=node(),document=node(),window=node(),media=node();
  const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}})}, {get:(object,key)=>object[key]||(()=>{}),set:(object,key,value)=>(object[key]=value,true)});
  canvas.getContext=()=>ctx;html.dataset.theme='forest';body.dataset.natureMode='wind';media.matches=false;
  Object.assign(document,{readyState:'complete',hidden:false,body,documentElement:html,querySelector:()=>hero,getElementById:id=>({'atlas-atmosphere':canvas,'atlas-breeze':breeze,'atlas-pause':pause}[id])});
  Object.assign(window,{innerHeight:900,devicePixelRatio:3,matchMedia:()=>media});
  const context={document,window,Math,Number,String,ResizeObserver:class{observe(){}disconnect(){}},
    MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}},
    IntersectionObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){}},
    requestAnimationFrame(fn){rafs.set(++rafId,fn);return rafId;},cancelAnimationFrame(id){rafs.delete(id);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/static/atlas-motion.js'),'utf8'),context);
  return {hero,canvas,breeze,pause,document,window,media,rafs,observers,
    frame(ms=40){now+=ms;const pending=[...rafs.values()];rafs.clear();pending.forEach(fn=>fn(now));},
    preferences(){observers[0].fn();},visible(value){observers[1].fn([{isIntersecting:value}]);}};
}

test('Hero respects motion opt-out, visibility and DPR without duplicating frame loops', () => {
  const b=browser();assert.equal(b.canvas.width,1500);assert.equal(b.rafs.size,1);
  b.preferences();b.preferences();b.document.fire('astra:themechange');assert.equal(b.rafs.size,1);
  b.frame();b.document.hidden=true;b.document.fire('visibilitychange');assert.equal(b.rafs.size,0);
  b.frame(3600000);b.document.hidden=false;b.document.fire('visibilitychange');assert.equal(b.rafs.size,1);
  b.document.body.dataset.natureMode='off';b.preferences();assert.equal(b.rafs.size,0);assert.equal(b.hero.dataset.motionState,'off');
  b.document.body.dataset.natureMode='wind';b.preferences();assert.equal(b.rafs.size,1);
  b.media.matches=true;b.media.fire('change');assert.equal(b.rafs.size,0);assert.equal(b.hero.dataset.scenePaused,'true');
});

test('User pause survives theme changes and offscreen transitions', () => {
  const b=browser();b.pause.fire('click');assert.equal(b.pause['aria-pressed'],'true');assert.equal(b.rafs.size,0);
  b.document.documentElement.dataset.theme='dark';b.preferences();assert.equal(b.hero.dataset.motionState,'paused');
  b.visible(false);b.visible(true);assert.equal(b.rafs.size,0);
  b.pause.fire('click');assert.equal(b.rafs.size,1);
  b.visible(false);assert.equal(b.rafs.size,0);b.visible(true);assert.equal(b.rafs.size,1);
});

test('Wind expires on active time and teardown cancels the loop', () => {
  const b=browser();b.breeze.fire('click');assert.equal(b.breeze['aria-pressed'],'true');b.frame();
  b.document.hidden=true;b.document.fire('visibilitychange');b.frame(3600000);
  b.document.hidden=false;b.document.fire('visibilitychange');b.frame();assert.equal(b.breeze['aria-pressed'],'true');
  for(let i=0;i<130;i++)b.frame();assert.equal(b.breeze['aria-pressed'],'false');
  b.hero.fire('astra:scene-destroy');assert.equal(b.rafs.size,0);assert.equal(b.hero.dataset.motionReady,undefined);
});
