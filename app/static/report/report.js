(function () {
  "use strict";

  const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 МБ
  const SVG_NS = "http://www.w3.org/2000/svg";
  const REPORT_TIMEZONE = "Asia/Qyzylorda";

  const DISTRICT_LABELS = Object.freeze({
    all: "Все пилотные районы",
    yesil: "Есиль",
    nura: "Нура",
    almaty: "Алматы",
    saryarka: "Сарыарка",
    baikonyr: "Байконыр",
  });

  const SPECIES_LABELS = Object.freeze({
    elm: "Вяз",
    pine: "Сосна",
    poplar: "Тополь",
  });

  const POP_KIND_LABELS = Object.freeze({
    scenario_disjoint_cells: "Условные непересекающиеся ячейки",
  });

  const COST_KIND_LABELS = Object.freeze({
    editable_scenario_assumptions: "Редактируемые сценарные допущения",
  });

  const BG_VALUE_LABELS = Object.freeze({
    pm25: ["PM2.5", "мкг/м³"],
    pm2_5: ["PM2.5", "мкг/м³"],
    pm10: ["PM10", "мкг/м³"],
    no2: ["NO₂", "мкг/м³"],
    nitrogen_dioxide: ["NO₂", "мкг/м³"],
    co: ["CO", "мкг/м³"],
    carbon_monoxide: ["CO", "мкг/м³"],
    european_aqi: ["European AQI", "индекс"],
    aqi: ["AQI", "индекс"],
    air_temp_c: ["Воздух", "°C"],
    temperature_2m: ["Воздух", "°C"],
    surface_temp_c: ["Поверхность", "°C"],
    humidity: ["Влажность", "%"],
    relative_humidity_2m: ["Влажность", "%"],
    wind_speed: ["Ветер", "м/с"],
    wind_speed_10m: ["Ветер", "м/с"],
    wind_direction: ["Направление ветра", "°"],
    wind_direction_10m: ["Направление ветра", "°"],
  });

  const reportI18n = () => typeof window !== "undefined" ? window.ReportI18n : null;
  const localeText = value => reportI18n()?.text(value) ?? value;
  const localizeDocument = doc => reportI18n()?.apply(doc);
  let intFmt, dec2Fmt, dec3Fmt, dec1Fmt, moneyFracFmt, tzDateFmt;
  function configureFormats() {
    const locale = reportI18n()?.locale || "ru-RU";
    intFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    dec2Fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    dec3Fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    dec1Fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    moneyFracFmt = dec2Fmt;
    try {
      tzDateFmt = new Intl.DateTimeFormat(locale, { timeZone: REPORT_TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    } catch (_) { tzDateFmt = null; }
  }
  configureFormats();

  function isPlainObject(val) {
    return typeof val === "object" && val !== null && !Array.isArray(val);
  }

  function isFiniteNum(val) {
    return typeof val === "number" && Number.isFinite(val);
  }

  function isNonNegInt(val) {
    return Number.isInteger(val) && Number.isFinite(val) && val >= 0;
  }

  function normalizeZero(n) {
    return Object.is(n, -0) || Math.abs(n) < 1e-12 ? 0 : n;
  }

  function formatInt(n) {
    return intFmt.format(Math.round(normalizeZero(n)));
  }

  function formatMetric(n) {
    const clean = normalizeZero(n);
    if (clean !== 0 && Math.abs(clean) < 0.01) {
      return dec3Fmt.format(clean);
    }
    return dec2Fmt.format(clean);
  }

  function formatPct(n) {
    const clean = normalizeZero(n);
    if (clean !== 0 && Math.abs(clean) < 0.1) {
      return dec2Fmt.format(clean);
    }
    return dec1Fmt.format(clean);
  }

  function formatMoney(n, currencyLabel) {
    const clean = normalizeZero(n);
    const numStr = Number.isInteger(clean) ? intFmt.format(clean) : moneyFracFmt.format(clean);
    return currencyLabel ? `${numStr} ${currencyLabel}` : numStr;
  }

  function pluralizeRu(count, one, few, many) {
    const abs = Math.abs(Math.trunc(count));
    const mod100 = abs % 100;
    const mod10 = abs % 10;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function parseIsoUtc(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const match =
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
        trimmed
      );
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] !== undefined ? Number(match[4]) : 0;
    const minute = match[5] !== undefined ? Number(match[5]) : 0;
    const second = match[6] !== undefined ? Number(match[6]) : 0;
    const msStr = match[7] ? match[7].slice(0, 3).padEnd(3, "0") : "000";
    const msPart = Number(msStr);

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }

    // Verify calendar day does not overflow (e.g. Feb 30)
    const utcCheck = new Date(Date.UTC(year, month - 1, day, hour, minute, second, msPart));
    if (
      utcCheck.getUTCFullYear() !== year ||
      utcCheck.getUTCMonth() !== month - 1 ||
      utcCheck.getUTCDate() !== day
    ) {
      return null;
    }

    let offsetMinutes = 0;
    const tzToken = match[8];
    if (tzToken && tzToken.toUpperCase() !== "Z") {
      const sign = tzToken[0] === "-" ? -1 : 1;
      const digits = tzToken.slice(1).replace(":", "");
      const offH = Number(digits.slice(0, 2));
      const offM = Number(digits.slice(2, 4));
      if (offH > 23 || offM > 59) return null;
      offsetMinutes = sign * (offH * 60 + offM);
    }

    const epochMs = utcCheck.getTime() - offsetMinutes * 60 * 1000;
    return Number.isFinite(epochMs) ? epochMs : null;
  }

  function formatUtcPlus5(raw, emptyText) {
    if (raw === null || raw === undefined || raw === "") {
      return emptyText;
    }
    const epochMs = parseIsoUtc(raw);
    if (epochMs === null) {
      return emptyText;
    }
    if (tzDateFmt) {
      return `${tzDateFmt.format(new Date(epochMs))} (UTC+5)`;
    }
    const shifted = new Date(epochMs + 5 * 3600 * 1000);
    const pad = (v) => String(v).padStart(2, "0");
    return `${pad(shifted.getUTCDate())}.${pad(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()}, ${pad(
      shifted.getUTCHours()
    )}:${pad(shifted.getUTCMinutes())} (UTC+5)`;
  }

  function sanitizeHttpUrl(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.href;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function validateRangePair(val, fieldLabel, errors, allowNegative) {
    if (!Array.isArray(val) || val.length !== 2) {
      errors.push(`Поле «${fieldLabel}» должно быть массивом из двух чисел [мин, макс].`);
      return;
    }
    if (!isFiniteNum(val[0]) || !isFiniteNum(val[1])) {
      errors.push(`Поле «${fieldLabel}» содержит некорректные или бесконечные числа.`);
      return;
    }
    if (!allowNegative && (val[0] < 0 || val[1] < 0)) {
      errors.push(`Поле «${fieldLabel}» не может содержать отрицательные значения.`);
    }
    if (val[0] > val[1]) {
      errors.push(`В поле «${fieldLabel}» нижняя граница превышает верхнюю.`);
    }
  }

  function validateReportData(data) {
    const errors = [];

    if (!isPlainObject(data)) {
      return {
        valid: false,
        errors: ["Корневой элемент JSON должен быть объектом расчёта озеленения."],
      };
    }

    if (typeof data.run_id !== "string" || !data.run_id.trim()) {
      errors.push("Отсутствует или некорректен идентификатор расчёта «run_id».");
    }

    if (data.created_at !== null && data.created_at !== undefined) {
      if (parseIsoUtc(data.created_at) === null) {
        errors.push("Поле «created_at» должно быть строкой даты ISO UTC или null.");
      }
    }

    if (!isNonNegInt(data.horizon_years) || data.horizon_years < 1) {
      errors.push("Поле «horizon_years» должно быть целым положительным числом лет.");
    }

    if (!isNonNegInt(data.used_trees)) {
      errors.push("Поле «used_trees» должно быть целым неотрицательным числом.");
    }

    if (!isNonNegInt(data.unused_trees)) {
      errors.push("Поле «unused_trees» должно быть целым неотрицательным числом.");
    }

    if (typeof data.note !== "string") {
      errors.push("Поле «note» должно быть текстовой строкой.");
    }

    // Request validation
    if (!isPlainObject(data.request)) {
      errors.push("Отсутствует обязательный раздел параметров запроса «request».");
    } else {
      const req = data.request;
      if (!isNonNegInt(req.budget_trees)) {
        errors.push("Поле «request.budget_trees» должно быть целым неотрицательным числом.");
      }
      if (typeof req.species !== "string" || !Object.prototype.hasOwnProperty.call(SPECIES_LABELS, req.species)) {
        errors.push("Поле «request.species» должно иметь одно из допустимых значений: elm, pine или poplar.");
      }
      if (typeof req.target_district !== "string" || !req.target_district.trim()) {
        errors.push("Поле «request.target_district» должно быть непустой строкой.");
      }
      if (!isNonNegInt(req.horizon_years) || req.horizon_years < 1) {
        errors.push("Поле «request.horizon_years» должно быть целым положительным числом.");
      }

      const costRateKeys = [
        "sapling_cost_kzt",
        "planting_cost_kzt",
        "annual_care_cost_kzt",
        "pilot_equipment_cost_kzt",
        "annual_platform_cost_kzt",
      ];
      for (const key of costRateKeys) {
        if (!isFiniteNum(req[key]) || req[key] < 0) {
          errors.push(`Поле «request.${key}» должно быть конечным неотрицательным числом.`);
        }
      }
    }

    // Summary validation
    if (!isPlainObject(data.summary)) {
      errors.push("Отсутствует обязательный раздел сводных показателей «summary».");
    } else {
      const sum = data.summary;
      const nonNegSummaryKeys = [
        "pm25_before",
        "pm25_after",
        "pm25_reduction",
        "pm25_reduction_pct",
        "cooling_c",
        "co2_tons_year",
        "population_covered",
      ];
      for (const key of nonNegSummaryKeys) {
        if (!isFiniteNum(sum[key]) || sum[key] < 0) {
          errors.push(`Поле «summary.${key}» должно быть конечным неотрицательным числом.`);
        }
      }
      if (!isFiniteNum(sum.surface_temp_before)) {
        errors.push("Поле «summary.surface_temp_before» должно быть конечным числом.");
      }
      if (!isFiniteNum(sum.surface_temp_after)) {
        errors.push("Поле «summary.surface_temp_after» должно быть конечным числом.");
      }
      if (typeof sum.population_kind !== "string" || !sum.population_kind.trim()) {
        errors.push("Поле «summary.population_kind» должно быть непустой строкой.");
      }
      if (typeof sum.range_kind !== "string" || !sum.range_kind.trim()) {
        errors.push("Поле «summary.range_kind» должно быть непустой строкой.");
      }

      validateRangePair(sum.pm25_reduction_range, "summary.pm25_reduction_range", errors, false);
      validateRangePair(sum.cooling_c_range, "summary.cooling_c_range", errors, false);
      validateRangePair(sum.co2_tons_year_range, "summary.co2_tons_year_range", errors, false);
    }

    // Zones validation
    if (!Array.isArray(data.zones)) {
      errors.push("Раздел «zones» должен быть массивом участков.");
    } else {
      for (let i = 0; i < data.zones.length; i += 1) {
        const z = data.zones[i];
        const prefix = `zones[${i}]`;
        if (!isPlainObject(z)) {
          errors.push(`Элемент «${prefix}» должен быть объектом.`);
          continue;
        }
        if (typeof z.id !== "string" || !z.id.trim()) {
          errors.push(`Поле «${prefix}.id» должно быть непустой строкой.`);
        }
        if (typeof z.name !== "string" || !z.name.trim()) {
          errors.push(`Поле «${prefix}.name» должно быть непустой строкой.`);
        }
        if (typeof z.district_name !== "string" || !z.district_name.trim()) {
          errors.push(`Поле «${prefix}.district_name» должно быть непустой строкой.`);
        }
        if (!isFiniteNum(z.latitude) || z.latitude < -90 || z.latitude > 90) {
          errors.push(`Поле «${prefix}.latitude» должно быть конечной широтой от -90 до 90.`);
        }
        if (!isFiniteNum(z.longitude) || z.longitude < -180 || z.longitude > 180) {
          errors.push(`Поле «${prefix}.longitude» должно быть конечной долготой от -180 до 180.`);
        }
        if (!isNonNegInt(z.trees)) {
          errors.push(`Поле «${prefix}.trees» должно быть целым неотрицательным числом.`);
        }
        const zMetrics = [
          "pm25_before",
          "pm25_after",
          "pm25_reduction",
          "cooling_c",
          "co2_tons_year",
          "population_covered",
        ];
        for (const key of zMetrics) {
          if (!isFiniteNum(z[key]) || z[key] < 0) {
            errors.push(`Поле «${prefix}.${key}» должно быть конечным неотрицательным числом.`);
          }
        }
        const optZoneNums = [
          "surface_temp_before",
          "surface_temp_after",
          "pm25_reduction_pct",
          "surviving_trees",
          "canopy_m2",
          "area_m2",
          "ndvi",
          "priority_score",
        ];
        for (const optKey of optZoneNums) {
          if (z[optKey] !== undefined && z[optKey] !== null && !isFiniteNum(z[optKey])) {
            errors.push(`Необязательное поле «${prefix}.${optKey}» содержит некорректное число.`);
          }
        }
        if (errors.length >= 12) {
          errors.push("Проверка остановлена: обнаружено слишком много ошибок в списке зон.");
          break;
        }
      }
    }

    // Costs validation
    if (!isPlainObject(data.costs)) {
      errors.push("Отсутствует обязательный раздел сметы «costs».");
    } else {
      const c = data.costs;
      if (typeof c.currency !== "string" || !c.currency.trim()) {
        errors.push("Поле «costs.currency» должно быть непустой строкой валюты.");
      }
      if (typeof c.kind !== "string" || !c.kind.trim()) {
        errors.push("Поле «costs.kind» должно быть непустой строкой.");
      }
      const costKeys = [
        "planting",
        "annual_care",
        "equipment",
        "annual_platform",
        "first_year_total",
        "horizon_total",
      ];
      for (const key of costKeys) {
        if (!isFiniteNum(c[key]) || c[key] < 0) {
          errors.push(`Поле «costs.${key}» должно быть конечным неотрицательным числом.`);
        }
      }
    }

    // Background validation (optional / fallback-aware)
    if (data.background !== undefined && data.background !== null) {
      if (!isPlainObject(data.background)) {
        errors.push("Раздел «background» должен быть объектом или null.");
      } else {
        for (const ch of ["air", "weather"]) {
          const item = data.background[ch];
          if (item === undefined || item === null) continue;
          if (!isPlainObject(item)) {
            errors.push(`Раздел «background.${ch}» должен быть объектом или null.`);
            continue;
          }
          if (item.status !== undefined && item.status !== null && typeof item.status !== "string") {
            errors.push(`Поле «background.${ch}.status» должно быть строкой.`);
          }
          if (
            item.source_time !== undefined &&
            item.source_time !== null &&
            parseIsoUtc(item.source_time) === null
          ) {
            errors.push(`Поле «background.${ch}.source_time» должно быть датой ISO UTC или null.`);
          }
          if (
            item.fetched_at !== undefined &&
            item.fetched_at !== null &&
            parseIsoUtc(item.fetched_at) === null
          ) {
            errors.push(`Поле «background.${ch}.fetched_at» должно быть датой ISO UTC или null.`);
          }
          if (item.values !== undefined && item.values !== null) {
            if (!isPlainObject(item.values)) {
              errors.push(`Поле «background.${ch}.values» должно быть объектом или null.`);
            } else {
              for (const [vKey, vVal] of Object.entries(item.values)) {
                if (vKey === "european_aqi" && vVal === null) continue;
                if (!isFiniteNum(vVal)) {
                  errors.push(`Значение «background.${ch}.values.${vKey}» должно быть конечным числом${vKey === "european_aqi" ? " или null" : ""}.`);
                }
              }
            }
          }
        }
      }
    }

    // Methodology validation
    if (!isPlainObject(data.methodology)) {
      errors.push("Отсутствует обязательный раздел методики «methodology».");
    } else {
      const m = data.methodology;
      if (typeof m.version !== "string" || !m.version.trim()) {
        errors.push("Поле «methodology.version» должно быть непустой строкой.");
      }
      if (typeof m.note !== "string") {
        errors.push("Поле «methodology.note» должно быть строкой.");
      }
      if (!Array.isArray(m.sources) || !m.sources.every((s) => typeof s === "string")) {
        errors.push("Поле «methodology.sources» должно быть массивом строк.");
      }
      if (m.species_parameters !== undefined && m.species_parameters !== null) {
        if (!isPlainObject(m.species_parameters)) {
          errors.push("Поле «methodology.species_parameters» должно быть объектом.");
        } else {
          for (const [spKey, spVal] of Object.entries(m.species_parameters)) {
            if (typeof spVal === "number" && !Number.isFinite(spVal)) {
              errors.push(`Параметр породы «${spKey}» содержит неконечное число.`);
            }
          }
        }
      }
      if (m.sensitivity_factors !== undefined && m.sensitivity_factors !== null) {
        validateRangePair(m.sensitivity_factors, "methodology.sensitivity_factors", errors, false);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
      }
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function clearChildren(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function renderAllocationSvg(container, usedTrees, unusedTrees, budgetTrees) {
    clearChildren(container);
    const totalSpan = Math.max(usedTrees + unusedTrees, budgetTrees, 1);
    const barW = 400;
    const usedW = Math.min(barW, Math.max(0, (usedTrees / totalSpan) * barW));

    const legend = container.ownerDocument.createElement("div");
    legend.className = "alloc-legend";
    const leftText = container.ownerDocument.createElement("span");
    leftText.textContent = `Освоение посадочного бюджета: ${formatInt(usedTrees)} распр. / ${formatInt(
      unusedTrees
    )} остаток`;
    const rightText = container.ownerDocument.createElement("strong");
    rightText.textContent = `Бюджет: ${formatInt(budgetTrees)} шт.`;
    legend.appendChild(leftText);
    legend.appendChild(rightText);
    container.appendChild(legend);

    const svg = svgEl("svg", {
      class: "report-svg",
      viewBox: "0 0 400 10",
      role: "img",
      "aria-label": `Распределено ${formatInt(usedTrees)} из ${formatInt(budgetTrees)} деревьев`,
    });

    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: barW, height: 10, rx: 4, class: "svg-track" }));
    if (usedW > 0) {
      svg.appendChild(
        svgEl("rect", { x: 0, y: 0, width: usedW, height: 10, rx: 4, class: "svg-bar-after" })
      );
    }

    container.appendChild(svg);
  }

  function renderBeforeAfterSvg(container, summary) {
    clearChildren(container);
    const svg = svgEl("svg", {
      class: "report-svg",
      viewBox: "0 0 380 148",
      role: "img",
      "aria-label": "График сравнения показателей PM2.5 и температуры поверхности до и после",
    });

    const trackX = 64;
    const trackW = 198;
    const valX = 376;

    // Group 1: PM2.5 (non-negative scale from 0)
    const pmMax = Math.max(summary.pm25_before, summary.pm25_after, 1);
    const pmBeforeW = (summary.pm25_before / pmMax) * trackW;
    const pmAfterW = (summary.pm25_after / pmMax) * trackW;

    svg.appendChild(svgEl("text", { x: 0, y: 14, class: "svg-val" }, "PM2.5 (мкг/м³)"));

    svg.appendChild(svgEl("text", { x: 0, y: 34, class: "svg-label" }, "До"));
    svg.appendChild(svgEl("rect", { x: trackX, y: 24, width: trackW, height: 11, rx: 3, class: "svg-track" }));
    if (pmBeforeW > 0) {
      svg.appendChild(
        svgEl("rect", { x: trackX, y: 24, width: pmBeforeW, height: 11, rx: 3, class: "svg-bar-before" })
      );
    }
    svg.appendChild(
      svgEl("text", { x: valX, y: 34, "text-anchor": "end", class: "svg-val" }, formatMetric(summary.pm25_before))
    );

    svg.appendChild(svgEl("text", { x: 0, y: 54, class: "svg-label" }, "После"));
    svg.appendChild(svgEl("rect", { x: trackX, y: 44, width: trackW, height: 11, rx: 3, class: "svg-track" }));
    if (pmAfterW > 0) {
      svg.appendChild(
        svgEl("rect", { x: trackX, y: 44, width: pmAfterW, height: 11, rx: 3, class: "svg-bar-after" })
      );
    }
    svg.appendChild(
      svgEl("text", { x: valX, y: 54, "text-anchor": "end", class: "svg-val" }, formatMetric(summary.pm25_after))
    );

    svg.appendChild(svgEl("line", { x1: 0, y1: 71, x2: 380, y2: 71, class: "svg-axis" }));

    // Group 2: Surface temperature (handles negative, zero, and positive °C)
    const tBefore = summary.surface_temp_before;
    const tAfter = summary.surface_temp_after;
    const minT = Math.min(0, tBefore, tAfter);
    const maxT = Math.max(0, tBefore, tAfter);
    const spanT = maxT - minT || 1;
    const zeroX = trackX + ((0 - minT) / spanT) * trackW;

    function tempSegment(val) {
      const valPos = trackX + ((val - minT) / spanT) * trackW;
      return {
        x: Math.min(zeroX, valPos),
        w: Math.abs(valPos - zeroX),
      };
    }

    const segBefore = tempSegment(tBefore);
    const segAfter = tempSegment(tAfter);

    svg.appendChild(svgEl("text", { x: 0, y: 92, class: "svg-val" }, "Поверхность (°C)"));

    svg.appendChild(svgEl("text", { x: 0, y: 112, class: "svg-label" }, "До"));
    svg.appendChild(svgEl("rect", { x: trackX, y: 102, width: trackW, height: 11, rx: 3, class: "svg-track" }));
    if (segBefore.w > 0) {
      svg.appendChild(
        svgEl("rect", { x: segBefore.x, y: 102, width: segBefore.w, height: 11, rx: 2, class: "svg-bar-before" })
      );
    }
    svg.appendChild(svgEl("line", { x1: zeroX, y1: 100, x2: zeroX, y2: 136, class: "svg-axis" }));
    svg.appendChild(
      svgEl("text", { x: valX, y: 112, "text-anchor": "end", class: "svg-val" }, `${formatMetric(tBefore)} °C`)
    );

    svg.appendChild(svgEl("text", { x: 0, y: 132, class: "svg-label" }, "После"));
    svg.appendChild(svgEl("rect", { x: trackX, y: 122, width: trackW, height: 11, rx: 3, class: "svg-track" }));
    if (segAfter.w > 0) {
      svg.appendChild(
        svgEl("rect", { x: segAfter.x, y: 122, width: segAfter.w, height: 11, rx: 2, class: "svg-bar-after" })
      );
    }
    svg.appendChild(
      svgEl("text", { x: valX, y: 132, "text-anchor": "end", class: "svg-val" }, `${formatMetric(tAfter)} °C`)
    );

    container.appendChild(svg);
  }

  function renderSensitivitySvg(container, summary) {
    clearChildren(container);
    const svg = svgEl("svg", {
      class: "report-svg",
      viewBox: "0 0 380 148",
      role: "img",
      "aria-label": "Диапазоны чувствительности для PM2.5, охлаждения и связывания CO2",
    });

    const rows = [
      {
        title: "Δ PM2.5",
        base: summary.pm25_reduction,
        range: summary.pm25_reduction_range,
        unit: "мкг/м³",
        y: 26,
      },
      {
        title: "Охлажд.",
        base: summary.cooling_c,
        range: summary.cooling_c_range,
        unit: "°C",
        y: 74,
      },
      {
        title: "CO₂/год",
        base: summary.co2_tons_year,
        range: summary.co2_tons_year_range,
        unit: "т",
        y: 122,
      },
    ];

    const trackX = 68;
    const trackW = 166;

    for (const row of rows) {
      const low = row.range[0];
      const high = row.range[1];
      const maxScale = Math.max(high, row.base, 1e-6);
      const isZeroBand = high === 0 && row.base === 0;

      const x1 = isZeroBand ? trackX : trackX + (low / maxScale) * trackW;
      const x2 = isZeroBand ? trackX : trackX + (high / maxScale) * trackW;
      const xMid = isZeroBand ? trackX : trackX + (row.base / maxScale) * trackW;

      svg.appendChild(svgEl("text", { x: 0, y: row.y + 4, class: "svg-label" }, row.title));
      svg.appendChild(
        svgEl("rect", { x: trackX, y: row.y - 5, width: trackW, height: 10, rx: 5, class: "svg-track" })
      );

      if (x2 > x1) {
        svg.appendChild(
          svgEl("rect", {
            x: x1,
            y: row.y - 5,
            width: Math.max(2, x2 - x1),
            height: 10,
            rx: 5,
            class: "svg-band",
          })
        );
      }

      svg.appendChild(svgEl("circle", { cx: xMid, cy: row.y, r: 4.5, class: "svg-marker" }));

      svg.appendChild(
        svgEl(
          "text",
          { x: 376, y: row.y + 4, "text-anchor": "end", class: "svg-val" },
          `${formatMetric(low)}…${formatMetric(high)} ${row.unit}`
        )
      );
    }

    container.appendChild(svg);
  }

  function describeBackgroundChannel(channel) {
    if (!isPlainObject(channel)) {
      return {
        statusText: "Резервный сценарий",
        statusClass: "status-pill is-fallback",
        sourceTimeText: "Не указано (резервный сценарий)",
        fetchedAtText: "Не указано (резервный сценарий)",
        valuesText: "Фоновый источник отсутствует в файле — применён резервный сценарий.",
      };
    }

    const rawStatus = typeof channel.status === "string" ? channel.status.trim().toLowerCase() : "default";
    let statusText = "Резервный сценарий";
    let statusClass = "status-pill is-fallback";
    let isFallback = true;

    if (rawStatus === "live") {
      statusText = "Модельный фон · Live";
      statusClass = "status-pill is-live";
      isFallback = false;
    } else if (rawStatus === "cached") {
      statusText = "Кэш модельного фона";
      statusClass = "status-pill is-cached";
      isFallback = false;
    }

    const emptyTimeLabel = isFallback ? "Не указано (резервный сценарий)" : "Не указано";
    const sourceTimeText = formatUtcPlus5(channel.source_time, emptyTimeLabel);
    const fetchedAtText = formatUtcPlus5(channel.fetched_at, emptyTimeLabel);

    const parts = [];
    if (isPlainObject(channel.values)) {
      for (const [key, val] of Object.entries(channel.values)) {
        if (!isFiniteNum(val)) continue;
        const meta = BG_VALUE_LABELS[key];
        if (meta) {
          parts.push(`${meta[0]}: ${formatMetric(val)} ${meta[1]}`);
        } else {
          parts.push(`${key}: ${formatMetric(val)}`);
        }
      }
    }

    let valuesText;
    if (parts.length > 0) {
      valuesText = parts.join(" · ");
    } else if (isFallback) {
      valuesText = "Использованы параметры резервного сценария (онлайн-значения не переданы).";
    } else {
      valuesText = "Детальные численные поля фона не переданы в файле.";
    }

    return { statusText, statusClass, sourceTimeText, fetchedAtText, valuesText };
  }

  function renderReportDom(data, doc) {
    const req = data.request;
    const sum = data.summary;
    const costs = data.costs;
    const meth = data.methodology;
    const zones = data.zones;

    const currencyCode = costs.currency.trim().toUpperCase();
    const currencyWord = currencyCode === "KZT" ? "тенге" : costs.currency.trim();

    // 1. Passport Header
    doc.getElementById("meta-run-id").textContent = data.run_id;
    doc.getElementById("meta-created-at").textContent = formatUtcPlus5(
      data.created_at,
      "Не указана в файле"
    );

    const districtLabel = Object.prototype.hasOwnProperty.call(DISTRICT_LABELS, req.target_district)
      ? DISTRICT_LABELS[req.target_district]
      : req.target_district;
    doc.getElementById("meta-district").textContent = districtLabel;

    const baseSpeciesName = SPECIES_LABELS[req.species] || req.species;
    const paramLabel =
      isPlainObject(meth.species_parameters) && typeof meth.species_parameters.label === "string"
        ? meth.species_parameters.label.trim()
        : "";
    doc.getElementById("meta-species").textContent =
      paramLabel && paramLabel !== baseSpeciesName
        ? `${baseSpeciesName} (${paramLabel})`
        : `${baseSpeciesName} (${req.species})`;

    doc.getElementById("meta-budget").textContent = `${formatInt(req.budget_trees)} ${pluralizeRu(
      req.budget_trees,
      "дерево",
      "дерева",
      "деревьев"
    )}`;

    const years = data.horizon_years;
    const yearsPhrase = `${formatInt(years)} ${pluralizeRu(years, "год", "года", "лет")}`;
    doc.getElementById("meta-horizon").textContent = yearsPhrase;

    // 2. Decision Summary
    doc.getElementById("dec-used-trees").textContent = `${formatInt(data.used_trees)} шт.`;
    doc.getElementById("dec-used-sub").textContent = `Из заявленного бюджета ${formatInt(
      req.budget_trees
    )} шт.`;

    doc.getElementById("dec-unused-trees").textContent = `${formatInt(data.unused_trees)} шт.`;
    doc.getElementById("dec-unused-sub").textContent =
      data.unused_trees > 0
        ? "Остаток при ограничении расчётной ёмкости выбранных зон"
        : "Бюджет посадки распределён полностью";

    doc.getElementById("dec-zones-count").textContent = `${formatInt(zones.length)} ${pluralizeRu(
      zones.length,
      "участок",
      "участка",
      "участков"
    )}`;
    doc.getElementById("dec-zones-sub").textContent = `Территория: ${districtLabel}`;

    renderAllocationSvg(
      doc.getElementById("allocation-bar-wrap"),
      data.used_trees,
      data.unused_trees,
      req.budget_trees
    );

    doc.getElementById("dec-model-note").textContent =
      data.note.trim() || "Сценарный расчёт выполнен по инженерной модели озеленения ASTRA.";

    // 3. Ecological Metrics
    const factors =
      Array.isArray(meth.sensitivity_factors) && meth.sensitivity_factors.length === 2
        ? meth.sensitivity_factors
        : [0.5, 1.5];
    const factorLabel = `×${dec1Fmt.format(factors[0])}–${dec1Fmt.format(factors[1])}`;

    doc.getElementById("eco-horizon-tag").textContent = `Горизонт: через ${yearsPhrase}`;

    doc.getElementById("eco-pm25-main").textContent = `${formatMetric(sum.pm25_reduction)} мкг/м³`;
    doc.getElementById("eco-pm25-pct").textContent = `Относительное снижение: ${formatPct(
      sum.pm25_reduction_pct
    )} %`;
    doc.getElementById("eco-pm25-before").textContent = `${formatMetric(sum.pm25_before)} мкг/м³`;
    doc.getElementById("eco-pm25-after").textContent = `${formatMetric(sum.pm25_after)} мкг/м³`;
    doc.getElementById("eco-pm25-range").textContent = `Чувствительность (${factorLabel}): ${formatMetric(
      sum.pm25_reduction_range[0]
    )} … ${formatMetric(sum.pm25_reduction_range[1])} мкг/м³`;

    // Zero cooling is valid and explicitly formatted as 0,00 °C
    doc.getElementById("eco-cooling-main").textContent = `${formatMetric(sum.cooling_c)} °C`;
    doc.getElementById("eco-cooling-note").textContent =
      normalizeZero(sum.cooling_c) === 0
        ? "Нулевое расчётное охлаждение (прохладный фон или 0 посадок)"
        : "Расчётное снижение температуры поверхности";
    doc.getElementById("eco-temp-before").textContent = `${formatMetric(sum.surface_temp_before)} °C`;
    doc.getElementById("eco-temp-after").textContent = `${formatMetric(sum.surface_temp_after)} °C`;
    doc.getElementById("eco-cooling-range").textContent = `Чувствительность (${factorLabel}): ${formatMetric(
      sum.cooling_c_range[0]
    )} … ${formatMetric(sum.cooling_c_range[1])} °C`;

    doc.getElementById("eco-co2-main").textContent = `${formatMetric(sum.co2_tons_year)} т/год`;
    doc.getElementById("eco-co2-range").textContent = `Чувствительность (${factorLabel}): ${formatMetric(
      sum.co2_tons_year_range[0]
    )} … ${formatMetric(sum.co2_tons_year_range[1])} т/год`;

    doc.getElementById("eco-pop-main").textContent = `${formatInt(sum.population_covered)} чел.`;
    doc.getElementById("eco-pop-kind").textContent =
      POP_KIND_LABELS[sum.population_kind] || `Тип оценки: ${sum.population_kind}`;

    doc.getElementById(
      "sensitivity-caption"
    ).textContent = `Диапазоны чувствительности (${factorLabel}), не доверительный интервал`;

    renderBeforeAfterSvg(doc.getElementById("before-after-svg"), sum);
    renderSensitivitySvg(doc.getElementById("sensitivity-svg"), sum);

    // 4. Zones Table
    doc.getElementById("zones-count-badge").textContent = `${formatInt(zones.length)} ${pluralizeRu(
      zones.length,
      "зона",
      "зоны",
      "зон"
    )}`;

    const emptyZonesBox = doc.getElementById("zones-empty");
    const tableWrapper = doc.getElementById("zones-table-wrapper");
    const tbody = doc.getElementById("zones-tbody");
    const tfoot = doc.getElementById("zones-tfoot");

    clearChildren(tbody);
    clearChildren(tfoot);

    if (zones.length === 0) {
      emptyZonesBox.hidden = false;
      tableWrapper.hidden = true;
    } else {
      emptyZonesBox.hidden = true;
      tableWrapper.hidden = false;

      for (const zone of zones) {
        const tr = doc.createElement("tr");

        const th = doc.createElement("th");
        th.setAttribute("scope", "row");
        const nameSpan = doc.createElement("span");
        nameSpan.textContent = zone.name_i18n?.[reportI18n()?.lang] ?? reportI18n()?.zoneName(zone.name) ?? zone.name;
        nameSpan.setAttribute("data-original", "");
        const metaSpan = doc.createElement("span");
        metaSpan.className = "zone-meta";
        metaSpan.setAttribute("data-original", "");
        metaSpan.textContent = `${localeText(zone.district_name)} · ID: ${zone.id} · ${zone.latitude.toFixed(
          4
        )}°, ${zone.longitude.toFixed(4)}°`;
        th.appendChild(nameSpan);
        th.appendChild(metaSpan);
        tr.appendChild(th);

        const cells = [
          formatInt(zone.trees),
          formatMetric(zone.pm25_before),
          formatMetric(zone.pm25_after),
          formatMetric(zone.pm25_reduction),
          formatMetric(zone.cooling_c),
          formatMetric(zone.co2_tons_year),
          formatInt(zone.population_covered),
        ];

        for (const valText of cells) {
          const td = doc.createElement("td");
          td.className = "num";
          td.textContent = valText;
          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      }

      const footTr = doc.createElement("tr");
      const footTh = doc.createElement("th");
      footTh.setAttribute("scope", "row");
      footTh.textContent = "Итого / средневзвешенно по сценарию";
      footTr.appendChild(footTh);

      const footCells = [
        formatInt(data.used_trees),
        formatMetric(sum.pm25_before),
        formatMetric(sum.pm25_after),
        formatMetric(sum.pm25_reduction),
        formatMetric(sum.cooling_c),
        formatMetric(sum.co2_tons_year),
        formatInt(sum.population_covered),
      ];

      for (const valText of footCells) {
        const td = doc.createElement("td");
        td.className = "num";
        td.textContent = valText;
        footTr.appendChild(td);
      }

      tfoot.appendChild(footTr);
    }

    // 5. Costs Section
    doc.getElementById("costs-currency").textContent = `${currencyWord}, ${costs.currency}`;
    doc.getElementById("costs-kind-badge").textContent =
      COST_KIND_LABELS[costs.kind] || costs.kind;

    doc.getElementById("cost-planting").textContent = formatMoney(costs.planting, currencyWord);
    doc.getElementById("cost-care").textContent = `${formatMoney(costs.annual_care, currencyWord)}/год`;
    doc.getElementById("cost-equipment").textContent = formatMoney(costs.equipment, currencyWord);
    doc.getElementById("cost-platform").textContent = `${formatMoney(
      costs.annual_platform,
      currencyWord
    )}/год`;
    doc.getElementById("cost-first-year").textContent = formatMoney(
      costs.first_year_total,
      currencyWord
    );
    doc.getElementById("cost-horizon-label").textContent = `Итого за весь горизонт (${yearsPhrase})`;
    doc.getElementById("cost-horizon").textContent = formatMoney(costs.horizon_total, currencyWord);

    doc.getElementById("rate-sapling").textContent = formatMoney(req.sapling_cost_kzt, currencyWord);
    doc.getElementById("rate-planting").textContent = formatMoney(req.planting_cost_kzt, currencyWord);
    doc.getElementById("rate-care").textContent = formatMoney(req.annual_care_cost_kzt, currencyWord);
    doc.getElementById("rate-equipment").textContent = formatMoney(
      req.pilot_equipment_cost_kzt,
      currencyWord
    );
    doc.getElementById("rate-platform").textContent = formatMoney(
      req.annual_platform_cost_kzt,
      currencyWord
    );

    // 6. Background & Methodology Section
    doc.getElementById("meth-version-badge").textContent = `Методика: ${meth.version}`;

    const bgObj = isPlainObject(data.background) ? data.background : null;
    const airInfo = describeBackgroundChannel(bgObj ? bgObj.air : null);
    const weatherInfo = describeBackgroundChannel(bgObj ? bgObj.weather : null);

    const airStatusEl = doc.getElementById("bg-air-status");
    airStatusEl.className = airInfo.statusClass;
    airStatusEl.textContent = airInfo.statusText;
    doc.getElementById("bg-air-source-time").textContent = airInfo.sourceTimeText;
    doc.getElementById("bg-air-fetched-at").textContent = airInfo.fetchedAtText;
    doc.getElementById("bg-air-values").textContent = airInfo.valuesText;

    const weatherStatusEl = doc.getElementById("bg-weather-status");
    weatherStatusEl.className = weatherInfo.statusClass;
    weatherStatusEl.textContent = weatherInfo.statusText;
    doc.getElementById("bg-weather-source-time").textContent = weatherInfo.sourceTimeText;
    doc.getElementById("bg-weather-fetched-at").textContent = weatherInfo.fetchedAtText;
    doc.getElementById("bg-weather-values").textContent = weatherInfo.valuesText;

    doc.getElementById("meth-note").textContent =
      meth.note.trim() ||
      "Численные коэффициенты пород и затрат являются сценарными допущениями и требуют местной калибровки.";

    const paramChunks = [];
    if (typeof meth.deposition_basis === "string" && meth.deposition_basis.trim()) {
      paramChunks.push(`База: ${meth.deposition_basis.trim()}`);
    }
    if (isPlainObject(meth.species_parameters)) {
      const sp = meth.species_parameters;
      if (isFiniteNum(sp.crown_m2)) paramChunks.push(`Крона взрослая: ${formatMetric(sp.crown_m2)} м²`);
      if (isFiniteNum(sp.lai)) paramChunks.push(`LAI: ${formatMetric(sp.lai)}`);
      if (isFiniteNum(sp.deposition_m_s)) paramChunks.push(`Vd: ${sp.deposition_m_s} м/с`);
      if (isFiniteNum(sp.survival)) paramChunks.push(`Приживаемость: ${formatPct(sp.survival * 100)} %`);
      if (isFiniteNum(sp.annual_co2_kg))
        paramChunks.push(`Поглощение CO₂: ${formatMetric(sp.annual_co2_kg)} кг/год`);
      if (isFiniteNum(sp.cooling_max_c))
        paramChunks.push(`Макс. охлаждение: ${formatMetric(sp.cooling_max_c)} °C`);
    }
    doc.getElementById("meth-params-line").textContent =
      paramChunks.length > 0
        ? paramChunks.join(" · ")
        : "Дополнительные коэффициенты породы не указаны в файле.";

    doc.getElementById("lim-sensitivity-title").textContent = `Диапазон чувствительности (${factorLabel}):`;

    const sourcesList = doc.getElementById("meth-sources-list");
    clearChildren(sourcesList);
    if (meth.sources.length === 0) {
      const li = doc.createElement("li");
      li.textContent = "Ссылки на внешние публикации не приложены в данном JSON-файле.";
      sourcesList.appendChild(li);
    } else {
      for (const rawSrc of meth.sources) {
        const li = doc.createElement("li");
        const safeHref = sanitizeHttpUrl(rawSrc);
        if (safeHref) {
          const link = doc.createElement("a");
          link.href = safeHref;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = safeHref;
          li.appendChild(link);
        } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawSrc.trim())) {
          li.textContent = "Адрес источника скрыт (допустимы только ссылки https/http)";
        } else {
          li.textContent = rawSrc;
          li.setAttribute("data-original", "");
        }
        sourcesList.appendChild(li);
      }
    }
  }

  function initBrowserUi() {
    if (typeof document === "undefined") return;

    const fileInput = document.getElementById("json-file-input");
    const pickBtn = document.getElementById("pick-file-btn");
    const printBtn = document.getElementById("print-btn");
    const dropzone = document.getElementById("dropzone");
    const dropzoneTitle = document.getElementById("dropzone-title");
    const fileBadge = document.getElementById("loaded-file-badge");
    const errorPanel = document.getElementById("error-panel");
    const errorSummary = document.getElementById("error-summary");
    const errorList = document.getElementById("error-list");
    const emptyGuide = document.getElementById("empty-guide");
    const reportSheet = document.getElementById("report-document");

    if (!fileInput || !pickBtn || !printBtn || !dropzone || !reportSheet) return;
    document.documentElement?.setAttribute("data-report-build", "20261025-i18n1");
    let currentData = null, currentSource = "", lastErrors = null;
    const languageSelect = document.getElementById("report-language");
    if (languageSelect && reportI18n()) {
      languageSelect.value = reportI18n().lang;
      languageSelect.addEventListener("change", () => {
        reportI18n().setLang(languageSelect.value);
        configureFormats();
        if (currentData) applyValidReport(currentData, currentSource);
        else if (lastErrors) showErrors(...lastErrors);
        localizeDocument(document);
      });
    }
    localizeDocument(document);

    function showErrors(summaryMsg, messages) {
      currentData = null; lastErrors = [summaryMsg, messages];
      reportSheet.hidden = true;
      emptyGuide.hidden = false;
      printBtn.disabled = true;
      fileBadge.hidden = true;
      fileBadge.textContent = "";
      dropzone.classList.remove("is-compact");
      dropzoneTitle.textContent = "Откройте JSON-результат планирования озеленения";

      errorSummary.textContent = summaryMsg;
      clearChildren(errorList);
      for (const msg of messages) {
        const li = document.createElement("li");
        li.textContent = msg;
        errorList.appendChild(li);
      }
      errorPanel.hidden = false;
      localizeDocument(document);
    }

    function applyValidReport(data, sourceLabel) {
      currentData = data; currentSource = sourceLabel; lastErrors = null;
      errorPanel.hidden = true;
      clearChildren(errorList);
      renderReportDom(data, document);

      emptyGuide.hidden = true;
      reportSheet.hidden = false;
      printBtn.disabled = false;
      dropzone.classList.add("is-compact");
      dropzoneTitle.textContent = "Отчёт сформирован — вы можете загрузить другой JSON-файл";

      if (sourceLabel) {
        fileBadge.textContent = sourceLabel;
        fileBadge.hidden = false;
      }
      localizeDocument(document);
    }

    function loadJsonText(rawText, fileName) {
      if (typeof rawText !== "string") {
        showErrors("Некорректный тип входных данных.", [
          "Содержимое JSON должно быть передано строкой.",
        ]);
        return false;
      }

      // Check the actual UTF-8 payload at every entry point, not caller-supplied metadata.
      const byteSize = new TextEncoder().encode(rawText).byteLength;
      if (byteSize > MAX_FILE_BYTES) {
        showErrors("Превышен допустимый размер входного файла.", [
          `Размер JSON составляет ${(byteSize / (1024 * 1024)).toFixed(2)} МБ при ограничении не более 5,00 МБ.`,
        ]);
        return false;
      }

      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        const detail = err && typeof err.message === "string" ? ` (${err.message})` : "";
        showErrors("Выбранный файл не является синтаксически корректным JSON.", [
          `Не удалось разобрать содержимое файла «${fileName || "без имени"}»${detail}.`,
          "Убедитесь, что файл скачан из дашборда ASTRA без ручных повреждений и обрыва записи.",
        ]);
        return false;
      }

      const check = validateReportData(parsed);
      if (!check.valid) {
        showErrors("Структура или типы данных в JSON не соответствуют контракту ASTRA.", check.errors);
        return false;
      }

      const sizeKb = ` · ${(byteSize / 1024).toFixed(1)} КБ`;
      applyValidReport(parsed, `${fileName || "JSON-расчёт"}${sizeKb}`);
      return true;
    }

    async function handleFileSelection(file) {
      if (!file) return;

      if (file.size === 0) {
        fileBadge.hidden = true;
        showErrors("Выбран пустой файл (0 байт).", [
          `Файл «${file.name}» не содержит данных.`,
        ]);
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        fileBadge.hidden = true;
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        showErrors("Превышен допустимый размер входного файла.", [
          `Размер файла «${file.name}» составляет ${sizeMb} МБ при ограничении не более 5,00 МБ.`,
        ]);
        return;
      }

      try {
        const text = await file.text();
        const loaded = loadJsonText(text, file.name);
        if (loaded && (window.location.protocol === "http:" || window.location.protocol === "https:") &&
            new URLSearchParams(window.location.search).get("source") === "dashboard") {
          // Refresh must not replace a manually selected file with an older dashboard snapshot.
          const reportUrl = new URL(window.location.href);
          reportUrl.searchParams.delete("source");
          window.history.replaceState(null, "", reportUrl.pathname + reportUrl.search + reportUrl.hash);
        }
      } catch (_) {
        fileBadge.hidden = true;
        showErrors("Не удалось прочитать выбранный файл.", [
          `Браузер не смог прочитать файл «${file.name}». Проверьте права доступа и попробуйте снова.`,
        ]);
      }
    }

    function openPicker() {
      fileInput.value = "";
      fileInput.click();
    }

    pickBtn.addEventListener("click", openPicker);
    dropzone.addEventListener("click", openPicker);
    dropzone.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openPicker();
      }
    });

    fileInput.addEventListener("change", () => {
      const selected = fileInput.files && fileInput.files[0];
      if (selected) {
        handleFileSelection(selected);
      }
    });

    dropzone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      dropzone.classList.add("is-dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("is-dragover");
    });

    dropzone.addEventListener("drop", (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("is-dragover");
      const dropped = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (dropped) {
        handleFileSelection(dropped);
      }
    });

    printBtn.addEventListener("click", () => {
      if (!reportSheet.hidden) {
        window.print();
      }
    });

    window.AstraReport = Object.freeze({
      MAX_FILE_BYTES,
      validateReportData,
      loadJsonText,
      formatUtcPlus5,
      sanitizeHttpUrl,
    });

    const servedByApp = window.location.protocol === "http:" || window.location.protocol === "https:";
    document.getElementById("dashboard-link").hidden = !servedByApp;
    if (servedByApp && new URLSearchParams(window.location.search).get("source") === "dashboard") {
      let snapshot;
      try {
        snapshot = window.sessionStorage.getItem("astra:report:current");
      } catch (_) {
        showErrors("Браузер не разрешил доступ к расчёту в этой вкладке.", [
          "Выберите скачанный JSON-файл или вернитесь в дашборд и откройте отчёт повторно.",
        ]);
        return;
      }
      if (snapshot === null) {
        showErrors("В этой вкладке нет расчёта из дашборда.", [
          "Выберите JSON-файл или сначала рассчитайте план озеленения в дашборде.",
        ]);
      } else {
        loadJsonText(snapshot, "Расчёт из дашборда");
      }
    }
  }

  initBrowserUi();

  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = {
      MAX_FILE_BYTES,
      validateReportData,
      parseIsoUtc,
      formatUtcPlus5,
      sanitizeHttpUrl,
      describeBackgroundChannel,
      renderReportDom,
    };
  }
})();
