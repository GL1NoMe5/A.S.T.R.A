/* Local report translations. User-provided notes and source text stay unchanged. */
(function () {
"use strict";
const rows = [
  [
    "ASTRA — Печатный отчёт по сценарию озеленения",
    "ASTRA — Greening scenario report",
    "ASTRA — Көгалдандыру сценарийі бойынша есеп"
  ],
  [
    "городская экология · модуль отчётности",
    "urban ecology · reporting",
    "қала экологиясы · есептер"
  ],
  [
    "← К дашборду",
    "← Dashboard",
    "← Бақылау панелі"
  ],
  [
    "Выбрать JSON расчёта",
    "Choose calculation JSON",
    "Есептің JSON файлын таңдау"
  ],
  [
    "Печать / сохранить PDF",
    "Print / save PDF",
    "Басып шығару / PDF сақтау"
  ],
  [
    "Загрузка файла расчёта",
    "Calculation file upload",
    "Есеп файлын жүктеу"
  ],
  [
    "ЛОКАЛЬНАЯ ОБРАБОТКА В БРАУЗЕРЕ · БЕЗ ПЕРЕДАЧИ В СЕТЬ",
    "PROCESSED LOCALLY IN YOUR BROWSER · NO UPLOAD",
    "БРАУЗЕРДЕ ЖЕРГІЛІКТІ ӨҢДЕУ · ЖЕЛІГЕ ЖІБЕРІЛМЕЙДІ"
  ],
  [
    "Откройте JSON-результат планирования озеленения",
    "Open a greening calculation JSON file",
    "Көгалдандыру есебінің JSON нәтижесін ашыңыз"
  ],
  [
    "Выберите или перетащите сюда файл, скачанный в дашборде ASTRA кнопкой «Скачать расчёт JSON». Допустимый размер файла — до 5 МБ.",
    "Choose or drop the file downloaded with “Download calculation JSON” in ASTRA. Maximum file size: 5 MiB.",
    "ASTRA панеліндегі «Есепті JSON түрінде жүктеу» батырмасымен алынған файлды таңдаңыз немесе осында сүйреңіз. Файлдың ең үлкен көлемі — 5 МиБ."
  ],
  [
    "Обзор файла…",
    "Browse files…",
    "Файлды шолу…"
  ],
  [
    "Файл расчёта не прошёл проверку",
    "Calculation file validation failed",
    "Есеп файлы тексеруден өтпеді"
  ],
  [
    "Проверьте целостность JSON-файла и соответствие формату выгрузки ASTRA.",
    "Check the JSON file and its compatibility with the ASTRA export format.",
    "JSON файлының тұтастығын және ASTRA экспорт пішіміне сәйкестігін тексеріңіз."
  ],
  [
    "Порядок работы с отчётом",
    "Report workflow",
    "Есеппен жұмыс істеу тәртібі"
  ],
  [
    "ИНСТРУКЦИЯ ДЛЯ СПЕЦИАЛИСТА",
    "REPORT INSTRUCTIONS",
    "ЕСЕП НҰСҚАУЛЫҒЫ"
  ],
  [
    "Как подготовить печатную ведомость A4",
    "Prepare an A4 report",
    "A4 пішіміндегі есепті дайындау"
  ],
  [
    "Сформируйте расчёт в ASTRA",
    "Create a calculation in ASTRA",
    "ASTRA жүйесінде есеп жасаңыз"
  ],
  [
    "Задайте район, бюджет деревьев, породу, горизонт и сценарные расценки, затем нажмите «Скачать расчёт JSON».",
    "Select the district, tree budget, species, horizon and scenario prices, then download the calculation JSON.",
    "Ауданды, ағаш санын, түрін, мерзімін және сценарий бағаларын көрсетіп, есепті JSON түрінде жүктеңіз."
  ],
  [
    "Загрузите полученный файл",
    "Load the downloaded file",
    "Жүктелген файлды ашыңыз"
  ],
  [
    "Отчёт проверит структуру данных, переведёт временные метки в часовой пояс Астаны (UTC+5) и построит сводку без пересчёта модели.",
    "The report validates the data, displays timestamps in Astana time (UTC+5) and summarises the saved result without rerunning the model.",
    "Есеп деректер құрылымын тексеріп, уақытты Астана белдеуіне (UTC+5) ауыстырады және модельді қайта есептемей сақталған нәтижені көрсетеді."
  ],
  [
    "Сохраните в PDF или распечатайте",
    "Save as PDF or print",
    "PDF ретінде сақтаңыз немесе басып шығарыңыз"
  ],
  [
    "Нажмите «Печать / сохранить PDF». Элементы управления скроются, а отчёт переключится в светлую экономную вёрстку A4.",
    "Choose “Print / save PDF”. Controls are hidden and the report uses a light A4 print layout.",
    "«Басып шығару / PDF сақтау» батырмасын басыңыз. Басқару элементтері жасырылып, есеп ашық түсті A4 баспа пішіміне ауысады."
  ],
  [
    "ASTRA · ЭКОЛОГИЧЕСКАЯ АНАЛИТИКА Г. АСТАНА · GREENHACK KAZAKHSTAN 2026",
    "ASTRA · ENVIRONMENTAL ANALYTICS FOR ASTANA · GREENHACK KAZAKHSTAN 2026",
    "ASTRA · АСТАНАНЫҢ ЭКОЛОГИЯЛЫҚ ТАЛДАУЫ · GREENHACK KAZAKHSTAN 2026"
  ],
  [
    "СЦЕНАРНАЯ РЕКОМЕНДАЦИЯ",
    "SCENARIO RECOMMENDATION",
    "СЦЕНАРИЙЛІК ҰСЫНЫС"
  ],
  [
    "Отчёт по результату расчёта городского озеленения",
    "Urban greening calculation report",
    "Қаланы көгалдандыру есебінің нәтижелері"
  ],
  [
    "Предварительная сценарная ведомость распределения посадок, модельного экологического эффекта и ориентировочных затрат",
    "Preliminary scenario allocation, modelled environmental effects and estimated costs",
    "Отырғызуды бөлу, модельдік экологиялық әсер және болжамды шығындар жөніндегі алдын ала сценарийлік есеп"
  ],
  [
    "Паспорт расчёта",
    "Calculation details",
    "Есеп мәліметтері"
  ],
  [
    "Номер расчёта (run_id)",
    "Calculation ID (run_id)",
    "Есеп нөмірі (run_id)"
  ],
  [
    "Дата формирования (UTC+5)",
    "Created at (UTC+5)",
    "Жасалған уақыты (UTC+5)"
  ],
  [
    "Целевая территория",
    "Target area",
    "Таңдалған аумақ"
  ],
  [
    "Порода деревьев",
    "Tree species",
    "Ағаш түрі"
  ],
  [
    "Бюджет посадки",
    "Tree budget",
    "Отырғызылатын ағаш саны"
  ],
  [
    "Горизонт сценария",
    "Scenario horizon",
    "Сценарий мерзімі"
  ],
  [
    "01 / РЕШЕНИЕ ДЛЯ ГОРОДСКИХ СЛУЖБ",
    "01 / ALLOCATION SUMMARY",
    "01 / ОТЫРҒЫЗУДЫ БӨЛУ"
  ],
  [
    "Сводка распределения посадочного фонда",
    "Tree allocation summary",
    "Ағаштарды бөлу қорытындысы"
  ],
  [
    "Сценарный расчёт",
    "Scenario calculation",
    "Сценарийлік есеп"
  ],
  [
    "Распределено деревьев",
    "Trees allocated",
    "Бөлінген ағаштар"
  ],
  [
    "Нераспределённый остаток",
    "Unallocated trees",
    "Бөлінбеген ағаштар"
  ],
  [
    "Задействовано зон",
    "Areas included",
    "Қамтылған аймақтар"
  ],
  [
    "Структура освоения бюджета деревьев",
    "Tree budget allocation",
    "Ағаш санын бөлу құрылымы"
  ],
  [
    "Статус рекомендации и примечание модели:",
    "Original calculation note:",
    "Бастапқы есептің ескертпесі:"
  ],
  [
    "Документ носит характер сценарной аналитической рекомендации для предварительной приоритизации участков городскими службами и не заменяет натурное дендрологическое обследование, согласование инженерных сетей и рабочий проект благоустройства.",
    "This scenario recommendation supports preliminary prioritisation. It does not replace a field tree survey, utility clearance or a detailed landscaping design.",
    "Бұл сценарийлік ұсыныс учаскелердің бастапқы басымдығын анықтауға көмектеседі. Ол далалық дендрологиялық зерттеуді, инженерлік желілерді келісуді немесе абаттандырудың жұмыс жобасын алмастырмайды."
  ],
  [
    "02 / ИНЖЕНЕРНАЯ ОЦЕНКА ЭФФЕКТА",
    "02 / MODELLED ENVIRONMENTAL EFFECT",
    "02 / МОДЕЛЬДІК ЭКОЛОГИЯЛЫҚ ӘСЕР"
  ],
  [
    "Показатели среды до и после вмешательства",
    "Environmental indicators before and after planting",
    "Отырғызуға дейінгі және кейінгі орта көрсеткіштері"
  ],
  [
    "Снижение PM2.5",
    "PM2.5 reduction",
    "PM2.5 төмендеуі"
  ],
  [
    "мкг/м³",
    "µg/m³",
    "мкг/м³"
  ],
  [
    "До",
    "Before",
    "Дейін"
  ],
  [
    "После",
    "After",
    "Кейін"
  ],
  [
    "Охлаждение поверхности",
    "Surface cooling",
    "Беткі қабаттың салқындауы"
  ],
  [
    "Годовое связывание CO₂",
    "Annual CO₂ uptake",
    "Жылдық CO₂ сіңіру"
  ],
  [
    "т/год",
    "t/year",
    "т/жыл"
  ],
  [
    "Суммарно по выбранным зонам",
    "Total across selected areas",
    "Таңдалған аймақтар бойынша жиынтық"
  ],
  [
    "Условный охват населения",
    "Scenario population coverage",
    "Сценарий бойынша қамтылатын халық"
  ],
  [
    "чел.",
    "people",
    "адам"
  ],
  [
    "Оценка расчётной численности в границах задействованных непересекающихся виртуальных ячеек.",
    "Estimated population within the selected, non-overlapping virtual cells.",
    "Таңдалған, бір-бірімен қабаттаспайтын виртуалды ұяшықтар шегіндегі халықтың есептік саны."
  ],
  [
    "Сравнение средневзвешенных показателей «До / После»",
    "Weighted indicators before and after",
    "Орташа өлшенген көрсеткіштер: дейін және кейін"
  ],
  [
    "Чувствительность эффекта к допущениям модели",
    "Effect sensitivity to model assumptions",
    "Әсердің модель жорамалдарына сезімталдығы"
  ],
  [
    "03 / ВЕДОМОСТЬ УЧАСТКОВ",
    "03 / AREA SCHEDULE",
    "03 / УЧАСКЕЛЕР ТІЗІМІ"
  ],
  [
    "Распределение деревьев и расчётный эффект по зонам",
    "Tree allocation and modelled effects by area",
    "Аймақтар бойынша ағаштарды бөлу және есептік әсер"
  ],
  [
    "В данном расчёте задействованные зоны отсутствуют (0 участков).",
    "No areas are included in this calculation (0 sites).",
    "Бұл есепте қамтылған аймақтар жоқ (0 учаске)."
  ],
  [
    "Деревья не были распределены ни в одну виртуальную зону при заданных параметрах фильтрации или ёмкости участков.",
    "No trees were allocated under the selected filters or site capacity limits.",
    "Таңдалған сүзгілер немесе учаске сыйымдылығы шектеулері бойынша ағаштар бөлінбеді."
  ],
  [
    "Позонное распределение деревьев и расчётный экологический эффект",
    "Tree allocation and modelled environmental effects by area",
    "Аймақтар бойынша ағаштарды бөлу және есептік экологиялық әсер"
  ],
  [
    "Зона / район",
    "Area / district",
    "Аймақ / аудан"
  ],
  [
    "Деревья, шт.",
    "Trees",
    "Ағаш саны"
  ],
  [
    "PM2.5 до, мкг/м³",
    "PM2.5 before, µg/m³",
    "PM2.5 дейін, мкг/м³"
  ],
  [
    "PM2.5 после, мкг/м³",
    "PM2.5 after, µg/m³",
    "PM2.5 кейін, мкг/м³"
  ],
  [
    "Сниж. PM2.5, мкг/м³",
    "PM2.5 reduction, µg/m³",
    "PM2.5 төмендеуі, мкг/м³"
  ],
  [
    "Охлажд., °C",
    "Cooling, °C",
    "Салқындау, °C"
  ],
  [
    "CO₂, т/год",
    "CO₂, t/year",
    "CO₂, т/жыл"
  ],
  [
    "Усл. охват, чел.",
    "Scenario population",
    "Есептік халық саны"
  ],
  [
    "04 / СЦЕНАРНАЯ СМЕТА",
    "04 / SCENARIO COST ESTIMATE",
    "04 / СЦЕНАРИЙЛІК СМЕТА"
  ],
  [
    "Ориентировочный расчёт затрат",
    "Estimated costs",
    "Болжамды шығындар"
  ],
  [
    "Редактируемые допущения",
    "Editable assumptions",
    "Өзгертілетін жорамалдар"
  ],
  [
    "Сводные статьи расходов (",
    "Cost summary (",
    "Шығындар қорытындысы ("
  ],
  [
    "Посадка деревьев (саженцы и работы)",
    "Tree planting (saplings and labour)",
    "Ағаш отырғызу (көшеттер мен жұмыс)"
  ],
  [
    "Ежегодный агротехнический уход",
    "Annual tree maintenance",
    "Ағаштарды жыл сайын күту"
  ],
  [
    "Пилотное оборудование мониторинга",
    "Pilot monitoring equipment",
    "Пилоттық мониторинг жабдығы"
  ],
  [
    "Ежегодное сопровождение платформы",
    "Annual platform support",
    "Платформаны жыл сайын сүйемелдеу"
  ],
  [
    "Итого за первый год",
    "First-year total",
    "Бірінші жылдағы жиынтық"
  ],
  [
    "Итого за весь горизонт",
    "Total over the horizon",
    "Бүкіл мерзімдегі жиынтық"
  ],
  [
    "Принятые в расчёте единичные ставки",
    "Unit rates used in the calculation",
    "Есепте қолданылған бірлік бағалар"
  ],
  [
    "Стоимость одного саженца",
    "Cost per sapling",
    "Бір көшеттің құны"
  ],
  [
    "Работы по посадке (за 1 дерево)",
    "Planting labour per tree",
    "Бір ағашты отырғызу жұмысы"
  ],
  [
    "Годовой уход (за 1 дерево в год)",
    "Annual maintenance per tree",
    "Бір ағашты жылдық күту"
  ],
  [
    "Комплект пилотного оборудования",
    "Pilot equipment package",
    "Пилоттық жабдық жиынтығы"
  ],
  [
    "Сопровождение платформы в год",
    "Platform support per year",
    "Платформаны жылдық сүйемелдеу"
  ],
  [
    "Цены задаются пользователем как редактируемые сценарные допущения для предварительного сопоставления вариантов. Расчёт не является офертой, сметной документацией или финансовым обязательством.",
    "Prices are editable scenario assumptions for preliminary comparison. This calculation is not a quotation, formal cost estimate or financial commitment.",
    "Бағаларды пайдаланушы нұсқаларды алдын ала салыстыруға арналған өзгертілетін сценарийлік жорамалдар ретінде енгізеді. Бұл есеп оферта, ресми сметалық құжат немесе қаржылық міндеттеме болып саналмайды."
  ],
  [
    "05 / ИСТОЧНИКИ И ОГРАНИЧЕНИЯ",
    "05 / SOURCES AND LIMITATIONS",
    "05 / ДЕРЕККӨЗДЕР МЕН ШЕКТЕУЛЕР"
  ],
  [
    "Фоновые условия, методика и границы применимости",
    "Background conditions, methodology and limitations",
    "Фондық жағдайлар, әдістеме және қолдану шектері"
  ],
  [
    "Фоновые источники",
    "Background sources",
    "Фондық дереккөздер"
  ],
  [
    "Фон качества воздуха (Open-Meteo / CAMS)",
    "Air-quality background (Open-Meteo / CAMS)",
    "Ауа сапасының фоны (Open-Meteo / CAMS)"
  ],
  [
    "Время модели (UTC+5)",
    "Model timestamp (UTC+5)",
    "Модель уақыты (UTC+5)"
  ],
  [
    "Время опроса (UTC+5)",
    "Fetched at (UTC+5)",
    "Сұрау уақыты (UTC+5)"
  ],
  [
    "Метеорологический фон (Open-Meteo)",
    "Weather background (Open-Meteo)",
    "Ауа райы фоны (Open-Meteo)"
  ],
  [
    "Параметры инженерной модели и породы",
    "Engineering model and species parameters",
    "Инженерлік модель мен ағаш түрінің параметрлері"
  ],
  [
    "Примечание из исходного расчёта:",
    "Original methodology note:",
    "Бастапқы есептегі әдістеме ескертпесі:"
  ],
  [
    "Обязательные методологические ограничения при чтении отчёта",
    "Methodological limitations",
    "Әдістемелік шектеулер"
  ],
  [
    "Модельный городской фон Open-Meteo / CAMS:",
    "Open-Meteo / CAMS city background:",
    "Open-Meteo / CAMS қалалық фоны:"
  ],
  [
    "показатели качества воздуха для Астаны поступают из CAMS Global с сеткой около 45 км; разрешение погодных данных Open-Meteo зависит от используемой модели. Эти фоновые показатели не являются прямыми измерениями локальных станций мониторинга Астаны.",
    "Astana air-quality data comes from CAMS Global on an approximately 45 km grid; Open-Meteo weather resolution depends on the model. These are not direct measurements from local monitoring stations in Astana.",
    "Астананың ауа сапасы көрсеткіштері шамамен 45 км торы бар CAMS Global моделінен алынады; Open-Meteo ауа райы деректерінің ажыратымдылығы модельге байланысты. Бұл көрсеткіштер Астанадағы жергілікті мониторинг станцияларының тікелей өлшемдері емес."
  ],
  [
    "40 виртуальных узлов и синтетическое обучение:",
    "40 virtual nodes and synthetic training data:",
    "40 виртуалды торап және синтетикалық оқыту деректері:"
  ],
  [
    "сеть участков, значения NDVI, транспортной нагрузки, температуры поверхности и ёмкости посадок представляют собой расчётную симуляцию; прогнозный ML-модуль приоритизации обучен на синтетической истории.",
    "The areas, NDVI, traffic load, surface temperatures and planting capacity are simulated. The ML model used in prioritisation was trained on synthetic history.",
    "Учаскелер желісі, NDVI, көлік жүктемесі, беткі температура және отырғызу сыйымдылығы — есептік симуляция. Басымдықты анықтауда қолданылатын ML моделі синтетикалық тарихпен оқытылған."
  ],
  [
    "Сценарные коэффициенты и условное население:",
    "Scenario coefficients and population assumptions:",
    "Сценарий коэффициенттері және халық саны туралы жорамалдар:"
  ],
  [
    "параметры кроны, скорости сухого осаждения частиц, приживаемости пород и расценки требуют местной полевой калибровки; показатель охвата населения отражает условную численность непересекающихся ячеек, а не подтверждённый медицинский эффект.",
    "Canopy parameters, dry deposition rates, survival and prices require local calibration. Population coverage is an assumed count in non-overlapping cells, not evidence of a medical benefit.",
    "Ағаш ұшар басының параметрлері, бөлшектердің құрғақ тұну жылдамдығы, жерсінуі мен бағалары жергілікті далалық калибрлеуді қажет етеді. Қамтылған халық саны қабаттаспайтын ұяшықтардағы шартты санды білдіреді, расталған медициналық әсерді білдірмейді."
  ],
  [
    "Диапазон чувствительности (×0,5–1,5):",
    "Sensitivity range (×0.5–1.5):",
    "Сезімталдық аралығы (×0,5–1,5):"
  ],
  [
    "приведённые интервалы показывают чувствительность инженерной формулы к изменению сценарных допущений и",
    "The ranges show how the engineering formula responds to changes in scenario assumptions and",
    "Көрсетілген аралықтар инженерлік формуланың сценарий жорамалдарының өзгеруіне сезімталдығын көрсетеді және"
  ],
  [
    "не являются статистическим доверительным интервалом",
    "are not statistical confidence intervals",
    "статистикалық сенімділік аралығы болып саналмайды"
  ],
  [
    "или гарантией результата.",
    "or a guarantee of results.",
    "немесе нәтижеге кепілдік бермейді."
  ],
  [
    "Отложенный характер эффекта роста:",
    "Delayed growth effects:",
    "Өсу әсерінің кейінірек байқалуы:"
  ],
  [
    "расчётные показатели относятся к состоянию насаждений по достижении выбранного горизонта сценария при текущем погодном фоне и",
    "Calculated indicators refer to trees at the selected growth horizon under the current weather background and",
    "Есептік көрсеткіштер ағымдағы ауа райы фонында таңдалған өсу мерзіміне жеткен ағаштардың күйін сипаттайды және"
  ],
  [
    "не означают немедленный эффект",
    "do not imply an immediate effect",
    "бірден болатын әсерді білдірмейді"
  ],
  [
    "сразу после высадки саженцев.",
    "immediately after planting.",
    "көшеттер отырғызылғаннан кейін."
  ],
  [
    "Литературные и методические источники модели",
    "Model references and methods",
    "Модельдің әдеби және әдістемелік дереккөздері"
  ],
  [
    "ASTRA · Прототип экологической аналитики Астаны · GreenHack Kazakhstan 2026",
    "ASTRA · Astana environmental analytics prototype · GreenHack Kazakhstan 2026",
    "ASTRA · Астананың экологиялық талдау прототипі · GreenHack Kazakhstan 2026"
  ],
  [
    "Часовой пояс отчёта: Asia/Qyzylorda (UTC+5) · Расчётная симуляция",
    "Report timezone: Asia/Qyzylorda (UTC+5) · Simulated data",
    "Есептің уақыт белдеуі: Asia/Qyzylorda (UTC+5) · Есептік симуляция"
  ],
  [
    "Все пилотные районы",
    "All pilot districts",
    "Барлық пилоттық аудандар"
  ],
  [
    "Есиль",
    "Yesil",
    "Есіл"
  ],
  [
    "Нура",
    "Nura",
    "Нұра"
  ],
  [
    "Алматы",
    "Almaty",
    "Алматы"
  ],
  [
    "Сарыарка",
    "Saryarka",
    "Сарыарқа"
  ],
  [
    "Байконыр",
    "Baikonyr",
    "Байқоңыр"
  ],
  [
    "Вяз",
    "Elm",
    "Қарағаш"
  ],
  [
    "Сосна",
    "Pine",
    "Қарағай"
  ],
  [
    "Тополь",
    "Poplar",
    "Терек"
  ],
  [
    "Условные непересекающиеся ячейки",
    "Assumed non-overlapping cells",
    "Шартты қабаттаспайтын ұяшықтар"
  ],
  [
    "Редактируемые сценарные допущения",
    "Editable scenario assumptions",
    "Өзгертілетін сценарийлік жорамалдар"
  ],
  [
    "Воздух",
    "Air",
    "Ауа"
  ],
  [
    "Поверхность",
    "Surface",
    "Беткі қабат"
  ],
  [
    "Влажность",
    "Humidity",
    "Ылғалдылық"
  ],
  [
    "Ветер",
    "Wind",
    "Жел"
  ],
  [
    "Направление ветра",
    "Wind direction",
    "Жел бағыты"
  ],
  [
    "Резервный сценарий",
    "Fallback scenario",
    "Резервтік сценарий"
  ],
  [
    "Не указано (резервный сценарий)",
    "Not specified (fallback scenario)",
    "Көрсетілмеген (резервтік сценарий)"
  ],
  [
    "Не указано",
    "Not specified",
    "Көрсетілмеген"
  ],
  [
    "Не указана в файле",
    "Not specified in the file",
    "Файлда көрсетілмеген"
  ],
  [
    "Фоновый источник отсутствует в файле — применён резервный сценарий.",
    "Background source is absent; fallback parameters were used.",
    "Файлда фондық дереккөз жоқ; резервтік параметрлер қолданылды."
  ],
  [
    "Модельный фон · Live",
    "Model background · Live",
    "Модельдік фон · Ағымдағы"
  ],
  [
    "Кэш модельного фона",
    "Cached model background",
    "Модельдік фон кэші"
  ],
  [
    "Использованы параметры резервного сценария (онлайн-значения не переданы).",
    "Fallback parameters used (online values were not supplied).",
    "Резервтік сценарий параметрлері қолданылды (онлайн мәндер берілмеген)."
  ],
  [
    "Детальные численные поля фона не переданы в файле.",
    "Detailed background values are not included in the file.",
    "Файлда фонның егжей-тегжейлі сандық мәндері берілмеген."
  ],
  [
    "Остаток при ограничении расчётной ёмкости выбранных зон",
    "Unallocated due to selected areas’ modelled capacity limits",
    "Таңдалған аймақтардың есептік сыйымдылығы шектеуіне байланысты қалдық"
  ],
  [
    "Бюджет посадки распределён полностью",
    "The entire tree budget was allocated",
    "Ағаш саны толық бөлінді"
  ],
  [
    "Сценарный расчёт выполнен по инженерной модели озеленения ASTRA.",
    "Scenario calculated with the ASTRA greening engineering model.",
    "Сценарий ASTRA көгалдандыру инженерлік моделімен есептелді."
  ],
  [
    "Нулевое расчётное охлаждение (прохладный фон или 0 посадок)",
    "Zero modelled cooling (cool background or no planting)",
    "Есептік салқындау нөлге тең (салқын фон немесе отырғызу жоқ)"
  ],
  [
    "Расчётное снижение температуры поверхности",
    "Modelled surface-temperature reduction",
    "Беткі температураның есептік төмендеуі"
  ],
  [
    "Итого / средневзвешенно по сценарию",
    "Total / scenario-weighted average",
    "Жиынтық / сценарийдің орташа өлшенген мәні"
  ],
  [
    "Дополнительные коэффициенты породы не указаны в файле.",
    "Additional species coefficients are not provided in the file.",
    "Ағаш түрінің қосымша коэффициенттері файлда көрсетілмеген."
  ],
  [
    "Ссылки на внешние публикации не приложены в данном JSON-файле.",
    "No publication links are included in this JSON file.",
    "Бұл JSON файлында жарияланым сілтемелері жоқ."
  ],
  [
    "Адрес источника скрыт (допустимы только ссылки https/http)",
    "Source address hidden (only HTTP/HTTPS links are allowed)",
    "Дереккөз мекенжайы жасырылды (тек HTTP/HTTPS сілтемелеріне рұқсат етіледі)"
  ],
  [
    "Отчёт сформирован — вы можете загрузить другой JSON-файл",
    "Report ready — you can load another JSON file",
    "Есеп дайын — басқа JSON файлын жүктеуге болады"
  ],
  [
    "Некорректный тип входных данных.",
    "Invalid input data type.",
    "Кіріс деректерінің түрі дұрыс емес."
  ],
  [
    "Содержимое JSON должно быть передано строкой.",
    "JSON content must be supplied as text.",
    "JSON мазмұны мәтін ретінде берілуі керек."
  ],
  [
    "Превышен допустимый размер входного файла.",
    "The input file exceeds the size limit.",
    "Кіріс файлы рұқсат етілген көлемнен асып кетті."
  ],
  [
    "Выбранный файл не является синтаксически корректным JSON.",
    "The selected file is not valid JSON.",
    "Таңдалған файлдың JSON синтаксисі дұрыс емес."
  ],
  [
    "Убедитесь, что файл скачан из дашборда ASTRA без ручных повреждений и обрыва записи.",
    "Check that the file was downloaded from ASTRA and has not been edited or truncated.",
    "Файлдың ASTRA жүйесінен жүктелгенін, өзгертілмегенін және толық сақталғанын тексеріңіз."
  ],
  [
    "Структура или типы данных в JSON не соответствуют контракту ASTRA.",
    "The JSON structure or data types do not match the ASTRA format.",
    "JSON құрылымы немесе деректер түрлері ASTRA пішіміне сәйкес келмейді."
  ],
  [
    "Выбран пустой файл (0 байт).",
    "The selected file is empty (0 bytes).",
    "Таңдалған файл бос (0 байт)."
  ],
  [
    "Не удалось прочитать выбранный файл.",
    "Could not read the selected file.",
    "Таңдалған файлды оқу мүмкін болмады."
  ],
  [
    "Браузер не разрешил доступ к расчёту в этой вкладке.",
    "The browser blocked access to the calculation in this tab.",
    "Браузер бұл қойындыдағы есепке қол жеткізуге рұқсат бермеді."
  ],
  [
    "Выберите скачанный JSON-файл или вернитесь в дашборд и откройте отчёт повторно.",
    "Choose the downloaded JSON file, or return to the dashboard and reopen the report.",
    "Жүктелген JSON файлын таңдаңыз немесе бақылау панеліне оралып, есепті қайта ашыңыз."
  ],
  [
    "В этой вкладке нет расчёта из дашборда.",
    "This tab has no calculation from the dashboard.",
    "Бұл қойындыда бақылау панелінен алынған есеп жоқ."
  ],
  [
    "Выберите JSON-файл или сначала рассчитайте план озеленения в дашборде.",
    "Choose a JSON file or first calculate a greening plan in the dashboard.",
    "JSON файлын таңдаңыз немесе алдымен бақылау панелінде көгалдандыру жоспарын есептеңіз."
  ],
  [
    "Расчёт из дашборда",
    "Dashboard calculation",
    "Бақылау панеліндегі есеп"
  ],
  [
    "JSON-расчёт",
    "JSON calculation",
    "JSON есебі"
  ],
  [
    "Корневой элемент JSON должен быть объектом расчёта озеленения.",
    "The JSON root must be a greening calculation object.",
    "JSON түбірі көгалдандыру есебінің объектісі болуы керек."
  ],
  [
    "Отсутствует или некорректен идентификатор расчёта «run_id».",
    "Calculation identifier “run_id” is missing or invalid.",
    "Есептің «run_id» идентификаторы жоқ немесе дұрыс емес."
  ],
  [
    "Проверка остановлена: обнаружено слишком много ошибок в списке зон.",
    "Validation stopped: too many errors in the area list.",
    "Тексеру тоқтатылды: аймақтар тізімінде тым көп қате бар."
  ],
  [
    "График сравнения показателей PM2.5 и температуры поверхности до и после",
    "Before-and-after chart for PM2.5 and surface temperature",
    "PM2.5 пен беткі температураның дейінгі және кейінгі графигі"
  ],
  [
    "Диапазоны чувствительности для PM2.5, охлаждения и связывания CO2",
    "Sensitivity ranges for PM2.5, cooling and CO₂ uptake",
    "PM2.5, салқындау және CO₂ сіңіру сезімталдық аралықтары"
  ],
  [
    "PM2.5 (мкг/м³)",
    "PM2.5 (µg/m³)",
    "PM2.5 (мкг/м³)"
  ],
  [
    "Поверхность (°C)",
    "Surface (°C)",
    "Беткі қабат (°C)"
  ],
  [
    "Охлажд.",
    "Cooling",
    "Салқындау"
  ],
  [
    "CO₂/год",
    "CO₂/year",
    "CO₂/жыл"
  ],
  [
    "т",
    "t",
    "т"
  ],
  [
    "Язык отчёта",
    "Report language",
    "Есеп тілі"
  ]
];
let lang = 'ru';
try { const stored = localStorage.getItem('astra:language'); if (['ru','en','kk'].includes(stored)) lang = stored; } catch (_) {}
const dictionary = new Map(rows.map(row => [row[0], row]));
const originalText = new WeakMap(), originalAttributes = new WeakMap();
const locales = {ru:'ru-RU',en:'en-GB',kk:'kk-KZ'};
const pick = (en,kk) => lang === 'en' ? en : kk;
const normalized = value => String(value).replace(/\s+/g,' ').trim();
const direct = value => dictionary.get(value)?.[lang === 'en' ? 1 : 2] ?? value;
const rules = [
  [/^Освоение посадочного бюджета: (.+) распр\. \/ (.+) остаток$/, (m)=>pick(`Tree budget: ${m[1]} allocated / ${m[2]} remaining`,`Ағаш саны: ${m[1]} бөлінді / ${m[2]} қалды`)],
  [/^Бюджет: (.+) шт\.$/,m=>pick(`Budget: ${m[1]} trees`,`Бюджет: ${m[1]} ағаш`)],
  [/^Распределено (.+) из (.+) деревьев$/,m=>pick(`${m[1]} of ${m[2]} trees allocated`,`${m[2]} ағаштың ${m[1]} бөлінді`)],
  [/^Из заявленного бюджета (.+) шт\.$/,m=>pick(`From a budget of ${m[1]} trees`,`Өтінімдегі ${m[1]} ағаштан`)],
  [/^Территория: (.+)$/,m=>pick(`Area: ${text(m[1])}`,`Аумақ: ${text(m[1])}`)],
  [/^Горизонт: через (.+)$/,m=>pick(`Horizon: ${text(m[1])}`,`Мерзім: ${text(m[1])}`)],
  [/^Относительное снижение: (.+) %$/,m=>pick(`Relative reduction: ${m[1]} %`,`Салыстырмалы төмендеу: ${m[1]} %`)],
  [/^Чувствительность \((.+)\): (.+)$/,m=>pick(`Sensitivity (${m[1]}): ${text(m[2])}`,`Сезімталдық (${m[1]}): ${text(m[2])}`)],
  [/^Диапазоны чувствительности \((.+)\), не доверительный интервал$/,m=>pick(`Sensitivity ranges (${m[1]}), not confidence intervals`,`Сезімталдық аралықтары (${m[1]}), сенімділік аралықтары емес`)],
  [/^Диапазон чувствительности \((.+)\):$/,m=>pick(`Sensitivity range (${m[1]}):`,`Сезімталдық аралығы (${m[1]}):`)],
  [/^Тип оценки: (.+)$/,m=>pick(`Estimate type: ${m[1]}`,`Бағалау түрі: ${m[1]}`)],
  [/^Итого за весь горизонт \((.+)\)$/,m=>pick(`Total over ${text(m[1])}`,`Бүкіл мерзімдегі жиынтық (${text(m[1])})`)],
  [/^Методика: (.+)$/,m=>pick(`Methodology: ${m[1]}`,`Әдістеме: ${m[1]}`)],
  [/^База: (.+)$/,m=>pick(`Basis: ${m[1]}`,`Негіз: ${m[1]}`)],
  [/^Крона взрослая: (.+) м²$/,m=>pick(`Mature canopy: ${m[1]} m²`,`Жетілген ұшар бас: ${m[1]} м²`)],
  [/^Приживаемость: (.+) %$/,m=>pick(`Survival: ${m[1]} %`,`Жерсіну: ${m[1]} %`)],
  [/^Поглощение CO₂: (.+) кг\/год$/,m=>pick(`CO₂ uptake: ${m[1]} kg/year`,`CO₂ сіңіру: ${m[1]} кг/жыл`)],
  [/^Макс\. охлаждение: (.+) °C$/,m=>pick(`Maximum cooling: ${m[1]} °C`,`Ең жоғары салқындау: ${m[1]} °C`)],
  [/^(Воздух|Поверхность|Влажность|Ветер|Направление ветра): (.+)$/,m=>`${text(m[1])}: ${text(m[2])}`],
  [/^(Вяз|Сосна|Тополь) \((.+)\)$/,m=>`${text(m[1])} (${text(m[2])})`],
  [/^(.+) КБ$/,m=>`${text(m[1])} ${pick('KiB','КиБ')}`],
  [/^(.+) индекс$/,m=>`${m[1]} ${pick('index','индекс')}`],
  [/^(.+) т$/,m=>`${m[1]} ${pick('t','т')}`],
  [/^(.+) мкг\/м³$/,m=>`${m[1]} ${pick('µg/m³','мкг/м³')}`],
  [/^(.+) м\/с$/,m=>`${m[1]} ${pick('m/s','м/с')}`],
  [/^(.+) т\/год$/,m=>`${m[1]} ${pick('t/year','т/жыл')}`],
  [/^(.+) тенге\/год$/,m=>`${m[1]} ${pick('tenge/year','теңге/жыл')}`],
  [/^(.+) тенге(?:, KZT)?$/,m=>`${m[1]} ${pick('tenge','теңге')}`],
  [/^тенге, KZT$/,()=>pick('tenge, KZT','теңге, KZT')],
  [/^(.+) шт\.$/,m=>`${m[1]} ${pick('trees','дана')}`],
  [/^(.+) чел\.$/,m=>`${m[1]} ${pick('people','адам')}`],
  [/^(.+) (?:дерево|дерева|деревьев)$/,m=>`${m[1]} ${pick(m[1]==='1'?'tree':'trees','ағаш')}`],
  [/^(.+) (?:год|года|лет)$/,m=>`${m[1]} ${pick(m[1]==='1'?'year':'years','жыл')}`],
  [/^(.+) (?:участок|участка|участков)$/,m=>`${m[1]} ${pick(m[1]==='1'?'site':'sites','учаске')}`],
  [/^(.+) (?:зона|зоны|зон)$/,m=>`${m[1]} ${pick(m[1]==='1'?'area':'areas','аймақ')}`],
  [/^Размер JSON составляет (.+) МБ при ограничении не более 5,00 МБ\.$/,m=>pick(`JSON size is ${m[1]} MiB; the limit is 5 MiB.`,`JSON көлемі — ${m[1]} МиБ; шегі — 5 МиБ.`)],
  [/^Размер файла «(.+)» составляет (.+) МБ при ограничении не более 5,00 МБ\.$/,m=>pick(`File “${m[1]}” is ${m[2]} MiB; the limit is 5 MiB.`,`«${m[1]}» файлының көлемі — ${m[2]} МиБ; шегі — 5 МиБ.`)],
  [/^Не удалось разобрать содержимое файла «(.+)»(.*)\.$/,m=>pick(`Could not parse file “${m[1]}”${m[2]}.`,`«${m[1]}» файлын талдау мүмкін болмады${m[2]}.`)],
  [/^Файл «(.+)» не содержит данных\.$/,m=>pick(`File “${m[1]}” contains no data.`,`«${m[1]}» файлында дерек жоқ.`)],
  [/^Браузер не смог прочитать файл «(.+)»\. Проверьте права доступа и попробуйте снова\.$/,m=>pick(`The browser could not read “${m[1]}”. Check access and try again.`,`Браузер «${m[1]}» файлын оқи алмады. Қол жеткізу құқығын тексеріп, қайталаңыз.`)],
  [/^Поле «(.+)» (.+)\.$/,m=>pick(`Field “${m[1]}” ${reason(m[2])}.`,`«${m[1]}» өрісі: ${reason(m[2])}.`)],
  [/^В поле «(.+)» нижняя граница превышает верхнюю\.$/,m=>pick(`The lower bound exceeds the upper bound in “${m[1]}”.`,`«${m[1]}» өрісінде төменгі шек жоғарғы шектен асып тұр.`)],
  [/^Отсутствует обязательный раздел (.+) «(.+)»\.$/,m=>pick(`Required section “${m[2]}” is missing.`,`Міндетті «${m[2]}» бөлімі жоқ.`)],
  [/^Раздел «(.+)» (.+)\.$/,m=>pick(`Section “${m[1]}” ${reason(m[2])}.`,`«${m[1]}» бөлімі: ${reason(m[2])}.`)],
  [/^Элемент «(.+)» должен быть объектом\.$/,m=>pick(`Item “${m[1]}” must be an object.`,`«${m[1]}» элементі объект болуы керек.`)],
  [/^Необязательное поле «(.+)» содержит некорректное число\.$/,m=>pick(`Optional field “${m[1]}” contains an invalid number.`,`Міндетті емес «${m[1]}» өрісінде қате сан бар.`)],
  [/^Значение «(.+)» должно быть конечным числом( или null)?\.$/,m=>pick(`Value “${m[1]}” must be a finite number${m[2]?' or null':''}.`,`«${m[1]}» мәні шекті сан${m[2]?' немесе null':''} болуы керек.`)],
  [/^Параметр породы «(.+)» содержит неконечное число\.$/,m=>pick(`Species parameter “${m[1]}” is not finite.`,`«${m[1]}» ағаш түрі параметрі шекті сан емес.`)],
];
const reasons = {
'должно быть массивом из двух чисел [мин, макс]':['must contain two numbers [min, max]','[мин, макс] екі санынан тұратын массив болуы керек'],
'содержит некорректные или бесконечные числа':['contains invalid or non-finite numbers','қате немесе шексіз сандар бар'],
'не может содержать отрицательные значения':['must not contain negative values','теріс мәндер болмауы керек'],
'должно быть строкой даты ISO UTC или null':['must be an ISO UTC date string or null','ISO UTC күн жолы немесе null болуы керек'],
'должно быть целым положительным числом лет':['must be a positive whole number of years','жыл саны оң бүтін сан болуы керек'],
'должно быть целым неотрицательным числом':['must be a non-negative integer','теріс емес бүтін сан болуы керек'],
'должно быть текстовой строкой':['must be text','мәтіндік жол болуы керек'],
'должно иметь одно из допустимых значений: elm, pine или poplar':['must be elm, pine or poplar','elm, pine немесе poplar мәндерінің бірі болуы керек'],
'должно быть непустой строкой':['must be non-empty text','бос емес мәтіндік жол болуы керек'],
'должно быть целым положительным числом':['must be a positive integer','оң бүтін сан болуы керек'],
'должно быть конечным неотрицательным числом':['must be a finite, non-negative number','шекті, теріс емес сан болуы керек'],
'должно быть конечным числом':['must be a finite number','шекті сан болуы керек'],
'должен быть массивом участков':['must be an array of areas','учаскелер массиві болуы керек'],
'должно быть конечной широтой от -90 до 90':['must be a finite latitude between -90 and 90','ендік -90 және 90 аралығындағы шекті сан болуы керек'],
'должно быть конечной долготой от -180 до 180':['must be a finite longitude between -180 and 180','бойлық -180 және 180 аралығындағы шекті сан болуы керек'],
'должно быть непустой строкой валюты':['must be a non-empty currency string','валютаның бос емес жолы болуы керек'],
'должен быть объектом или null':['must be an object or null','объект немесе null болуы керек'],
'должно быть объектом или null':['must be an object or null','объект немесе null болуы керек'],
'должно быть строкой':['must be a string','мәтіндік жол болуы керек'],
'должно быть датой ISO UTC или null':['must be an ISO UTC date or null','ISO UTC күні немесе null болуы керек'],
'должно быть массивом строк':['must be an array of strings','жолдар массиві болуы керек'],
'должно быть объектом':['must be an object','объект болуы керек']
};
function reason(value) { const pair=reasons[value]; return pair ? pick(...pair) : pick('has an invalid value','мәні дұрыс емес'); }
function text(value) {
  if (lang==='ru' || typeof value!=='string') return value;
  const raw=normalized(value), found=dictionary.get(raw);
  if(found) return found[lang==='en'?1:2];
  if(raw.includes(' · ')) return raw.split(' · ').map(text).join(' · ');
  for(const [pattern,render] of rules){const match=raw.match(pattern);if(match)return render(match);}
  return raw;
}
function zoneName(value) {
  if(lang==='ru') return value;
  const match = value.match(/^(Есиль|Нура|Алматы|Сарыарка|Байконыр) · зона (\d+)$/);
  return match ? `${text(match[1])} · ${pick('area','аймақ')} ${match[2]}` : text(value);
}
function apply(doc=document) {
  if(!doc.createTreeWalker) return;
  doc.documentElement.lang=lang;
  const selector=doc.getElementById('report-language');if(selector)selector.value=lang;
  const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())) {
    if(node.parentElement?.closest('script, style, option, [data-original], #dec-model-note, #meth-note')) continue;
    if(!originalText.has(node))originalText.set(node,node.nodeValue);
    const source=originalText.get(node), key=normalized(source);
    if(!key)continue;
    const translated=text(key);
    const start=source.match(/^\s*/)?.[0]||'',end=source.match(/\s*$/)?.[0]||'';
    node.nodeValue=lang==='ru'?source:start+translated+end;
  }
  for(const element of doc.querySelectorAll('[aria-label], [title]')) {
    if(!originalAttributes.has(element))originalAttributes.set(element,{});
    const originals=originalAttributes.get(element);
    for(const attr of ['aria-label','title'])if(element.hasAttribute(attr)){
      if(!(attr in originals))originals[attr]=element.getAttribute(attr);
      element.setAttribute(attr,text(originals[attr]));
    }
  }
  doc.title=text('ASTRA — Печатный отчёт по сценарию озеленения');
}
function setLang(value) {if(!locales[value])return;lang=value;try{localStorage.setItem('astra:language',lang);}catch(_){}apply();}
window.ReportI18n=Object.freeze({get lang(){return lang;},get locale(){return locales[lang];},text,zoneName,apply,setLang});
try{const theme=localStorage.getItem('astra:theme');document.documentElement.dataset.theme=['forest','dark','christmas'].includes(theme)?theme:'forest';}catch(_){}
apply();
})();
