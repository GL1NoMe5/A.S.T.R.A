const test = require('node:test');
const path = require('node:path');
test('Dashboard translations cover UI keys, placeholders and live language changes', () => {
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname, '../app/static/i18n.js'),'utf8');
const start=source.indexOf('const dictionaries = ')+21,end=source.search(/;\r?\ndictionaries\.ru/);
const dict=JSON.parse(source.slice(start,end));
for(const lang of ['en','kk']){
 assert.deepEqual(Object.keys(dict[lang]).sort(),Object.keys(dict.ru).sort());
 for(const key of Object.keys(dict.ru)){
  assert(dict[lang][key].trim(),lang+':'+key);
  const slots=s=>[...s.matchAll(/\{(\d+)\}/g)].map(x=>x[1]).sort();
  assert.deepEqual(slots(dict[lang][key]),slots(dict.ru[key]),lang+':'+key);
 }
}
const html=fs.readFileSync(path.join(__dirname, '../app/static/index.html'),'utf8');
for(const match of html.matchAll(/data-i18n(?:-text|-aria-label|-title|-placeholder)?="([^"]+)"/g))assert(dict.ru[match[1]]||match[1]==='nature.auto',match[1]);
const storage=new Map(),events=[];
const document={readyState:'loading',documentElement:{lang:'ru'},body:{},addEventListener(){},querySelectorAll(){return [];},createTreeWalker(){return {nextNode(){return false;}};},getElementById(){return null;},dispatchEvent(e){events.push(e.type);}};
const context={window:{},document,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},CustomEvent:class{constructor(type,data){this.type=type;this.detail=data.detail;}},NodeFilter:{SHOW_TEXT:4}};
vm.runInNewContext(source,context);const i=context.window.AstraI18n;
i.setLanguage('en');assert.equal(i.t('s8'),'Greening plan');assert.equal(i.zoneName('Есиль · зона 1'),'Yesil · zone 1');assert.equal(i.locale,'en-GB');
const status=i.t('d58',{'0':'25/10, 14:30'});i.setLanguage('kk');assert.equal(i.t('s8'),'Көгалдандыру жоспары');assert.equal(i.zoneName('Байконыр · зона 4'),'Байқоңыр · аймақ 4');assert(i.retranslate(status).startsWith('Соңғы дерек:'));assert.equal(storage.get('astra:language'),'kk');
i.setLanguage('invalid');assert.equal(i.language,'kk');assert(events.includes('astra:languagechange'));
const dynamic=fs.readFileSync(path.join(__dirname, '../app/static/app.js'),'utf8');for(const match of dynamic.matchAll(/\bt\(['"]([^'"]+)['"]\)/g))assert(dict.ru[match[1]]||match[1]==='feature.',match[1]);



});
