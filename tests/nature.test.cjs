'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createFlightClock, resolveAtmosphere} = require('../app/static/nature.js');

test('Santa first flies at 120 seconds, for five seconds, then at 240 seconds', () => {
  const clock = createFlightClock();
  assert.equal(clock.advance(119.9), null);
  assert.ok(Math.abs(clock.advance(.1)) < 1e-10);
  assert.ok(Math.abs(clock.advance(2.5) - .5) < 1e-10);
  assert.equal(clock.advance(2.5), null);
  assert.equal(clock.advance(114.9), null);
  assert.ok(Math.abs(clock.advance(.1)) < 1e-10);
});

test('Hidden or disabled periods add no time and a theme reset starts a new interval', () => {
  const clock = createFlightClock();
  assert.equal(clock.advance(100), null);
  assert.equal(clock.advance(3600, false), null);
  assert.equal(clock.advance(19), null);
  assert.equal(clock.advance(1), 0);
  clock.reset();
  assert.equal(clock.advance(119), null);
  assert.equal(clock.advance(1), 0);
  assert.equal(clock.advance(NaN), 0);
});

test('Theme defaults select sunlight/wind, Lycoris/moon and snow while respecting off', () => {
  assert.equal(resolveAtmosphere('auto','forest',false),'wind');
  assert.equal(resolveAtmosphere('auto','dark',false),'lycoris');
  assert.equal(resolveAtmosphere('auto','christmas',false),'snow');
  assert.equal(resolveAtmosphere('wind','dark',false),'lycoris');
  assert.equal(resolveAtmosphere('off','christmas',false),'off');
  assert.equal(resolveAtmosphere('auto','christmas',true),'off');
  assert.equal(resolveAtmosphere('rain','forest',false),'rain');
});

function browser({theme='forest', saved='wind', reduced=false}={}) {
  const docEvents = new Map(),winEvents = new Map(),nodes = new Map(),rafs = new Map();
  const storage = new Map([['astra:nature-mode',saved]]);
  let rafId = 0, now = 0;
  const context = new Proxy({}, {get(target,key){if(key==='createRadialGradient')return()=>({addColorStop(){}});return target[key]||(()=>{});},set(target,key,value){target[key]=value;return true;}});
  function node(id) {return {id,dataset:{},style:{},hidden:false,disabled:false,value:saved,events:new Map(),setAttribute(name,value){this[name]=value;},addEventListener(name,cb){this.events.set(name,cb);},dispatchEvent(e){this.events.get(e.type)?.(e);},getContext(){return context;},remove(){nodes.delete(this.id);}};}
  const select=node('nature-mode');nodes.set(select.id,select);
  const media={matches:reduced,addEventListener(name,cb){this.change=cb;}};
  const body={dataset:{},prepend(n){nodes.set(n.id,n);}};
  const document={body,hidden:false,readyState:'complete',documentElement:{clientWidth:390,dataset:{theme}},createElement(){return node('');},getElementById(id){return nodes.get(id);},addEventListener(name,cb){docEvents.set(name,cb);}};
  const window={innerWidth:390,innerHeight:844,devicePixelRatio:3,matchMedia(){return media;},addEventListener(name,cb){winEvents.set(name,cb);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../app/static/nature.js'),'utf8'),{document,window,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame(cb){rafs.set(++rafId,cb);return rafId;},cancelAnimationFrame(id){rafs.delete(id);},Math,Set,Number});
  return {document,window,media,nodes,storage,select,rafs,event(name){docEvents.get(name)?.();},frame(ms=40){now+=ms;const list=[...rafs.values()];rafs.clear();for(const cb of list)cb(now);}};
}

test('Browser runtime migrates old decoration to auto, caps DPR and pauses invisible pages', () => {
  const b=browser({theme:'dark'});
  assert.equal(b.select.value,'auto');assert.equal(b.document.body.dataset.natureMode,'lycoris');
  assert.equal(b.nodes.get('nature-atmosphere').width,585);
  b.frame();assert.equal(b.rafs.size,1);
  b.document.hidden=true;b.event('visibilitychange');assert.equal(b.rafs.size,0);
  b.document.hidden=false;b.event('visibilitychange');assert.equal(b.rafs.size,1);
  b.media.matches=true;b.media.change();assert.equal(b.document.body.dataset.natureMode,'off');assert.equal(b.rafs.size,0);
  b.media.matches=false;b.media.change();assert.equal(b.document.body.dataset.natureMode,'lycoris');
  b.select.value='off';b.select.dispatchEvent({type:'change'});
  b.document.documentElement.dataset.theme='christmas';b.event('astra:themechange');
  assert.equal(b.document.body.dataset.natureMode,'off');assert.equal(b.storage.get('astra:nature-mode'),'off');
});

test('Accelerated browser frames verify Santa cadence and no flight after a hidden hour', () => {
  const b=browser({theme:'christmas',saved:'auto'});const flight=b.nodes.get('holiday-flight');
  b.frame();for(let i=0;i<2999;i++)b.frame();assert.equal(flight.dataset.active,'false');
  b.document.hidden=true;b.event('visibilitychange');b.frame(3600000);
  b.document.hidden=false;b.event('visibilitychange');b.frame();assert.equal(flight.dataset.active,'false');
  b.frame();assert.equal(flight.dataset.active,'true');
  for(let i=0;i<126;i++)b.frame();assert.equal(flight.dataset.active,'false');
  b.select.value='off';b.select.dispatchEvent({type:'change'});assert.equal(flight.hidden,true);assert.equal(b.rafs.size,0);
});
