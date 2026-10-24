'use strict';
const $ = id => document.getElementById(id);
const fmt = (v, digits = 1) => Number.isFinite(Number(v)) && v !== null ? Number(v).toLocaleString('ru-RU', {maximumFractionDigits: digits, minimumFractionDigits: digits}) : '—';
const localTime = value => value ? new Date(value).toLocaleString('ru-RU', {timeZone: 'Asia/Qyzylorda', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : 'нет данных';
const plural = (n, forms) => { const a=Math.abs(n)%100,b=a%10; return forms[a>10&&a<20?2:b===1?0:b>=2&&b<=4?1:2]; };
const state = {sensors: new Map(), readings: new Map(), markers: new Map(), selected: null, result: null, history: [], socket: null, heat: null, shapSequence: 0};
const layout = {paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: {family: 'Segoe UI, Arial', color: '#8c9eaf', size: 10}, margin: {l: 48, r: 48, t: 15, b: 40}, showlegend: false, xaxis: {gridcolor: '#233142', zeroline: false}, yaxis: {gridcolor: '#233142', zeroline: false}};
const plotConfig = {responsive: true, displayModeBar: false, locale: 'ru'};
let map, tileErrors = 0, reconnectTimer, toastTimer, optimizationVersion = 0;

async function api(url, options) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(30000)});
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try { const body = await response.json(); message = typeof body.detail === 'string' ? body.detail : 'Проверьте параметры запроса'; } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 7000); }
function colour(esi) { return esi >= 60 ? '#ef8593' : esi >= 30 ? '#f0c773' : '#65e6bd'; }

function initMap() {
  map = L.map('map', {zoomControl: false, preferCanvas: false}).setView([51.151, 71.447], 12);
  L.control.zoom({position:'bottomright',zoomInTitle:'Приблизить',zoomOutTitle:'Отдалить'}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'})
    .on('tileerror', () => { tileErrors++; $('tile-status').textContent = 'Подложка недоступна · узлы остаются расчётными'; }).addTo(map);
  $('heat-toggle').addEventListener('change', updateHeat);
}
function updateHeat() {
  if (state.heat) { map.removeLayer(state.heat); state.heat = null; }
  if ($('heat-toggle').checked && state.readings.size) {
    state.heat = L.heatLayer([...state.readings.values()].map(r => { const s = state.sensors.get(r.sensor_id); return [s.latitude, s.longitude, Math.max(.1, r.esi / 100)]; }), {radius: 35, blur: 27, maxZoom: 14, max: 1, gradient: {.15:'#346d79',.4:'#65e6bd',.7:'#f0c773',1:'#ef8593'}}).addTo(map);
  }
}
function updateMarkers() {
  const allocated = new Set((state.result?.zones || []).map(z => z.id));
  for (const [id, s] of state.sensors) {
    const r = state.readings.get(id); if (!r) continue;
    const selected = allocated.has(id), c = selected ? '#67ffb4' : colour(r.esi);
    let marker = state.markers.get(id);
    if (!marker) { marker = L.circleMarker([s.latitude, s.longitude], {radius: 7, weight: 2, fillOpacity: .7, className:'station-marker'}).addTo(map).on('click', () => openSensor(id)); state.markers.set(id, marker); }
    marker.setStyle({color: c, fillColor: c, radius: selected ? 11 : state.selected === id ? 10 : 7, weight: selected ? 3 : 2});
    marker.bindTooltip(`${s.name} · PM2.5 ${fmt(r.pm25)} · ESI ${fmt(r.esi)}`, {direction: 'top'});
  }
}
function updateBackground(bg) {
  const labels = {live: 'ответ API', cached: 'кэш', default: 'резервный сценарий'};
  const a = bg.air, w = bg.weather;
  $('source-detail').textContent = `Воздух: ${labels[a.status]}, данные ${localTime(a.source_time)}, получены ${localTime(a.fetched_at)}. Погода: ${labels[w.status]}, данные ${localTime(w.source_time)}, получены ${localTime(w.fetched_at)}. Время UTC+5.`;
  $('source-badge').textContent = a.status === 'live' && w.status === 'live' ? 'API ПОДКЛЮЧЁН' : 'ЧАСТИЧНО / РЕЗЕРВ';
  $('source-badge').style.color = a.status === 'live' && w.status === 'live' ? '#65e6bd' : '#f0c773';
  $('kpi-aqi').textContent = fmt(a.values.european_aqi, 0);
  $('aqi-label').textContent = a.status === 'default' ? 'нет фона API' : 'EAQI';
}
function updateDashboard(payload) {
  for (const r of payload.readings || []) state.readings.set(r.sensor_id, r);
  const s = payload.summary;
  if (s) { $('kpi-pm').textContent = fmt(s.pm25); $('kpi-temp').textContent = fmt(s.surface_temp_c); $('kpi-sensors').textContent = fmt(s.active_sensors, 0); $('kpi-hotspots').textContent = s.critical_hotspots; }
  if (payload.background) updateBackground(payload.background);
  $('mode').textContent = payload.mode === 'docker' ? 'PostgreSQL + Redis' : 'Локальная демонстрация';
  if (payload.type === 'snapshot' && payload.history?.length) state.history = payload.history.slice(-300);
  else if (s) { state.history.push({timestamp: payload.timestamp, ...s}); state.history = state.history.slice(-300); }
  updateMarkers(); updateHeat(); renderTelemetry();
  if (state.selected) renderSensorValues();
}
function renderTelemetry() {
  const x = state.history.map(p => new Date(new Date(p.timestamp).getTime()+5*3600000).toISOString().slice(0,-1));
  Plotly.react('telemetry-chart', [
    {x, y: state.history.map(p => p.pm25), type:'scatter', mode:'lines', name:'PM2.5, мкг/м³', line:{color:'#65e6bd',width:2}, fill:'tozeroy', fillcolor:'rgba(101,230,189,.035)', hovertemplate:'PM2.5: %{y:.2f} мкг/м³<extra></extra>'},
    {x, y: state.history.map(p => p.surface_temp_c), type:'scatter', mode:'lines', name:'Поверхность, °C', yaxis:'y2', line:{color:'#f0c773',width:2}, hovertemplate:'Поверхность: %{y:.2f} °C<extra></extra>'}
  ], {...layout, uirevision:'stream', xaxis:{...layout.xaxis,type:'date',tickformat:'%H:%M:%S',hoverformat:'%d.%m %H:%M:%S',title:{text:'Время Астаны · UTC+5',font:{size:9}}}, yaxis:{...layout.yaxis,title:'мкг/м³'}, yaxis2:{overlaying:'y',side:'right',showgrid:false,zeroline:false,title:'°C'}, hovermode:'x unified'}, plotConfig);
}
function connectSocket() {
  clearTimeout(reconnectTimer);
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/telemetry`);
  state.socket = socket;
  socket.onopen = () => { $('connection').textContent = '● Поток подключён'; $('connection').classList.add('live'); };
  socket.onmessage = event => { try { updateDashboard(JSON.parse(event.data)); } catch (error) { console.error(error); } };
  socket.onclose = () => { $('connection').textContent = '● Переподключение'; $('connection').classList.remove('live'); reconnectTimer = setTimeout(connectSocket, 2000); };
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
  $('sensor-name').textContent = s.name;
  $('sensor-coordinates').textContent = `${s.id} · ${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)} · условный NDVI ${s.ndvi}`;
  $('sensor-values').replaceChildren(...[
    ['PM2.5',r.pm25,'мкг/м³'],['PM10',r.pm10,'мкг/м³'],['NO₂',r.no2,'мкг/м³'],['CO',r.co,'мкг/м³'],['CO₂ · симуляция',r.co2,'ppm'],['ESI · условный',r.esi,'/100'],['Воздух',r.air_temp_c,'°C'],['Поверхность · расчёт',r.surface_temp_c,'°C'],['Ветер',r.wind_speed,'м/с'],['Влажность',r.humidity,'%']
  ].map(v => sensorValue(...v)));
  $('sensor-forecast').textContent = `PM2.5 — основной: ${fmt(r.predicted_pm25)} мкг/м³ (сохранение текущего значения). Экспериментальный ML: ${fmt(r.predicted_pm25_ml)} мкг/м³. ESI — ML: ${fmt(r.predicted_esi)} / 100.`;
}
async function openSensor(id) {
  state.selected = id; $('sensor-picker').value=id; $('sensor-drawer').hidden = false; renderSensorValues(); updateMarkers(); await loadExplanation();
}
async function loadExplanation() {
  const id = state.selected, selected = $('explain-target').value, version = ++state.shapSequence;
  const target = selected === 'pm25_ml' ? 'pm25' : selected;
  const method = selected === 'pm25_ml' ? 'ml' : 'primary';
  $('shap-chart').hidden = true;
  $('shap-status').textContent = 'Загрузка объяснения…';
  try {
    const data = await api(`/api/v1/analytics/explain/${encodeURIComponent(id)}?target=${target}&method=${method}`);
    if (version !== state.shapSequence || state.selected !== id) return;
    if (data.explanation_kind === 'persistence_rule') {
      $('shap-status').textContent = `PM2.5 через 3 часа = текущие PM2.5: ${fmt(data.prediction,2)} ${data.units}. Это основной прогноз по правилу сохранения значения. Значение зафиксировано на момент запроса. Для сравнения выберите экспериментальный ML.`;
      return;
    }
    $('shap-chart').hidden = false;
    const f = data.features.slice(0,8).reverse();
    Plotly.react('shap-chart',[{type:'bar',orientation:'h',x:f.map(v=>v.contribution),y:f.map(v=>v.label),marker:{color:f.map(v=>v.contribution>=0?'#ef8593':'#65e6bd')},hovertemplate:'%{y}: %{x:.3f}<extra></extra>'}],{...layout,margin:{l:152,r:15,t:20,b:35},xaxis:{...layout.xaxis,title:{text:`Вклад в ${data.units}`,font:{size:10}},zeroline:true,zerolinecolor:'#6d7d8d'},yaxis:{...layout.yaxis,automargin:true}},plotConfig);
    $('shap-status').textContent = `${data.forecast_role==='experimental'?'Экспериментальный ML. ':''}Базовое значение ${fmt(data.base_value,2)} + вклады SHAP = ${fmt(data.prediction_raw,2)} ${data.units}. ${data.clipping_applied?'Показанный прогноз ограничен физическим диапазоном.':''} Объяснение зафиксировано на момент запроса.`;
  } catch (error) { if (version === state.shapSequence) $('shap-status').textContent = error.message; }
}
function resultCard(label,value,unit,detail) { const d=document.createElement('div');d.className='result-kpi';const l=document.createElement('small');l.textContent=label;const v=document.createElement('strong');v.textContent=`${value} ${unit}`;const s=document.createElement('span');s.textContent=detail;d.append(l,v,s);return d; }
function renderResult(result) {
  state.result = result;
  const s = result.summary, cost = result.costs;
  $('results').hidden = false;
  $('result-description').textContent = `${result.zones.length} ${plural(result.zones.length,['зона','зоны','зон'])} · распределено ${fmt(result.used_trees,0)} деревьев · остаток ${fmt(result.unused_trees,0)} · горизонт ${result.horizon_years} ${plural(result.horizon_years,['год','года','лет'])}. Смета первого года: ${fmt(cost.first_year_total,0)} ₸; за горизонт: ${fmt(cost.horizon_total,0)} ₸. Цены сценарные.`;
  $('result-kpis').replaceChildren(
    resultCard('Снижение PM2.5',fmt(s.pm25_reduction,2),'мкг/м³',`${fmt(s.pm25_reduction_pct,1)}% · диапазон ${s.pm25_reduction_range.map(v=>fmt(v,2)).join('–')}`),
    resultCard('Охлаждение поверхности',fmt(s.cooling_c,2),'°C',`Диапазон ${s.cooling_c_range.map(v=>fmt(v,2)).join('–')} °C`),
    resultCard('Связывание CO₂',fmt(s.co2_tons_year,2),'т/год',`На горизонте ${result.horizon_years} лет`),
    resultCard('Условный охват',fmt(s.population_covered,0),'чел.', 'Население демонстрационных зон'));
  $('zones-table').replaceChildren(...result.zones.map(z=>{const tr=document.createElement('tr');for(const v of [z.name,fmt(z.trees,0),`−${fmt(z.pm25_reduction,2)}`,`−${fmt(z.cooling_c,2)}`]){const td=document.createElement('td');td.textContent=v;tr.append(td);}return tr;}));
  Plotly.react('comparison-chart',[
    {type:'bar',name:'До',x:['PM2.5, мкг/м³'],y:[s.pm25_before],marker:{color:'#516879'}},
    {type:'bar',name:'После',x:['PM2.5, мкг/м³'],y:[s.pm25_after],marker:{color:'#65e6bd'}}
  ],{...layout,showlegend:true,barmode:'group',legend:{orientation:'h',y:1.15},margin:{l:45,r:15,t:35,b:40},yaxis:{...layout.yaxis,title:'мкг/м³'}},plotConfig);
  updateMarkers();
  $('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
async function runOptimization(event) {
  event.preventDefault(); const version = ++optimizationVersion;
  $('optimize-button').disabled = true; $('optimization-status').textContent = 'Распределяем деревья и рассчитываем эффект…';
  const body = {budget_trees:Number($('trees').value),species:$('species').value,target_district:$('district').value,horizon_years:Number($('horizon').value),sapling_cost_kzt:Number($('sapling-cost').value),planting_cost_kzt:Number($('planting-cost').value),annual_care_cost_kzt:Number($('care-cost').value),pilot_equipment_cost_kzt:Number($('equipment-cost').value),annual_platform_cost_kzt:Number($('platform-cost').value)};
  try { const result = await api('/api/v1/optimize/greening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if(version!==optimizationVersion)return;renderResult(result);$('optimization-status').textContent=`План рассчитан: ${result.zones.length} ${plural(result.zones.length,['зона','зоны','зон'])}. Исходные данные и смета доступны в JSON.`; }
  catch(error){$('optimization-status').textContent=error.message;toast(error.message);}finally{$('optimize-button').disabled=false;}
}
function downloadResult() {if(!state.result)return;const blob=new Blob([JSON.stringify(state.result,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`astra-plan-${state.result.run_id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

function openReport() {
  if (!state.result) return;
  try {
    // Keep the exact calculation snapshot within this tab; do not recalculate on navigation.
    sessionStorage.setItem('astra:report:current', JSON.stringify(state.result));
    location.assign('/static/report/report.html?source=dashboard');
  } catch (_) {
    toast('Не удалось передать расчёт в отчёт. Скачайте JSON и откройте «Отчёт из JSON» внизу страницы.');
  }
}

async function init() {
  if (!window.L || !window.Plotly) {toast('Не найдены локальные библиотеки интерфейса. Выполните python scripts/vendor_assets.py');return;}
  initMap();
  $('trees').oninput=()=>{$('trees-output').textContent=fmt(Number($('trees').value),0);};
  $('horizon').oninput=()=>{$('horizon-output').textContent=`${$('horizon').value} ${plural(Number($('horizon').value),['год','года','лет'])}`;};
  $('optimize-form').onsubmit=runOptimization;$('export-result').onclick=downloadResult;
  $('open-report').onclick=openReport;
  $('close-drawer').onclick=()=>{$('sensor-drawer').hidden=true;state.selected=null;state.shapSequence++;updateMarkers();};
  $('explain-target').onchange=loadExplanation;
  $('methodology-button').onclick=()=>$('methodology-dialog').showModal();
  $('footer-methodology').onclick=()=>$('methodology-dialog').showModal();
  $('sensor-picker').onchange=()=>{if($('sensor-picker').value)openSensor($('sensor-picker').value);};
  $('close-methodology').onclick=()=>$('methodology-dialog').close();
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('sensor-drawer').hidden)$('close-drawer').click();});
  setInterval(()=>{$('clock').textContent=new Date().toLocaleTimeString('ru-RU',{timeZone:'Asia/Qyzylorda'})+' · UTC+5';},1000);
  try {
    const [sensors, metrics, history] = await Promise.all([api('/api/v1/sensors'),api('/api/v1/metrics'),api('/api/v1/telemetry/history?minutes=60')]);
    for(const s of sensors.sensors){state.sensors.set(s.id,s);if(s.latest)state.readings.set(s.id,s.latest);const option=document.createElement('option');option.value=s.id;option.textContent=`${s.id} · ${s.name}`;$('sensor-picker').append(option);}
    state.history=history.points;
    updateMarkers();renderTelemetry();connectSocket();
    const m=metrics.ml;
    $('model-metrics').textContent=`Горизонт 3 ч · MAE PM2.5: основной «как сейчас» ${fmt(m.targets.pm25.mae,2)}, экспериментальный ML ${fmt(m.targets.pm25.ml_mae,2)} мкг/м³ · MAE ESI: ML ${fmt(m.targets.esi.mae,2)}, «как сейчас» ${fmt(m.targets.esi.persistence_mae,2)}. Известный синтетический контроль: ${fmt(m.test_rows,0)} строк; обучение ML: ${fmt(m.train_rows,0)}. Точность для реальной Астаны не установлена.`;
  } catch(error){toast(`Не удалось загрузить данные: ${error.message}. Перезагрузите страницу после запуска сервера.`);}
}
document.addEventListener('DOMContentLoaded',init);
window.addEventListener('pageshow', event => { if (event.persisted) connectSocket(); });
window.addEventListener('beforeunload',()=>{clearTimeout(reconnectTimer);if(state.socket){state.socket.onclose=null;state.socket.close();}});
