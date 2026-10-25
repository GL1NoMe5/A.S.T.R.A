'use strict';
const i18n = window.AstraI18n;
const t = (key, values) => i18n.t(key, values);
const zoneName = value => i18n.zoneName(value);
const $ = id => document.getElementById(id);
const fmt = (v, digits = 1) => Number.isFinite(Number(v)) && v !== null ? Number(v).toLocaleString(i18n.locale, {maximumFractionDigits: digits, minimumFractionDigits: digits}) : '—';
const localTime = value => value ? new Date(value).toLocaleString(i18n.locale, {timeZone: 'Asia/Qyzylorda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : t("d0");
const plural = (n, forms) => { if(i18n.language!=='ru')return Number(n)===1?forms[0]:forms[1]; const a=Math.abs(n)%100,b=a%10; return forms[a>10&&a<20?2:b===1?0:b>=2&&b<=4?1:2]; };
const state = {sensors: new Map(), readings: new Map(), markers: new Map(), selected: null, result: null, history: [], socket: null, heat: null, shapSequence: 0,
  liveHistory: [], stationHistory: new Map(), historyPeriod: 'live', historySensor: 'all', historySequence: 0,
  lastPacket: 0, lastDataAt: null, connectStarted: 0, streamWarning: '', loadErrors: new Map(),
  suspended: false, view: 'overview', mapMetric: 'esi', loading: false, historyError: false, drawerTrigger: null,
  savedOffset: 0, savedTotal: 0, savedItems: new Map(), savedLoaded: false, savedSequence: 0, planSequence: 0};
const layout = {paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: {family: 'Segoe UI, Arial', color: '#657266', size: 11}, margin: {l: 48, r: 48, t: 15, b: 40}, showlegend: false, xaxis: {gridcolor: '#dfe4da', zeroline: false}, yaxis: {gridcolor: '#dfe4da', zeroline: false}};
const plotConfig = {responsive: true, displayModeBar: false, locale: 'ru'};
let map, tileErrors = 0, reconnectTimer, toastTimer, optimizationVersion = 0, statusTimer;
let speciesLabels,districtLabels,views,mapMetrics;
function refreshLanguageLabels() {
speciesLabels = {elm:t("d1"),pine:t("d2"),poplar:t("d3")};
districtLabels = {all:t("d4"),yesil:t("d5"),nura:t("d6"),almaty:t("d7"),saryarka:t("d8"),baikonyr:t("d9")};
views = {overview:[t("d10"),t("d11")],planning:[t("d12"),t("d13")],analytics:[t("d14"),t("d15")],saved:[t("d16"),t("d17")]};
mapMetrics = {esi:{label:'ESI',unit:'/ 100'},pm25:{label:'PM2.5',unit:t("d18")},surface_temp_c:{label:t("d19"),unit:'°C'}};
  plotConfig.locale=i18n.plotLocale;
}
refreshLanguageLabels();
function setText(id,text) { const node=$(id);if(node&&node.textContent!==String(text))node.textContent=text; }
function element(tag,className,text) { const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node; }
function option(value,text) { const node=element('option',null,text);node.value=value;return node; }
function rememberPlan(id) { try{sessionStorage.setItem('astra:last-plan-id',id);}catch(_){} }
function mergeHistory(a,b) { return [...new Map([...a,...b].map(p=>[p.timestamp,p])).values()].sort((x,y)=>Date.parse(x.timestamp)-Date.parse(y.timestamp)).slice(-300); }
function selectedLiveHistory() { return state.historySensor==='all'?state.liveHistory:state.stationHistory.get(state.historySensor)||[]; }
function closeSensor() {
  $('sensor-drawer').hidden=true;state.selected=null;state.shapSequence++;updateMarkers();
  const trigger=state.drawerTrigger;
  if(trigger?.isConnected&&trigger.offsetParent!==null&&trigger!==document.body)trigger.focus({preventScroll:true});
  else if(state.view==='overview')$('sensor-picker').focus({preventScroll:true});
  state.drawerTrigger=null;
}
function renderDataNotice() {
  const notice=$('data-notice');if(!notice)return;
  const messages=[...state.loadErrors.values()];if(state.streamWarning)messages.unshift(state.streamWarning);
  notice.hidden=messages.length===0;notice.setAttribute('role','status');
  setText('data-notice-text',messages.join(' '));
  if($('retry-data')){$('retry-data').disabled=state.loading;$('retry-data').textContent=state.loading?t("d20"):t("d21");}
}
function hasFreshData() { return state.lastPacket>0&&Date.now()-state.lastPacket<=15000&&state.lastDataAt&&Date.now()-Date.parse(state.lastDataAt)<=15000; }
function showView(name,{updateHash=true}={}) {
  if(!views[name])name='overview';state.view=name;
  document.querySelectorAll('[data-view]').forEach(section=>{section.hidden=section.dataset.view!==name;});
  document.querySelectorAll('[data-route]').forEach(link=>{const active=link.dataset.route===name;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  setText('view-title',views[name][0]);setText('view-caption',views[name][1]);
  if(updateHash&&location.hash!==`#${name}`)history.pushState(null,'',`#${name}`);
  if(name!=='overview'&&state.selected)closeSensor();
  requestAnimationFrame(()=>{if(name==='overview'&&map)map.invalidateSize();if(name==='analytics')renderTelemetry();for(const id of['telemetry-chart','comparison-chart','shap-chart']){const c=$(id);if(c&&c.offsetParent!==null&&c._fullLayout)Plotly.Plots.resize(c);}});
  if(name==='saved'&&!state.savedLoaded)loadSavedPlans();window.scrollTo({top:0,behavior:'instant'});
}

async function api(url, options) {
  let response;
  try{response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});}catch(cause){throw new Error(t(cause.name==='TimeoutError'?'error.timeout':'error.network'));}
  if (!response.ok) {
    let message = t("d22",{"0":(response.status)});
    try { const body = await response.json(); const known={'Сохранённый расчёт не найден. Расчёты хранятся 30 дней.':'error.saved404','Виртуальная станция не найдена':'error.sensor404'}; message=known[body.detail]?t(known[body.detail]):response.status===422?t('d23'):message; } catch (_) {}
    const error=new Error(message);error.status=response.status;throw error;
  }
  return response.json();
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 7000); }
function colour(esi) { return esi >= 60 ? '#bd5c4f' : esi >= 30 ? '#b98b4d' : '#42745a'; }
function mapScale() {
  if(state.mapMetric==='esi')return {min:0,max:100,relative:false,empty:false};
  const values=[...state.readings.values()].filter(r=>state.sensors.has(r.sensor_id)).map(r=>r[state.mapMetric]).filter(Number.isFinite);
  return values.length?{min:Math.min(...values),max:Math.max(...values),relative:true,empty:false}:{min:0,max:1,relative:true,empty:true};
}
function mapIntensity(reading,scale) {
  const value=reading[state.mapMetric];if(!Number.isFinite(value))return 0;
  const span=scale.max-scale.min;
  return span<1e-6?.5:Math.max(0,Math.min(1,(value-scale.min)/span));
}
function renderMapScale(scale) {
  document.querySelectorAll('[data-map-metric]').forEach(button=>{const active=button.dataset.mapMetric===state.mapMetric;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);});
  if(!scale.relative){setText('map-scale',t("d24"));setText('map-low','< 30');setText('map-mid','30–60');setText('map-high','≥ 60');return;}
  const unit=mapMetrics[state.mapMetric].unit;
  setText('map-scale',scale.empty?t("d25"):t("d27",{"0":(unit),"1":(scale.max-scale.min<1e-6?t("d26"):'')}));
  setText('map-low',scale.empty?'—':fmt(scale.min,2));setText('map-mid',scale.empty?'—':fmt((scale.min+scale.max)/2,2));setText('map-high',scale.empty?'—':fmt(scale.max,2));
}
function resetMapView() {
  if(!map)return;
  const coordinates=[...state.sensors.values()].filter(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)).map(s=>[s.latitude,s.longitude]);
  if(coordinates.length)map.fitBounds(coordinates,{padding:[40,40],maxZoom:13,animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches});
  else map.setView([51.151,71.447],12);
}
function renderNetworkSummary() {
  const readings=[...state.readings.values()];
  const average=key=>{const values=readings.map(r=>r[key]).filter(Number.isFinite);return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;};
  setText('network-esi',fmt(average('esi')));setText('network-wind',fmt(average('wind_speed')));setText('network-active',fmt(readings.length,0));
}

function initMap() {
  setText('map-count','—');
  map = L.map('map', {zoomControl: false, preferCanvas: false}).setView([51.151, 71.447], 12);
  L.control.zoom({position:'bottomright',zoomInTitle:t("d28"),zoomOutTitle:t("d29")}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'})
    .on('tileerror', () => { tileErrors++; $('tile-status').textContent = t("d30"); }).addTo(map);
  $('heat-toggle').addEventListener('change', updateHeat);
  document.querySelectorAll('[data-map-metric]').forEach(button=>button.addEventListener('click',()=>{if(!mapMetrics[button.dataset.mapMetric])return;state.mapMetric=button.dataset.mapMetric;updateMarkers();updateHeat();}));
  if($('reset-map'))$('reset-map').addEventListener('click',resetMapView);
  renderMapScale(mapScale());
}
function updateHeat() {
  if(!map)return;
  if (state.heat) { map.removeLayer(state.heat); state.heat = null; }
  if ($('heat-toggle').checked && state.readings.size) {
    const scale=mapScale();
    state.heat = L.heatLayer([...state.readings.values()].filter(r=>state.sensors.has(r.sensor_id)&&Number.isFinite(r[state.mapMetric])).map(r => { const s = state.sensors.get(r.sensor_id); return [s.latitude, s.longitude, Math.max(.1,mapIntensity(r,scale))]; }), {radius: 35, blur: 27, maxZoom: 14, max: 1, gradient: {.15:'#a1b79e',.4:'#42745a',.7:'#b98b4d',1:'#bd5c4f'}}).addTo(map);
  }
}
function updateMarkers() {
  if(!map)return;
  const scale=mapScale(),metric=mapMetrics[state.mapMetric];renderMapScale(scale);
  const allocated = new Set((state.result?.zones || []).map(z => z.id));
  for (const [id, s] of state.sensors) {
    const r = state.readings.get(id); if (!r) continue;
    const selected = allocated.has(id), c = colour(mapIntensity(r,scale)*100);
    let marker = state.markers.get(id);
    if (!marker) { marker = L.circleMarker([s.latitude, s.longitude], {radius: 7, weight: 2, fillOpacity: .7, className:'station-marker'}).addTo(map).on('click', () => openSensor(id)); state.markers.set(id, marker); }
    marker.setStyle({color: selected?'#264d35':c, fillColor: c, radius: selected ? 11 : state.selected === id ? 10 : 7, weight: selected ? 3 : 2});
    marker.bindTooltip(element('span',null,`${zoneName(s.name)} · ${metric.label} ${fmt(r[state.mapMetric])} ${metric.unit}${selected?t("d31"):''}`), {direction: 'top'});
  }
  setText('map-count',fmt(state.markers.size,0));
}
function updateBackground(bg) {
  state.background=bg;
  const labels = {live: t("d32"), cached: t("d33"), default: t("d34")};
  const a = bg.air, w = bg.weather;
  $('source-detail').textContent = t("d35",{"0":(labels[a.status]),"1":(localTime(a.source_time)),"2":(localTime(a.fetched_at)),"3":(labels[w.status]),"4":(localTime(w.source_time)),"5":(localTime(w.fetched_at))});
  $('source-badge').textContent = a.status === 'live' && w.status === 'live' ? t("d36") : t("d37");
  $('source-badge').style.color = a.status === 'live' && w.status === 'live' ? '#42745a' : '#966c37';
  $('kpi-aqi').textContent = fmt(a.values.european_aqi, 0);
  $('aqi-label').textContent = a.status === 'default' ? t("d38") : 'EAQI';
}
function updateDashboard(payload) {
  for(const r of payload.readings||[]){state.readings.set(r.sensor_id,r);state.stationHistory.set(r.sensor_id,mergeHistory(state.stationHistory.get(r.sensor_id)||[],[{timestamp:r.timestamp,pm25:r.pm25,surface_temp_c:r.surface_temp_c}]));}
  const dates=(payload.readings||[]).map(r=>Date.parse(r.timestamp)).filter(Number.isFinite);
  if(dates.length){state.lastPacket=Date.now();state.lastDataAt=new Date(Math.max(...dates)).toISOString();}
  const s = payload.summary;if(s)state.summary=s;state.mode=payload.mode;
  if (s) { $('kpi-pm').textContent = fmt(s.pm25); $('kpi-temp').textContent = fmt(s.surface_temp_c); $('kpi-sensors').textContent = fmt(s.active_sensors, 0); $('kpi-hotspots').textContent = s.critical_hotspots; }
  if (payload.background) updateBackground(payload.background);
  $('mode').textContent = payload.mode === 'docker' ? 'PostgreSQL + Redis' : t("d39");
  if(payload.type==='snapshot'&&payload.history?.length)state.liveHistory=mergeHistory(payload.history,state.liveHistory);
  if(s)state.liveHistory=mergeHistory(state.liveHistory,[{timestamp:payload.timestamp,...s}]);
  if(state.historyPeriod==='live'){state.history=selectedLiveHistory();if(state.view==='analytics')renderTelemetry();}
  updateMarkers(); updateHeat(); renderNetworkSummary(); refreshConnectionStatus();
  if (state.selected) renderSensorValues();
}
function renderTelemetry() {
  const palette=getComputedStyle(document.documentElement),pmColor=palette.getPropertyValue('--chart-pm').trim()||'#42745a',tempColor=palette.getPropertyValue('--chart-temp').trim()||'#b98b4d';
  const x = state.history.map(p => new Date(new Date(p.timestamp).getTime()+5*3600000).toISOString().slice(0,-1));
  Plotly.react('telemetry-chart', [
    {x, y: state.history.map(p => p.pm25), type:'scatter', mode:'lines', name:t("d40"), line:{color:pmColor,width:2.5}, fill:'tozeroy', fillcolor:'rgba(66,116,90,.06)', hovertemplate:t("d41")},
    {x, y: state.history.map(p => p.surface_temp_c), type:'scatter', mode:'lines', name:t("d42"), yaxis:'y2', line:{color:tempColor,width:2}, hovertemplate:t("d43")}
  ], {...layout, uirevision:`${state.historyPeriod}:${state.historySensor}`, xaxis:{...layout.xaxis,type:'date',tickformat:state.historyPeriod==='1440'?'%H:%M':'%H:%M:%S',hoverformat:'%d.%m %H:%M:%S',title:{text:t("d44"),font:{size:10}}}, yaxis:{...layout.yaxis,title:t("d18")}, yaxis2:{overlaying:'y',side:'right',showgrid:false,zeroline:false,title:'°C'}, hovermode:'x unified'}, plotConfig);
  if(!state.historyError)setText('history-status',state.history.length?t("d48",{"0":(state.historyPeriod==='live'?t("d45"):t("d46")),"1":(state.historySensor==='all'?t("d47"):state.historySensor),"2":(state.history.length)}):t("d49"));
}
async function loadHistory() {
  const version=++state.historySequence;state.historyPeriod=$('history-period')?.value||'live';state.historySensor=$('history-sensor')?.value||'all';
  const period=state.historyPeriod,sensor=state.historySensor;setText('history-status',t("d50"));
  try{
    const query=new URLSearchParams({minutes:period==='live'?'60':period});if(sensor!=='all')query.set('sensor_id',sensor);
    const data=await api(`/api/v1/telemetry/history?${query}`);if(version!==state.historySequence)return;state.historyError=false;state.loadErrors.delete('history');renderDataNotice();
    if(period==='live'){state.history=mergeHistory(data.points,selectedLiveHistory());if(sensor==='all')state.liveHistory=state.history;else state.stationHistory.set(sensor,state.history);}else state.history=data.points;
    renderTelemetry();
  }catch(error){if(version!==state.historySequence)return;state.historyError=true;state.history=period==='live'?selectedLiveHistory():[];renderTelemetry();setText('history-status',t("d51",{"0":(error.message)}));state.loadErrors.set('history',t("d52"));renderDataNotice();}
}
function refreshConnectionStatus() {
  const open=state.socket?.readyState===WebSocket.OPEN;
  const connecting=state.socket?.readyState===WebSocket.CONNECTING,live=Boolean(open&&hasFreshData());
  $('connection').textContent=live?t("d53"):open?(state.lastPacket?t("d54"):t("d55")):state.lastPacket?t("d56"):t("d57");
  $('connection').classList.toggle('live',live);$('connection').dataset.state=live?'live':open?'stale':'offline';
  setText('last-updated',state.lastDataAt?t("d58",{"0":(localTime(state.lastDataAt))}):t("d59"));
  state.streamWarning=live?'':open&&state.lastPacket?t("d60"):
    open&&Date.now()-state.connectStarted>15000?t("d61"):
    connecting&&Date.now()-state.connectStarted>15000?t("d62"):
    !open&&!connecting&&state.connectStarted?t("d63"):'';
  renderDataNotice();
}
function disconnectSocket() {clearTimeout(reconnectTimer);if(state.socket){state.socket.onclose=null;state.socket.onmessage=null;state.socket.close();state.socket=null;}}
function connectSocket() {
  if(state.suspended||state.socket?.readyState===WebSocket.OPEN||state.socket?.readyState===WebSocket.CONNECTING)return;
  clearTimeout(reconnectTimer);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/telemetry`);
  state.socket = socket;state.connectStarted=Date.now();state.loadErrors.delete('connection');
  socket.onopen = () => { if(state.socket===socket)refreshConnectionStatus(); };
  socket.onmessage = event => { if(state.socket!==socket)return;try { updateDashboard(JSON.parse(event.data)); } catch (error) { console.error(error); } };
  socket.onclose = () => { if(state.socket!==socket)return;refreshConnectionStatus();if(!state.suspended)reconnectTimer=setTimeout(connectSocket,2000); };
  socket.onerror = () => socket.close();
}
function sensorValue(label, value, unit) {
  const div = document.createElement('div'); div.className = 'sensor-value';
  const small = document.createElement('small'); small.textContent = label;
  const strong = document.createElement('strong'); strong.textContent = fmt(value);
  const em = document.createElement('em'); em.textContent = unit;
  div.append(small,strong,em); return div;
}
function renderSensorValues() {
  const s = state.sensors.get(state.selected), r = state.readings.get(state.selected); if (!s || !r) return;
  $('sensor-name').textContent = zoneName(s.name);
  $('sensor-coordinates').textContent = t("d64",{"0":(s.id),"1":(s.latitude.toFixed(4)),"2":(s.longitude.toFixed(4)),"3":(s.ndvi)});
  $('sensor-values').replaceChildren(...[
    ['PM2.5',r.pm25,t("d18")],['PM10',r.pm10,t("d18")],['NO₂',r.no2,t("d18")],['CO',r.co,t("d18")],[t("d65"),r.co2,'ppm'],[t("d66"),r.esi,'/100'],[t("d67"),r.air_temp_c,'°C'],[t("d68"),r.surface_temp_c,'°C'],[t("d69"),r.wind_speed,t("d70")],[t("d71"),r.humidity,'%']
  ].map(v => sensorValue(...v)));
  $('sensor-forecast').textContent = t("d72",{"0":(fmt(r.predicted_pm25)),"1":(fmt(r.predicted_pm25_ml)),"2":(fmt(r.predicted_esi))});
}
async function openSensor(id) {
  if(!state.selected)state.drawerTrigger=document.activeElement;
  state.selected = id; $('sensor-picker').value=id; $('sensor-drawer').hidden = false; renderSensorValues(); updateMarkers();$('close-drawer').focus({preventScroll:true});await loadExplanation();
}
async function loadExplanation() {
  const id = state.selected, selected = $('explain-target').value, version = ++state.shapSequence;
  const target = selected === 'pm25_ml' ? 'pm25' : selected;
  const method = selected === 'pm25_ml' ? 'ml' : 'primary';
  $('shap-chart').hidden = true;
  $('shap-status').textContent = t("d73");
  try {
    const data = await api(`/api/v1/analytics/explain/${encodeURIComponent(id)}?target=${target}&method=${method}`);
    if (version !== state.shapSequence || state.selected !== id) return;
    if (data.explanation_kind === 'persistence_rule') {
      $('shap-status').textContent = t("d74",{"0":(fmt(data.prediction,2)),"1":(data.units==='µg/m³'||data.units==='ug/m3'?t('d18'):data.units)});
      return;
    }
    $('shap-chart').hidden = false;
    const f = data.features.slice(0,8).reverse();
    Plotly.react('shap-chart',[{type:'bar',orientation:'h',x:f.map(v=>v.contribution),y:f.map(v=>t('feature.'+v.feature)),marker:{color:f.map(v=>v.contribution>=0?'#bd5c4f':'#42745a')},hovertemplate:'%{y}: %{x:.3f}<extra></extra>'}],{...layout,margin:{l:152,r:15,t:20,b:35},xaxis:{...layout.xaxis,title:{text:t("d75",{"0":(data.units==='µg/m³'||data.units==='ug/m3'?t('d18'):data.units)}),font:{size:10}},zeroline:true,zerolinecolor:'#9aaa96'},yaxis:{...layout.yaxis,automargin:true}},plotConfig);
    $('shap-status').textContent = t("d78",{"0":(data.forecast_role==='experimental'?t("d76"):''),"1":(fmt(data.base_value,2)),"2":(fmt(data.prediction_raw,2)),"3":(data.units==='µg/m³'||data.units==='ug/m3'?t('d18'):data.units),"4":(data.clipping_applied?t("d77"):'')});
  } catch (error) { if (version === state.shapSequence) $('shap-status').textContent = error.message; }
}
function resultCard(label,value,unit,detail) { const d=document.createElement('div');d.className='result-kpi';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=`${value} ${unit}`;const s=document.createElement('span');s.textContent=detail;d.append(l,v,s);return d; }
function renderResult(result,{activate=true,scroll=true}={}) {
  state.result = result;rememberPlan(result.run_id);if(activate)showView('planning');
  const s = result.summary, cost = result.costs;
  $('results').hidden = false;
  $('result-description').textContent = t("d85",{"0":(result.zones.length),"1":(plural(result.zones.length,[t("d79"),t("d80"),t("d81")])),"2":(fmt(result.used_trees,0)),"3":(fmt(result.unused_trees,0)),"4":(result.horizon_years),"5":(plural(result.horizon_years,[t("d82"),t("d83"),t("d84")])),"6":(fmt(cost.first_year_total,0)),"7":(fmt(cost.horizon_total,0)),"8":(localTime(result.created_at))});
  $('result-kpis').replaceChildren(
    resultCard(t("d86"),fmt(s.pm25_reduction,2),t("d18"),t("d87",{"0":(fmt(s.pm25_reduction_pct,1)),"1":(s.pm25_reduction_range.map(v=>fmt(v,2)).join('–'))})),
    resultCard(t("d88"),fmt(s.cooling_c,2),'°C',t("d89",{"0":(s.cooling_c_range.map(v=>fmt(v,2)).join('–'))})),
    resultCard(t("d90"),fmt(s.co2_tons_year,2),t("d91"),t("d92",{"0":(result.horizon_years)})),
    resultCard(t("d93"),fmt(s.population_covered,0),t("d94"), t("d95")));
  $('zones-table').replaceChildren(...result.zones.map(z=>{const tr=document.createElement('tr');for(const v of [zoneName(z.name),fmt(z.trees,0),`−${fmt(z.pm25_reduction,2)}`,`−${fmt(z.cooling_c,2)}`]){const td=document.createElement('td');td.textContent=v;tr.append(td);}return tr;}));
  Plotly.react('comparison-chart',[
    {type:'bar',name:t("d96"),x:[t("d40")],y:[s.pm25_before],marker:{color:'#bcc7b6'}},
    {type:'bar',name:t("d97"),x:[t("d40")],y:[s.pm25_after],marker:{color:'#42745a'}}
  ],{...layout,showlegend:true,barmode:'group',legend:{orientation:'h',y:1.15},margin:{l:45,r:15,t:35,b:40},yaxis:{...layout.yaxis,title:t("d18")}},plotConfig);
  updateMarkers();
  if(scroll)requestAnimationFrame(()=>$('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));
}
async function runOptimization(event) {
  event.preventDefault(); const version = ++optimizationVersion;
  $('optimize-button').disabled = true; $('optimization-status').textContent = t("d98");
  const body = {budget_trees:Number($('trees').value),species:$('species').value,target_district:$('district').value,horizon_years:Number($('horizon').value),sapling_cost_kzt:Number($('sapling-cost').value),planting_cost_kzt:Number($('planting-cost').value),annual_care_cost_kzt:Number($('care-cost').value),pilot_equipment_cost_kzt:Number($('equipment-cost').value),annual_platform_cost_kzt:Number($('platform-cost').value)};
  try { const result = await api('/api/v1/optimize/greening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(version!==optimizationVersion)return;renderResult(result);state.savedLoaded=false;$('optimization-status').textContent=t("d99",{"0":(result.zones.length),"1":(plural(result.zones.length,[t("d79"),t("d80"),t("d81")]))}); }
  catch(error){$('optimization-status').textContent=error.message;toast(error.message);}finally{$('optimize-button').disabled=false;}
}
function downloadResult(result=state.result) {if(!result)return;const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`astra-plan-${result.run_id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function openReport(result=state.result) {
  if (!result) return;
  try {
    // Keep the exact calculation snapshot within this tab; do not recalculate on navigation.
    rememberPlan(result.run_id);sessionStorage.setItem('astra:report:current', JSON.stringify(result));
    location.assign('/static/report/report.html?source=dashboard');
  } catch (_) {
    toast(t("d100"));
  }
}

function applyParameters(request) {
  const fields={budget_trees:'trees',species:'species',target_district:'district',horizon_years:'horizon',sapling_cost_kzt:'sapling-cost',planting_cost_kzt:'planting-cost',annual_care_cost_kzt:'care-cost',pilot_equipment_cost_kzt:'equipment-cost',annual_platform_cost_kzt:'platform-cost'};
  for(const[key,id]of Object.entries(fields))if(request[key]!==undefined)$(id).value=request[key];$('trees').oninput();$('horizon').oninput();
}
function planLabel(item) {return t("d101",{"0":(localTime(item.created_at)),"1":(fmt(item.used_trees,0)),"2":(speciesLabels[item.request.species]||item.request.species)});}
async function planAction(id,action,button) {
  button.disabled=true;const version=++state.planSequence;
  try{
    const plan=await api(`/api/v1/optimizations/${encodeURIComponent(id)}`);if(version!==state.planSequence)return;
    if(action==='open'){applyParameters(plan.request);renderResult(plan);}
    if(action==='repeat'){applyParameters(plan.request);state.result=null;$('results').hidden=true;try{sessionStorage.removeItem('astra:last-plan-id');}catch(_){}showView('planning');updateMarkers();$('optimization-status').textContent=t("d102");}
    if(action==='json')downloadResult(plan);if(action==='report')openReport(plan);
  }catch(error){toast(error.message);}finally{button.disabled=false;}
}
function renderSavedCard(item) {
  const card=element('article','saved-card'),head=element('div','saved-card-heading');
  head.append(element('h3',null,t("d103",{"0":(speciesLabels[item.request.species]||item.request.species),"1":(fmt(item.used_trees,0))})),element('time',null,localTime(item.created_at)));
  const meta=element('p','saved-card-meta',t("d104",{"0":(districtLabels[item.request.target_district]||item.request.target_district),"1":(item.horizon_years),"2":(plural(item.horizon_years,[t("d82"),t("d83"),t("d84")])),"3":(fmt(item.costs.first_year_total,0))}));
  const effect=element('p','saved-card-effect',t("d105",{"0":(fmt(item.summary.pm25_reduction,2)),"1":(fmt(item.summary.cooling_c,2))})),actions=element('div','saved-card-actions');
  for(const[action,label]of[['open',t("d106")],['repeat',t("d107")],['json','JSON'],['report',t("d108")]]){const b=element('button',action==='open'?'primary-button':'secondary-button',label);b.type='button';b.onclick=()=>planAction(item.run_id,action,b);actions.append(b);}
  card.append(head,meta,effect,actions);return card;
}
function updateCompareOptions() {
  for(const id of['compare-a','compare-b']){const select=$(id);if(!select)continue;const selected=select.value;select.replaceChildren(option('',t("d109")),...[...state.savedItems.values()].map(item=>option(item.run_id,planLabel(item))));if(state.savedItems.has(selected))select.value=selected;}
  const ids=[...state.savedItems.keys()];if($('compare-a')&&!$('compare-a').value&&ids.length)$('compare-a').value=ids[0];if($('compare-b')&&!$('compare-b').value&&ids.length>1)$('compare-b').value=ids[1];
}
async function loadSavedPlans(offset=state.savedOffset) {
  const version=++state.savedSequence;setText('saved-status',t("d110"));$('refresh-plans').disabled=true;
  try{
    const data=await api(`/api/v1/optimizations?limit=8&offset=${Math.max(0,offset)}`);if(version!==state.savedSequence)return;
    if(!data.items.length&&data.total&&offset>=data.total)return loadSavedPlans(Math.max(0,Math.floor((data.total-1)/8)*8));
    state.savedPage=data.items;state.savedRetention=data.retention_days;state.savedOffset=data.offset;state.savedTotal=data.total;state.savedLoaded=true;for(const item of data.items)state.savedItems.set(item.run_id,item);
    $('saved-list').replaceChildren(...data.items.map(renderSavedCard));if(!data.items.length)$('saved-list').append(element('div','empty-state',t("d111")));
    setText('saved-status',t("d115",{"0":(data.total),"1":(plural(data.total,[t("d112"),t("d113"),t("d114")])),"2":(data.retention_days)}));setText('saved-page',data.total?t("d116",{"0":(data.offset+1),"1":(Math.min(data.offset+8,data.total)),"2":(data.total)}):t("d117"));
    $('saved-prev').disabled=data.offset===0;$('saved-next').disabled=data.offset+8>=data.total;updateCompareOptions();
  }catch(error){if(version===state.savedSequence){state.savedLoaded=false;setText('saved-status',t("d118",{"0":(error.message)}));}}
  finally{if(version===state.savedSequence)$('refresh-plans').disabled=false;}
}
async function comparePlans() {
  const a=$('compare-a').value,b=$('compare-b').value;if(!a||!b){setText('plan-comparison',t("d119"));return;}if(a===b){setText('plan-comparison',t("d120"));return;}
  $('compare-plans').disabled=true;setText('plan-comparison',t("d121"));
  try{
    const plans=await Promise.all([api(`/api/v1/optimizations/${encodeURIComponent(a)}`),api(`/api/v1/optimizations/${encodeURIComponent(b)}`)]);state.comparison={plans,a,b};renderComparison(plans,a,b);
  }catch(error){setText('plan-comparison',t('d141',{'0':error.message}));}finally{$('compare-plans').disabled=false;}
}
function renderComparison(plans,a=$('compare-a').value,b=$('compare-b').value) {
    const table=element('table','comparison-table'),thead=element('thead'),header=element('tr');
    for(const value of[t("d122"),t("d123"),t("d124")])header.append(element('th',null,value));thead.append(header);table.append(thead);
    const rows=[[t("d125"),p=>localTime(p.created_at)],[t("d126"),p=>speciesLabels[p.request.species]||p.request.species],[t("d127"),p=>districtLabels[p.request.target_district]||p.request.target_district],[t("d128"),p=>fmt(p.request.budget_trees,0)],[t("d129"),p=>`${fmt(p.used_trees,0)} / ${fmt(p.unused_trees,0)}`],[t("d130"),p=>fmt(p.horizon_years,0)],[t("d131"),p=>fmt(p.costs.first_year_total,0)],[t("d132"),p=>fmt(p.costs.horizon_total,0)],[t("d133"),p=>fmt(p.summary.pm25_before,2)],[t("d134"),p=>fmt(p.summary.pm25_reduction,3)],[t("d135"),p=>fmt(p.summary.cooling_c,3)],[t("d136"),p=>fmt(p.summary.co2_tons_year,2)],[t("d137"),p=>localTime(p.background?.air?.source_time)],[t("d138"),p=>localTime(p.background?.weather?.source_time)]];
    const tbody=element('tbody');for(const[label,value]of rows){const row=element('tr');row.append(element('th',null,label),...plans.map(p=>element('td',null,value(p))));tbody.append(row);}table.append(tbody);
    if($('compare-a').value!==a||$('compare-b').value!==b){setText('plan-comparison',t("d139"));return;}
    $('plan-comparison').replaceChildren(table,element('p','form-note',t("d140")));
}
async function restorePlan() {
  let id;try{id=sessionStorage.getItem('astra:last-plan-id');}catch(_){return;}if(!id)return;
  const sequence=state.planSequence,version=optimizationVersion;
  try{
    const plan=await api(`/api/v1/optimizations/${encodeURIComponent(id)}`);if(sequence!==state.planSequence||version!==optimizationVersion||state.result)return;
    applyParameters(plan.request);renderResult(plan,{activate:!location.hash||location.hash==='#planning',scroll:false});setText('optimization-status',t("d142"));
  }catch(error){if(error.status===404){try{sessionStorage.removeItem('astra:last-plan-id');}catch(_){}setText('optimization-status',t("d143"));}else setText('optimization-status',t("d144",{"0":(error.message)}));}
}
async function loadSensors() {
  const data=await api('/api/v1/sensors'),selected=$('sensor-picker').value,historySelected=$('history-sensor')?.value||'all';
  $('sensor-picker').replaceChildren(option('',t("d145")));if($('history-sensor'))$('history-sensor').replaceChildren(option('all',t("d146")));
  for(const sensor of data.sensors){state.sensors.set(sensor.id,sensor);if(sensor.latest&&(!state.readings.has(sensor.id)||Date.parse(sensor.latest.timestamp)>Date.parse(state.readings.get(sensor.id).timestamp)))state.readings.set(sensor.id,sensor.latest);$('sensor-picker').append(option(sensor.id,`${sensor.id} · ${zoneName(sensor.name)}`));if($('history-sensor'))$('history-sensor').append(option(sensor.id,`${sensor.id} · ${zoneName(sensor.name)}`));}
  $('sensor-picker').value=selected;if($('history-sensor'))$('history-sensor').value=historySelected;updateMarkers();updateHeat();state.loadErrors.delete('sensors');renderDataNotice();
}
async function loadMetrics() {
  const metrics=await api('/api/v1/metrics'),m=metrics.ml;state.metrics=metrics;renderMetrics(m);
  state.loadErrors.delete('metrics');renderDataNotice();
}
function renderMetrics(m) {
  $('model-metrics').textContent=t("d147",{"0":(fmt(m.targets.pm25.mae,2)),"1":(fmt(m.targets.pm25.ml_mae,2)),"2":(fmt(m.targets.esi.mae,2)),"3":(fmt(m.targets.esi.persistence_mae,2)),"4":(fmt(m.test_rows,0)),"5":(fmt(m.train_rows,0))});
  state.loadErrors.delete('metrics');renderDataNotice();
}
async function loadData() {
  if(state.loading)return;state.loading=true;renderDataNotice();
  try{
    if((state.socket?.readyState===WebSocket.OPEN&&!hasFreshData())||
       (state.socket?.readyState===WebSocket.CONNECTING&&Date.now()-state.connectStarted>15000))disconnectSocket();
    connectSocket();
    await Promise.allSettled([
      loadSensors().catch(error=>{state.loadErrors.set('sensors',t("d148",{"0":(error.message)}));renderDataNotice();}),
      loadMetrics().catch(error=>{state.loadErrors.set('metrics',t("d149"));setText('model-metrics',t("d150",{"0":(error.message)}));renderDataNotice();}),
      loadHistory()
    ]);
  }catch(error){state.loadErrors.set('connection',t("d151",{"0":(error.message)}));}
  finally{state.loading=false;renderDataNotice();}
}

async function init() {
  if (!window.L || !window.Plotly) {toast(t("d152"));return;}
  syncChartTheme();initMap();
  $('trees').oninput=()=>{$('trees-output').textContent=fmt(Number($('trees').value),0);};
  $('horizon').oninput=()=>{$('horizon-output').textContent=`${$('horizon').value} ${plural(Number($('horizon').value),[t("d82"),t("d83"),t("d84")])}`;};
  $('trees').oninput();$('horizon').oninput();
  $('optimize-form').onsubmit=runOptimization;$('export-result').onclick=()=>downloadResult();
  $('open-report').onclick=()=>openReport();
  $('close-drawer').onclick=closeSensor;
  $('explain-target').onchange=loadExplanation;
  $('methodology-button').onclick=()=>$('methodology-dialog').showModal();
  $('footer-methodology').onclick=()=>$('methodology-dialog').showModal();
  $('sensor-picker').onchange=()=>{if($('sensor-picker').value)openSensor($('sensor-picker').value);};
  $('close-methodology').onclick=()=>$('methodology-dialog').close();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('sensor-drawer').hidden)$('close-drawer').click();});
  if($('retry-data'))$('retry-data').onclick=loadData;
  if($('history-period'))$('history-period').onchange=loadHistory;if($('history-sensor'))$('history-sensor').onchange=loadHistory;
  if($('refresh-plans'))$('refresh-plans').onclick=()=>loadSavedPlans(0);
  if($('saved-prev'))$('saved-prev').onclick=()=>loadSavedPlans(Math.max(0,state.savedOffset-8));if($('saved-next'))$('saved-next').onclick=()=>loadSavedPlans(state.savedOffset+8);
  if($('compare-plans'))$('compare-plans').onclick=comparePlans;
  window.addEventListener('hashchange',()=>showView(location.hash.slice(1),{updateHash:false}));showView(location.hash.slice(1),{updateHash:false});
  const tick=()=>{setText('clock',new Date().toLocaleTimeString(i18n.locale,{timeZone:'Asia/Qyzylorda'})+' · UTC+5');refreshConnectionStatus();};tick();statusTimer=setInterval(tick,1000);
  document.addEventListener('astra:languagechange',refreshLanguage);
  document.addEventListener('astra:themechange',syncChartTheme);
  await Promise.allSettled([loadData(),restorePlan()]);
}

function syncChartTheme() {
  const css=getComputedStyle(document.documentElement),text=css.getPropertyValue('--chart-text').trim()||'#657266',grid=css.getPropertyValue('--chart-grid').trim()||'#dfe4da';
  layout.font.color=text;layout.xaxis.gridcolor=grid;layout.yaxis.gridcolor=grid;
  if(!window.Plotly)return;
  for(const id of ['telemetry-chart','comparison-chart','shap-chart'])if($(id)?._fullLayout)Plotly.relayout(id,{'font.color':text,'xaxis.gridcolor':grid,'yaxis.gridcolor':grid});
  if($('telemetry-chart')?._fullLayout)Plotly.restyle('telemetry-chart',{'line.color':[css.getPropertyValue('--chart-pm').trim()||'#42745a',css.getPropertyValue('--chart-temp').trim()||'#b98b4d']});
}
function refreshLanguage() {
  refreshLanguageLabels();i18n.apply();
  for(const [key,value] of state.loadErrors)state.loadErrors.set(key,i18n.retranslate(value));
  setText('view-title',views[state.view][0]);setText('view-caption',views[state.view][1]);
  setText('clock',new Date().toLocaleTimeString(i18n.locale,{timeZone:'Asia/Qyzylorda'})+' · UTC+5');
  $('trees').oninput();$('horizon').oninput();
  const selected=$('sensor-picker').value,historySelected=$('history-sensor').value;
  $('sensor-picker').replaceChildren(option('',t('d145')));$('history-sensor').replaceChildren(option('all',t('d146')));
  for(const sensor of state.sensors.values()){
    const label=`${sensor.id} · ${zoneName(sensor.name)}`;
    $('sensor-picker').append(option(sensor.id,label));$('history-sensor').append(option(sensor.id,label));
  }
  $('sensor-picker').value=selected;$('history-sensor').value=historySelected;
  for(const [selector,key] of [['.leaflet-control-zoom-in','d28'],['.leaflet-control-zoom-out','d29']]){
    const node=document.querySelector(selector);if(node){node.title=t(key);node.setAttribute('aria-label',t(key));}
  }
  if(tileErrors)setText('tile-status',t('d30'));
  if(state.background)updateBackground(state.background);
  if(state.summary){setText('kpi-pm',fmt(state.summary.pm25));setText('kpi-temp',fmt(state.summary.surface_temp_c));setText('kpi-sensors',fmt(state.summary.active_sensors,0));setText('kpi-hotspots',fmt(state.summary.critical_hotspots,0));}
  setText('mode',state.mode==='docker'?'PostgreSQL + Redis':t('d39'));
  updateMarkers();renderNetworkSummary();refreshConnectionStatus();
  if(state.history.length||state.view==='analytics')renderTelemetry();
  if(state.metrics)renderMetrics(state.metrics.ml);
  if(state.result)renderResult(state.result,{activate:false,scroll:false});
  if(state.savedPage){
    $('saved-list').replaceChildren(...state.savedPage.map(renderSavedCard));
    if(!state.savedPage.length)$('saved-list').append(element('div','empty-state',t('d111')));
    setText('saved-status',t('d115',{'0':fmt(state.savedTotal,0),'1':plural(state.savedTotal,[t('d112'),t('d113'),t('d114')]),'2':state.savedRetention}));
    setText('saved-page',state.savedTotal?t('d116',{'0':state.savedOffset+1,'1':Math.min(state.savedOffset+8,state.savedTotal),'2':state.savedTotal}):t('d117'));
    updateCompareOptions();
  }
  if(state.comparison)renderComparison(state.comparison.plans,state.comparison.a,state.comparison.b);
  if(state.selected){renderSensorValues();loadExplanation();}
}

document.addEventListener('DOMContentLoaded',init);
window.addEventListener('pagehide',()=>{state.suspended=true;disconnectSocket();clearInterval(statusTimer);});
window.addEventListener('pageshow',event=>{if(event.persisted){state.suspended=false;connectSocket();clearInterval(statusTimer);statusTimer=setInterval(()=>{setText('clock',new Date().toLocaleTimeString(i18n.locale,{timeZone:'Asia/Qyzylorda'})+' · UTC+5');refreshConnectionStatus();},1000);}});
