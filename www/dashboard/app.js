const REFRESH_MS = 60000;

const HISTORY_CONFIG = {
  temperature: {
    title: 'Storico Temperatura',
    description: 'Qui potrai collegare grafici di temperatura esterna, percepita, dew point e confronto con sensori interni.'
  },
  wind: {
    title: 'Storico Vento',
    description: 'Qui potrai agganciare velocità media, raffiche, rosa dei venti e distribuzione giornaliera.'
  },
  barometer: {
    title: 'Storico Barometro',
    description: 'Qui potrai visualizzare il trend di pressione e i cambiamenti nelle ultime ore o negli ultimi giorni.'
  },
  forecast: {
    title: 'Dettaglio Forecast',
    description: 'Confronto completo dei due provider con viste giornaliere e orarie. Se un provider non espone i dati orari, compare un placeholder informativo.'
  },
  daylight: {
    title: 'Storico Daylight',
    description: 'Qui potrai inserire andamento della luce, durata del giorno e variazioni stagionali.'
  },
  nearby: {
	title: 'Storico Nearby',
	description: 'Area dedicata al confronto con località vicine, stazioni limitrofe o riepilogo zone prossime.'
  },
  rainfall: {
    title: 'Storico Rainfall',
    description: 'Spazio pronto per accumuli giornalieri, intensità, eventi piovosi e grafici cumulativi.'
  },
  uv: {
    title: 'Storico UV',
    description: 'Qui potrai collegare storico UV, radiazione e fasce di rischio nel corso della giornata.'
  },
  aqi: {
    title: 'Storico AQI',
    description: 'Qui potrai confrontare AQI locale, AQI area e andamento PM1 / PM2.5 / PM10.'
  },
  astronomy: {
    title: 'Storico Astronomy',
    description: 'Area dedicata a fasi lunari, moonrise, moonset e ciclo astronomico.'
  }
};

const DASHBOARD_STATE = {
  current: null,
  currentCondition: null,
  forecastPws: null,
  forecastWu: null,
  aqi: null,
  nearby: null,
  alerts: null,
  forecastView: 'daily'
};

let radarMap = null;
let radarFrames = [];
let radarFrameIndex = 0;
let radarTimer = null;
let radarConfig = null;
let stationMarker = null;
let radarPlaying = true;

const $ = (id) => document.getElementById(id);




function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value ?? '--';
}

function safeValue(value, fallback = '--') {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str && str.toUpperCase() !== 'N/A' ? str : fallback;
}

function setHtml(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function formatTemp(num) {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return '--';
  return `${Number(num).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°C`;
}

function formatNumber(num, unit = '', digits = 0) {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return '--';
  const value = Number(num).toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value}${unit}`.trim();
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).replace(/[^0-9,.-]/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function windDirectionToText(raw) {
  const deg = parseNumber(raw);
  if (deg === null) return safeValue(raw);
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return `${dirs[index]} (${Math.round(deg)}°)`;
}

function classifyUv(value) {
  const n = parseNumber(value);
  if (n === null) return 'Indice non disponibile';
  if (n < 3) return 'Rischio basso';
  if (n < 6) return 'Rischio moderato';
  if (n < 8) return 'Rischio alto';
  if (n < 11) return 'Rischio molto alto';
  return 'Rischio estremo';
}

function uvThemeClass(value) {
  const n = parseNumber(value);
  if (n === null) return 'uv-neutral';
  if (n < 3) return 'uv-low';
  if (n < 6) return 'uv-moderate';
  if (n < 8) return 'uv-high';
  if (n < 11) return 'uv-very-high';
  return 'uv-extreme';
}

function uvVisualIcon(value) {
  const n = parseNumber(value);
  if (n === null) return '🌤️';
  if (n < 3) return '🌤️';
  if (n < 6) return '☀️';
  if (n < 8) return '🕶️';
  if (n < 11) return '🔥';
  return '⚠️';
}


function classifyPressure(value) {
  const n = parseNumber(value);
  if (n === null) return 'Trend non disponibile';
  if (n < 1000) return 'Pressione bassa';
  if (n < 1018) return 'Pressione nella norma';
  return 'Pressione alta';
}

function pressureThemeClass(value) {
  const n = parseNumber(value);
  if (n === null) return 'baro-neutral';
  if (n < 1000) return 'baro-low';
  if (n < 1018) return 'baro-normal';
  return 'baro-high';
}

function pressureGaugePercent(value) {
  const n = parseNumber(value);
  if (n === null) return 50;
  const min = 980;
  const max = 1045;
  const pct = ((n - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function classifyRain(current) {
  const n = parseNumber(current?.rainRate);
  if (n === null) return 'Intensità non disponibile';
  if (n === 0) return 'Nessuna pioggia in corso';
  if (n < 0.2) return 'Pioggia molto debole';
  if (n < 1) return 'Pioggia debole';
  if (n < 4) return 'Pioggia moderata';
  return 'Pioggia intensa';
}

function rainThemeClass(current) {
  const rate = parseNumber(current?.rainRate);
  const today = parseNumber(current?.rainToday);

  if ((rate === null || rate === 0) && (today === null || today === 0)) return 'rain-dry';
  if (rate !== null && rate > 0 && rate < 1) return 'rain-light';
  if (rate !== null && rate >= 1 && rate < 4) return 'rain-moderate';
  if (rate !== null && rate >= 4) return 'rain-heavy';
  return 'rain-light';
}

function rainfallFillPercent(current) {
  const today = parseNumber(current?.rainToday);
  if (today === null) return 0;

  const maxDailyVisual = 30; // scala visiva
  const pct = (today / maxDailyVisual) * 100;
  return Math.max(0, Math.min(100, pct));
}

function classifyAqi(localAqi, localCategory) {
  if (localCategory) return localCategory;
  const n = Number(localAqi);
  if (!Number.isFinite(n)) return 'Dato non disponibile';
  if (n <= 50) return 'Buona';
  if (n <= 100) return 'Moderata';
  if (n <= 150) return 'Non salutare per sensibili';
  if (n <= 200) return 'Non salutare';
  if (n <= 300) return 'Molto non salutare';
  return 'Pericolosa';
}

function aqiThemeClass(aqiValue) {
  const n = parseNumber(aqiValue);
  if (n === null) return 'aqi-neutral';
  if (n <= 50) return 'aqi-good';
  if (n <= 100) return 'aqi-moderate';
  if (n <= 150) return 'aqi-sensitive';
  if (n <= 200) return 'aqi-unhealthy';
  return 'aqi-danger';
}

function aqiVisualIcon(aqiValue) {
  const n = parseNumber(aqiValue);
  if (n === null) return '🌫';
  if (n <= 50) return '✅';
  if (n <= 100) return '🙂';
  if (n <= 150) return '😐';
  if (n <= 200) return '⚠️';
  return '🚨';
}

function cleanForecastSummary(summary) {
  if (!summary) return '--';
  const s = String(summary).replace(/\s+/g, ' ').trim();
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}


function formatHourLabel(value) {
  const str = safeValue(value, '--');
  if (str === '--') return str;
  const match = str.match(/(\d{2}:\d{2})/);
  return match ? match[1] : str;
}

function weatherIcon(value, fallback = '⛅') {
  if (!value) return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  if (/^[☀-⛈🌤🌥🌦🌧🌨🌩🌪🌫🌬🌙⭐❄️⛅☁️💨]+$/u.test(raw)) {
    return raw;
  }

  const normalized = raw.toLowerCase().replace(/\.(png|svg|jpg|jpeg|webp)$/i, '');
  const key = normalized.replace(/[^a-z0-9]+/g, '');

  const map = {
    sunny: '☀️',
    clear: '☀️',
    clears: '☀️',
    clearday: '☀️',
    clearn: '🌙',
    clearnight: '🌙',
    fair: '🌤️',
    mostlysunny: '🌤️',
    pcloudy: '⛅',
    partlycloudy: '⛅',
    partlycloudynight: '☁️',
    mcloudy: '☁️',
    mostlycloudy: '☁️',
    cloudy: '☁️',
    overcast: '☁️',
    lightrain: '🌦️',
    rain: '🌧️',
    rainshowers: '🌧️',
    showers: '🌦️',
    drizzle: '🌦️',
    chancetstorms: '⛈️',
    tstorms: '⛈️',
    tstorm: '⛈️',
    thunderstorm: '⛈️',
    snow: '❄️',
    sleet: '🌨️',
    flurries: '🌨️',
    fog: '🌫️',
    mist: '🌫️',
    haze: '🌫️',
    windy: '💨',
    wind: '💨'
  };

  return map[key] || fallback;
}

function normalizeConditionLabel(value) {
  const raw = safeValue(value, '').toLowerCase();
  if (!raw) return null;

  if (raw.includes('fog') || raw.includes('mist')) return 'Fog';
  if (raw.includes('haze')) return 'Haze';
  if (raw.includes('clear')) return 'Clear';
  if (raw.includes('cloud')) return 'Cloudy';
  if (raw.includes('rain') || raw.includes('drizzle') || raw.includes('shower')) return 'Rain';
  if (raw.includes('storm') || raw.includes('thunder')) return 'Thunderstorm';
  if (raw.includes('snow')) return 'Snow';

  return value;
}

function deriveLocalConditionFallback(current) {
  const humidity = parseNumber(current?.outsideHumidity);
  const wind = parseNumber(current?.windSpeed);
  const outside = parseNumber(current?.outsideTemp);
  const dew = parseNumber(current?.dewPoint);

  if (
    humidity !== null &&
    humidity >= 92 &&
    wind !== null &&
    wind < 3 &&
    outside !== null &&
    dew !== null &&
    Math.abs(outside - dew) <= 1.5
  ) {
    return {
      weather: 'Fog',
      icon: 'fog.png'
    };
  }

  if (humidity !== null && humidity >= 95 && wind !== null && wind < 3) {
    return {
      weather: 'Fog',
      icon: 'fog.png'
    };
  }

  return null;
}

function pickCurrentCondition(current, currentCondition, primaryForecast) {
  const apiCondition = currentCondition?.condition || null;
  const fallbackLocal = deriveLocalConditionFallback(current);
  const forecastDaily = primaryForecast?.daily?.[0] || {};

  const chosen = apiCondition?.weather
    ? {
        weather: normalizeConditionLabel(apiCondition.weather) || apiCondition.weather,
        icon: apiCondition.icon || forecastDaily.raw?.icon || forecastDaily.icon
      }
    : fallbackLocal
      ? fallbackLocal
      : {
          weather: normalizeConditionLabel(forecastDaily.summary) || cleanForecastSummary(forecastDaily.summary),
          icon: forecastDaily.raw?.icon || forecastDaily.icon
        };

  return {
    weather: safeValue(chosen.weather, 'Condizioni attuali'),
    icon: chosen.icon || forecastDaily.raw?.icon || forecastDaily.icon || '⛅'
  };
}

function windCardinal(raw) {
  if (raw === null || raw === undefined || raw === '') return '--';
  const value = String(raw).trim().toUpperCase();
  if (/^[NSEW]{1,3}$/.test(value)) return value;
  const deg = parseNumber(raw);
  if (deg === null) return value;
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function windRotation(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  const map = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5
  };
  if (value in map) return map[value];
  const deg = parseNumber(raw);
  return deg === null ? 0 : deg;
}

function windStateLabel(current) {
  const speed = parseNumber(current?.windSpeed);
  if (speed === null) return 'Vento non disponibile';
  if (speed < 2) return 'Calmo';
  if (speed < 10) return 'Debole';
  if (speed < 20) return 'Moderato';
  if (speed < 35) return 'Sostenuto';
  return 'Forte';
}

function windThemeClass(current) {
  const speed = parseNumber(current?.windSpeed);
  if (speed === null) return 'wind-neutral';
  if (speed < 2) return 'wind-calm';
  if (speed < 10) return 'wind-light';
  if (speed < 20) return 'wind-moderate';
  if (speed < 35) return 'wind-fresh';
  return 'wind-strong';
}

function windCompassMarkup(current) {
  const dirRaw = current?.windDir;
  const cardinal = windCardinal(dirRaw);
  const rotation = windRotation(dirRaw);

  return `
    <div class="wind-visual__compass">
      <div class="wind-visual__compass-ring"></div>
      <div class="wind-visual__compass-center">
        <div class="wind-visual__dir-value">${cardinal}</div>
      </div>
      <div class="wind-visual__arrow" style="transform: translate(-50%, -100%) rotate(${rotation}deg);">▲</div>
      <div class="wind-visual__label wind-visual__label--n">N</div>
      <div class="wind-visual__label wind-visual__label--e">E</div>
      <div class="wind-visual__label wind-visual__label--s">S</div>
      <div class="wind-visual__label wind-visual__label--w">W</div>
    </div>
  `;
}

function windBadge(dir, speed) {
  const hasSpeed = speed !== null && speed !== undefined && speed !== '' && speed !== '--' && !Number.isNaN(Number(speed));
  const cardinal = hasSpeed ? windCardinal(dir) : '';
  const speedLabel = hasSpeed ? formatNumber(speed, ' km/h') : null;

  return `
    <span class="forecast-mini-stat forecast-mini-stat--wind ${hasSpeed ? '' : 'is-empty'}">
      <span class="wind-icon" style="transform: rotate(${windRotation(dir)}deg)">↑</span>
      <span>${hasSpeed ? `${cardinal} · ${speedLabel}` : '<span class="wind-missing">—</span>'}</span>
    </span>
  `;
}

function humidityBadge(value) {
  return `<span class="forecast-mini-stat">💧 ${value !== null && value !== undefined && value !== '--' ? `${value}%` : '--'}</span>`;
}

function rainBadge(value) {
  return `<span class="forecast-mini-stat">☔ ${value !== null && value !== undefined && value !== '--' ? `${value}%` : '--'}</span>`;
}

function feelsLike(current) {
  const heatIndex = parseNumber(current?.heatIndex);
  const outsideTemp = parseNumber(current?.outsideTemp);
  const windChill = parseNumber(current?.windChill);

  if (outsideTemp === null) return '--';

  if (heatIndex !== null && Math.abs(heatIndex - outsideTemp) >= 0.3 && heatIndex > outsideTemp) {
    return formatTemp(heatIndex);
  }

  if (windChill !== null && Math.abs(windChill - outsideTemp) >= 0.3 && windChill < outsideTemp) {
    return formatTemp(windChill);
  }

  return formatTemp(outsideTemp);
}

function gustLabel(current) {
  const gust = parseNumber(current?.windGust);
  return gust !== null ? `${formatNumber(gust, ' km/h')}` : '--';
}

function uvBadgeValue(current) {
  const uv = parseNumber(current?.uvIndex);
  return uv !== null ? `${uv}` : '--';
}

function aqiBadgeValue(aqi) {
  const local = aqi?.local?.aqi;
  return local ? `${local}` : '--';
}

function buildMetaItems(items = []) {
  return items.map(({ label, value }) => `
    <div class="weather-tile__meta-item">
      <span class="weather-tile__meta-label">${label}</span>
      <span class="weather-tile__meta-value">${value}</span>
    </div>
  `).join('');
}

function setMeta(containerId, items) {
  setHtml(containerId, buildMetaItems(items));
}

async function fetchJson(path) {
  const res = await fetch(`${path}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Errore ${res.status} su ${path}`);
  return res.json();
}

function hourFromLabel(value) {
  const str = safeValue(value, '');
  const match = str.match(/(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]);
}

function isCurrentHourEntry(entry) {
  const entryHour = hourFromLabel(entry?.time);
  if (entryHour === null) return false;
  const now = new Date();
  return entryHour === now.getHours();
}

function forecastHourTheme(entry) {
  const summary = String(entry?.summary || '').toLowerCase();
  const icon = String(entry?.icon || '').toLowerCase();
  const source = `${summary} ${icon}`;

  if (/storm|thunder|tstorm|temporale/.test(source)) return 'is-storm';
  if (/rain|showers|piogg|drizzle/.test(source)) return 'is-rain';
  if (/cloud|nuvol|overcast/.test(source)) return 'is-cloudy';
  if (/sun|clear|sereno|sunny|fair/.test(source)) return 'is-sunny';
  return 'is-neutral';
}

function buildTemperatureTrendSvg(hours) {
  const valid = hours
    .map((h, i) => ({ i, temp: parseNumber(h?.temp) }))
    .filter((x) => x.temp !== null);

  if (valid.length < 2) {
    return `<div class="forecast-trend forecast-trend--empty">Trend non disponibile</div>`;
  }

  const width = 100;
  const height = 34;
  const min = Math.min(...valid.map((x) => x.temp));
  const max = Math.max(...valid.map((x) => x.temp));
  const range = Math.max(max - min, 0.1);

  const points = valid.map((p, idx) => {
    const x = (idx / (valid.length - 1)) * width;
    const y = height - (((p.temp - min) / range) * (height - 6)) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `
    <div class="forecast-trend" aria-label="Trend temperatura prossime ore">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="forecast-trend__svg">
        <polyline points="${points}" class="forecast-trend__line" />
      </svg>
    </div>
  `;
}

function alertSeverityLabel(value) {
  const s = safeValue(value, '').toLowerCase();
  if (s.includes('extreme')) return 'Extrema';
  if (s.includes('severe')) return 'Severa';
  if (s.includes('moderate')) return 'Moderata';
  if (s.includes('minor')) return 'Minore';
  return safeValue(value, 'Info');
}

function alertsThemeClass(alerts) {
  const list = Array.isArray(alerts?.alerts) ? alerts.alerts : [];
  const severities = list.map(a => String(a.severity || '').toLowerCase());

  if (severities.some(s => s.includes('extreme') || s.includes('severe'))) return 'alerts-strip--danger';
  if (severities.some(s => s.includes('moderate') || s.includes('minor'))) return 'alerts-strip--warn';
  return 'alerts-strip--ok';
}

function alertsIcon(alerts) {
  const list = Array.isArray(alerts?.alerts) ? alerts.alerts : [];
  if (!list.length) return '✅';

  const severities = list.map(a => String(a.severity || '').toLowerCase());
  if (severities.some(s => s.includes('extreme') || s.includes('severe'))) return '🚨';
  return '⚠️';
}

function formatAlertTimeRange(alert) {
  const start = safeValue(alert?.beginsISO);
  const end = safeValue(alert?.expiresISO);

  if (!start && !end) return 'Validità non disponibile';

  const startText = start ? new Date(start).toLocaleString('it-IT') : 'inizio n.d.';
  const endText = end ? new Date(end).toLocaleString('it-IT') : 'fine n.d.';
  return `${startText} → ${endText}`;
}

function renderAlertsStrip(alerts) {
  const card = $('hero_alert_card');
  if (!card) return;

  const list = Array.isArray(alerts?.alerts) ? alerts.alerts : [];
  const statusMessage = safeValue(alerts?.status?.message, 'Nessuna allerta attiva');

  card.hidden = false;
  card.classList.remove('hero-alert--ok', 'hero-alert--warn', 'hero-alert--danger');

  const theme = alertsThemeClass(alerts);
  if (theme === 'alerts-strip--danger') card.classList.add('hero-alert--danger');
  else if (theme === 'alerts-strip--warn') card.classList.add('hero-alert--warn');
  else card.classList.add('hero-alert--ok');

  setText('hero_alert_icon', alertsIcon(alerts));

  if (!list.length) {
    setText('hero_alert_title', 'Nessuna allerta attiva');
    setText('hero_alert_text', statusMessage);
    return;
  }

  const first = list[0];
  const title = list.length === 1
    ? safeValue(first.title, 'Allerta meteo')
    : `${list.length} allerte attive`;

  const text = list.length === 1
    ? `${alertSeverityLabel(first.severity)} · ${safeValue(first.source, 'Fonte non disponibile')}`
    : `${safeValue(first.title, 'Allerta meteo')} · ${alertSeverityLabel(first.severity)}`;

  setText('hero_alert_title', title);
  setText('hero_alert_text', text);
}

function renderAlertsModal(alerts) {
  const container = $('alertsModalList');
  if (!container) {
    console.error('alertsModalList non trovato');
    return;
  }

  const list = Array.isArray(alerts?.alerts) ? alerts.alerts : [];

  if (!list.length) {
    container.innerHTML = `
      <div class="alert-card">
        <div class="alert-card__top">
          <h4 class="alert-card__title">Nessuna allerta attiva</h4>
        </div>
        <div class="alert-card__meta">${safeValue(alerts?.status?.message, 'Situazione regolare')}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(alert => `
    <article class="alert-card">
      <div class="alert-card__top">
        <h4 class="alert-card__title">${safeValue(alert.title, 'Allerta meteo')}</h4>
        <div class="alert-card__severity">${alertSeverityLabel(alert.severity)}</div>
      </div>
      <div class="alert-card__meta">
        ${safeValue(alert.source, 'Fonte non disponibile')} · ${formatAlertTimeRange(alert)}
      </div>
      <div class="alert-card__body">
        ${safeValue(alert.body, 'Dettaglio non disponibile')}
      </div>
    </article>
  `).join('');
}

let alertsScrollPosition = 0;

function openAlertsModal() {
  const modal = $('alertsModal');
  if (!modal) {
    console.error('alertsModal non trovata');
    return;
  }

  alertsScrollPosition = window.scrollY || window.pageYOffset || 0;

  document.body.style.position = 'fixed';
  document.body.style.top = `-${alertsScrollPosition}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeAlertsModal() {
  const modal = $('alertsModal');
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');

  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';

  window.scrollTo(0, alertsScrollPosition);
}

function bindAlertsUi() {
  $('alerts_open_button')?.addEventListener('click', (ev) => {
    ev.preventDefault();

    const modal = $('alertsModal');
    const list = $('alertsModalList');

    if (!modal || !list) {
      console.error('Alerts modal non trovata nel DOM');
      return;
    }

    renderAlertsModal(DASHBOARD_STATE.alerts || {});
    openAlertsModal();
  });

  document.querySelectorAll('[data-alerts-close]').forEach((el) => {
    el.addEventListener('click', closeAlertsModal);
  });
}

function buildHourlyStrip(forecast) {
  const hours = Array.isArray(forecast.hourly)
    ? forecast.hourly.slice(0, 18)
    : [];

  if (!hours.length) return '';

  return `
    <div class="forecast-hourly-wrap">
      ${buildTemperatureTrendSvg(hours)}

      <div class="forecast-hourly-strip">
        ${hours.map((h) => {
          const isNow = isCurrentHourEntry(h);
          const theme = forecastHourTheme(h);

          return `
            <div class="forecast-hourly-card ${theme} ${isNow ? 'is-current' : ''}">
              <div class="forecast-hourly-card__time">
                ${formatHourLabel(h.time)}
                ${isNow ? '<span class="forecast-hourly-card__now-badge">Adesso</span>' : ''}
              </div>

              <div class="forecast-hourly-card__icon">${safeValue(h.icon, '⛅')}</div>
              <div class="forecast-hourly-card__temp">${formatTemp(h.temp)}</div>

              <div class="forecast-hourly-card__meta">
                ${humidityBadge(h.humidity)}
                ${rainBadge(h.rainProb)}
              </div>

              <div class="forecast-hourly-card__meta">
                ${windBadge(h.windDir, h.windKmh)}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function normalizeForecastDay(day = {}, index = 0) {
  return {
    label: safeValue(day.dayLabel || day.day || day.name || day.weekday || `Giorno ${index + 1}`),
    icon: weatherIcon(day.icon),
    summary: safeValue(day.summary || day.narrative || day.text || day.phrase, 'Dettaglio non disponibile'),
    min: parseNumber(day.min ?? day.tempMin ?? day.low ?? day.temperatureMin),
    max: parseNumber(day.max ?? day.tempMax ?? day.high ?? day.temperatureMax),
    rainProb: parseNumber(day.rainProb ?? day.precipProbability ?? day.pop ?? day.precipChance),
    windKmh: parseNumber(day.windKmh ?? day.windSpeed ?? day.windKph),
    windDir: safeValue(day.windDir ?? day.windDirectionCardinal ?? day.windDirection, '--'),
    humidity: parseNumber(day.humidity),
    raw: day
  };
}

function normalizeForecastHourlyEntry(entry = {}, index = 0) {
  return {
    time: safeValue(entry.time || entry.validTimeLocal || entry.hour || entry.timestamp || `Ora ${index + 1}`),
    icon: weatherIcon(entry.icon),
    summary: safeValue(entry.summary || entry.condition || entry.wxPhraseLong || entry.text || entry.narrative, 'Dettaglio non disponibile'),
    temp: parseNumber(entry.temp ?? entry.temperature),
    feelsLike: parseNumber(entry.feelsLike ?? entry.feels_like),
    rainProb: parseNumber(entry.rainProb ?? entry.precipProbability ?? entry.pop ?? entry.precipChance),
    windKmh: parseNumber(entry.windKmh ?? entry.windSpeed ?? entry.windKph),
    windDir: safeValue(entry.windDir ?? entry.windDirectionCardinal ?? entry.windDirection, '--'),
    humidity: parseNumber(entry.humidity),
    pressure: parseNumber(entry.pressure),
    uv: parseNumber(entry.uv),
    raw: entry
  };
}

function extractHourlyList(data) {
  const candidates = [data?.hourly, data?.hourly_forecast, data?.hours, data?.periods, data?.hourlyForecast];
  const list = candidates.find((item) => Array.isArray(item) && item.length);
  return list ? list.map(normalizeForecastHourlyEntry) : [];
}

function normalizeForecastPartEntry(entry = {}, index = 0) {
  const temp = parseNumber(entry.temp);
  const tempMin = parseNumber(entry.tempMin);
  const tempMax = parseNumber(entry.tempMax);
  return {
    label: safeValue(entry.label || entry.name || `Fascia ${index + 1}`),
    icon: weatherIcon(entry.icon, '🌥️'),
    summary: safeValue(entry.summary, 'Dettaglio fascia non disponibile'),
    temp,
    tempMin,
    tempMax,
    rainProb: parseNumber(entry.rainProb ?? entry.pop ?? entry.precipChance),
    windKmh: parseNumber(entry.windKmh ?? entry.windSpeed ?? entry.windKph),
    windDir: safeValue(entry.windDir ?? entry.windDirectionCardinal ?? entry.windDirection, '--'),
    humidity: parseNumber(entry.humidity),
    raw: entry
  };
}

function extractDayPartsFromDaily(daily = []) {
  const first = daily[0] || {};
  return [
    {
      label: 'Giorno',
      icon: first.icon || '🌤️',
      summary: safeValue(first.summary, 'Dettaglio giorno non disponibile'),
      temp: first.max,
      tempMin: first.min,
      tempMax: first.max,
      rainProb: first.rainProb,
      windKmh: first.windKmh,
      windDir: first.windDir,
      humidity: first.humidity
    },
    {
      label: 'Notte',
      icon: first.icon || '🌙',
      summary: first.min !== null ? `Minima prevista ${formatTemp(first.min)}` : 'Dettaglio notte non disponibile',
      temp: first.min,
      tempMin: first.min,
      tempMax: first.max,
      rainProb: first.rainProb,
      windKmh: first.windKmh,
      windDir: first.windDir,
      humidity: first.humidity
    }
  ];
}

function normalizeForecast(data) {
  const providerObj = data?.provider;
  const providerName = typeof providerObj === 'object'
    ? safeValue(providerObj?.name || providerObj?.id, 'Provider forecast')
    : safeValue(providerObj, 'Provider forecast');
  const dailyRaw = Array.isArray(data?.daily) ? data.daily : [];
  const daily = dailyRaw.map(normalizeForecastDay);
  const hourly = extractHourlyList(data).slice(0, 18);
  const partsRaw = Array.isArray(data?.parts) ? data.parts.map(normalizeForecastPartEntry) : [];

  return {
    provider: providerName,
    updated: safeValue(data?.updated),
    status: data?.status || {},
    daily,
    hourly,
    dayparts: partsRaw.length ? partsRaw : extractDayPartsFromDaily(daily),
    raw: data
  };
}


function pickHeroTheme(summary, icon) {
  const source = `${summary || ''} ${icon || ''}`.toLowerCase();
  if (/storm|thunder|tstorm|temporale/.test(source)) return 'is-rainy';
  if (/rain|showers|piogg|drizzle/.test(source)) return 'is-rainy';
  if (/cloud|nuvol|overcast/.test(source)) return 'is-cloudy';
  if (/partly|mostlysunny|fair|variab|schiar/.test(source)) return 'is-partly-cloudy';
  return 'is-clear';
}

function renderHero(current, primaryForecast, currentCondition) {	
  const currentVisual = pickCurrentCondition(current, currentCondition, primaryForecast);
  const heroSummary = currentVisual.weather;

  const heroEl = document.querySelector('.hero-current');
  if (heroEl) {
    heroEl.classList.remove('is-clear', 'is-partly-cloudy', 'is-cloudy', 'is-rainy');
    heroEl.classList.add(pickHeroTheme(heroSummary, currentVisual.icon));
  }

  setText('hero_current_icon', weatherIcon(currentVisual.icon, '⛅'));
  
  const windSpeed = safeValue(current.windSpeed);
  const windDir = windDirectionToText(current.windDir);
  const gust = gustLabel(current);
  const rainToday = safeValue(current.rainToday);
  const rainRate = safeValue(current.rainRate);
  const uvValue = uvBadgeValue(current);
  const aqiValue = aqiBadgeValue(DASHBOARD_STATE.aqi);

  setText('hero_outside_temp', safeValue(current.outsideTemp));
  setText('hero_summary', heroSummary);
  setText('hero_feels_like', feelsLike(current));

	setHtml('hero_inline_metrics', `
	  <div class="hero-inline-stat">💧 <span>Umidità</span> <strong>${safeValue(current.outsideHumidity)}</strong></div>
	  <div class="hero-inline-stat hero-inline-stat--rain">☔ <span>Pioggia</span> <strong>oggi ${rainToday} · rate ${rainRate}</strong></div>
	  <div class="hero-inline-stat">🌬 <span>Vento</span> <strong>${windSpeed} · ${windDir}</strong></div>
	  <div class="hero-inline-stat">💨 <span>Gust</span> <strong>${gust}</strong></div>
	  <div class="hero-inline-stat">📈 <span>Pressione</span> <strong>${safeValue(current.barometer)}</strong></div>
	  <div class="hero-inline-stat">💠 <span>Dew</span> <strong>${safeValue(current.dewPoint)}</strong></div>
	  <div class="hero-inline-stat hero-inline-stat--uv">☀️ <span>UV</span> <strong class="hero-inline-stat__badge hero-inline-stat__badge--uv">${uvValue}</strong></div>
	  <div class="hero-inline-stat hero-inline-stat--aqi">🌫 <span>AQI</span> <strong class="hero-inline-stat__badge hero-inline-stat__badge--aqi">${aqiValue}</strong></div>
	`);

	setHtml('hero_bottom_cards', `
	  <div class="metric-chip">
		<span class="metric-chip__label">Aggiornato</span>
		<span class="metric-chip__value">${safeValue(current.updated)}</span>
	  </div>
	`);
}

function temperatureThemeClass(current) {
  const t = parseNumber(current?.outsideTemp);
  if (t === null) return 'temp-neutral';
  if (t < 5) return 'temp-cold';
  if (t < 12) return 'temp-cool';
  if (t < 22) return 'temp-mild';
  if (t < 30) return 'temp-warm';
  return 'temp-hot';
}

function temperatureVisualIcon(current) {
  const t = parseNumber(current?.outsideTemp);
  if (t === null) return '🌡️';
  if (t < 5) return '❄️';
  if (t < 12) return '🧥';
  if (t < 22) return '⛅';
  if (t < 30) return '☀️';
  return '🔥';
}


function temperatureStateLabel(current) {
  const t = parseNumber(current?.outsideTemp);
  if (t === null) return 'Temperatura non disponibile';
  if (t < 5) return 'Freddo';
  if (t < 12) return 'Fresco';
  if (t < 24) return 'Mite';
  if (t < 30) return 'Caldo';
  return 'Molto caldo';
}

function renderTemperatureTile(current) {
  const outside = parseNumber(current?.outsideTemp);
  const outsideFormatted = formatTemp(outside);
  const feels = feelsLike(current);
  const dew = safeValue(current.dewPoint);
  const heatIndex = safeValue(current.heatIndex);
  const windChill = safeValue(current.windChill);
  const extra = safeValue(current.temperature1);
  const humidity = safeValue(current.outsideHumidity);
  const icon = temperatureVisualIcon(current);

  const feelsIsDifferent = feels !== outsideFormatted;

  const tile = document.getElementById('tile_temperature');
  if (tile) {
    tile.classList.remove('temp-cold', 'temp-cool', 'temp-mild', 'temp-warm', 'temp-hot', 'temp-neutral');
    tile.classList.add(temperatureThemeClass(current));
  }

  setHtml('temperature_value', `
    <div class="temp-visual">
      <div class="temp-visual__hero">
        <div class="temp-visual__icon-wrap">
          <div class="temp-visual__icon-glow"></div>
          <div class="temp-visual__icon">${icon}</div>
        </div>

        <div class="temp-visual__main">
          <div class="temp-visual__number">${outsideFormatted}</div>
          <div class="temp-visual__state">${temperatureStateLabel(current)}</div>
        </div>
      </div>

      <div class="temp-visual__pills">
        ${feelsIsDifferent ? `<span class="temp-visual__pill">🌡 Percepita ${feels}</span>` : ''}
        <span class="temp-visual__pill">💠 Dew ${dew}</span>
        <span class="temp-visual__pill">💧 ${humidity}</span>
      </div>
    </div>
  `);

  setText(
    'temperature_summary',
    feelsIsDifferent
      ? 'La temperatura percepita differisce da quella rilevata.'
      : 'Condizioni termiche stabili.'
  );

  setHtml('temperature_meta', `
    <div class="temp-info-card">
      <span class="temp-info-card__label">Heat Index</span>
      <span class="temp-info-card__value">${heatIndex}</span>
    </div>

    <div class="temp-info-card">
      <span class="temp-info-card__label">Wind Chill</span>
      <span class="temp-info-card__value">${windChill}</span>
    </div>

    <div class="temp-info-card">
      <span class="temp-info-card__label">Sensore extra</span>
      <span class="temp-info-card__value">${extra}</span>
    </div>
  `);
}

function renderWindTile(current) {
  const tile = document.getElementById('tile_wind');
  if (tile) {
    tile.classList.remove('wind-calm', 'wind-light', 'wind-moderate', 'wind-fresh', 'wind-strong', 'wind-neutral');
    tile.classList.add(windThemeClass(current));
  }

  const speed = safeValue(current.windSpeed);
  const gust = safeValue(current.windGust);
  const directionText = windDirectionToText(current.windDir);
  const state = windStateLabel(current);

  setHtml('wind_value', `
    <div class="wind-visual">
      <div class="wind-visual__top">
        <div class="wind-visual__main">
          <div class="wind-visual__speed">${speed}</div>
          <div class="wind-visual__state">${state}</div>
        </div>
        ${windCompassMarkup(current)}
      </div>

      <div class="wind-visual__pills">
        <span class="wind-visual__pill">🧭 ${directionText}</span>
        <span class="wind-visual__pill">💨 Raffica ${gust}</span>
      </div>
    </div>
  `);

  setText('wind_summary', `${state} · ${directionText}`);

  setHtml('wind_meta', `
    <div class="wind-info-card">
      <span class="wind-info-card__label">Direzione</span>
      <span class="wind-info-card__value">${directionText}</span>
    </div>

    <div class="wind-info-card">
      <span class="wind-info-card__label">Raffica</span>
      <span class="wind-info-card__value">${gust}</span>
    </div>

    <div class="wind-info-card">
      <span class="wind-info-card__label">Condizione</span>
      <span class="wind-info-card__value">${state}</span>
    </div>
  `);
}

function renderBarometerTile(current) {
  const tile = document.getElementById('tile_barometer');
  if (tile) {
    tile.classList.remove('baro-low', 'baro-normal', 'baro-high', 'baro-neutral');
    tile.classList.add(pressureThemeClass(current.barometer));
  }

  const pressure = safeValue(current.barometer);
  const pressureState = classifyPressure(current.barometer);
  const gaugePercent = pressureGaugePercent(current.barometer);

  setHtml('barometer_value', `
    <div class="baro-visual baro-visual--side">
      <div class="baro-visual__gauge-wrap">
        <div class="baro-visual__gauge baro-visual__gauge--compact">
          <div class="baro-visual__arc"></div>
          <div class="baro-visual__needle" style="left: ${gaugePercent}%"></div>
        </div>
      </div>

      <div class="baro-visual__sidecopy">
        <div class="baro-visual__value">${pressure}</div>
        <div class="baro-visual__state">${pressureState}</div>
      </div>
    </div>
  `);

  setText('barometer_summary', pressureState);

  setHtml('barometer_meta', `
    <div class="baro-info-card">
      <span class="baro-info-card__label">Aggiornato</span>
      <span class="baro-info-card__value">${safeValue(current.updated)}</span>
    </div>

    <div class="baro-info-card">
      <span class="baro-info-card__label">Umidità</span>
      <span class="baro-info-card__value">${safeValue(current.outsideHumidity)}</span>
    </div>

    <div class="baro-info-card">
      <span class="baro-info-card__label">Dew point</span>
      <span class="baro-info-card__value">${safeValue(current.dewPoint)}</span>
    </div>
  `);
}

function buildCompactProviderCard(forecast) {
  const parts = Array.isArray(forecast.dayparts) ? forecast.dayparts.slice(0, 2) : [];
  const fallbackDaily = Array.isArray(forecast.daily) ? forecast.daily[0] : null;

  const compactBlocks = parts.length
    ? parts.map((part) => {
        const tempLabel =
          part.temp !== null && part.temp !== undefined
            ? formatTemp(part.temp)
            : `${formatTemp(part.tempMin)} / ${formatTemp(part.tempMax)}`;

        return `
          <div class="forecast-compact-block">
            <div class="forecast-compact-block__top">
              <span class="forecast-compact-block__label">${safeValue(part.label, 'Fascia')}</span>
              <span class="forecast-compact-block__icon">${safeValue(part.icon, '⛅')}</span>
            </div>

            <div class="forecast-compact-block__temp">${tempLabel}</div>
            <div class="forecast-compact-block__summary">${cleanForecastSummary(part.summary)}</div>

            <div class="forecast-compact-block__meta">
              ${humidityBadge(part.humidity)}
              ${rainBadge(part.rainProb)}
            </div>

            <div class="forecast-compact-block__meta">
              ${windBadge(part.windDir, part.windKmh)}
            </div>
          </div>
        `;
      }).join('')
    : `
      <div class="forecast-compact-block">
        <div class="forecast-compact-block__top">
          <span class="forecast-compact-block__label">Oggi</span>
          <span class="forecast-compact-block__icon">${safeValue(fallbackDaily?.icon, '⛅')}</span>
        </div>

        <div class="forecast-compact-block__temp">${formatTemp(fallbackDaily?.min)} / ${formatTemp(fallbackDaily?.max)}</div>
        <div class="forecast-compact-block__summary">${cleanForecastSummary(fallbackDaily?.summary)}</div>

        <div class="forecast-compact-block__meta">
          ${humidityBadge(fallbackDaily?.humidity)}
          ${rainBadge(fallbackDaily?.rainProb)}
        </div>

        <div class="forecast-compact-block__meta">
          ${windBadge(fallbackDaily?.windDir, fallbackDaily?.windKmh)}
        </div>
      </div>
    `;

  return `
    <article class="provider-card provider-card--compact-forecast">
      <div class="provider-card__top">
        <div>
          <p class="provider-card__title">${forecast.provider}</p>
          <p class="provider-card__sub">Confronto rapido giorno / notte</p>
        </div>
        <span class="provider-card__updated">${forecast.updated}</span>
      </div>

      <div class="forecast-compact-grid">
        ${compactBlocks}
      </div>
    </article>
  `;
}

function renderForecastTile(forecastPws, forecastWu) {
  setText('forecast_subtitle', 'PWS/Xweather + Weather Underground');
  setHtml('forecast_compact_list', `
	  ${buildHourlyStrip(forecastPws)}
  `);

  const pwsToday = forecastPws.daily?.[0] || {};
  const wuToday = forecastWu.daily?.[0] || {};

  const pwsText = forecastPws.daily?.length
    ? `${formatTemp(pwsToday.min)} / ${formatTemp(pwsToday.max)}`
    : 'n.d.';

  const wuText = forecastWu.daily?.length
    ? `${formatTemp(wuToday.min)} / ${formatTemp(wuToday.max)}`
    : 'n.d.';

  setText('forecast_summary', `Oggi: PWS ${pwsText} · WU ${wuText}`);
}

function parseClockToMinutes(value) {
  const str = safeValue(value, '');
  const match = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return (hh * 60) + mm;
}

function nowMinutesLocal() {
  const now = new Date();
  return (now.getHours() * 60) + now.getMinutes();
}

function daylightProgressInfo(sunrise, sunset) {
  const rise = parseClockToMinutes(sunrise);
  const set = parseClockToMinutes(sunset);
  const now = nowMinutesLocal();

  if (rise === null || set === null || set <= rise) {
    return {
      progress: 0,
      label: 'Dati luce non disponibili',
      sublabel: 'Orari non validi',
      isDay: false
    };
  }

  const daylightDuration = set - rise;

  if (now < rise) {
    const remaining = rise - now;
    const h = Math.floor(remaining / 60);
    const m = remaining % 60;
    return {
      progress: 0,
      label: `${h}h ${m}m`,
      sublabel: 'all’alba',
      isDay: false
    };
  }

  if (now > set) {
    const nextRise = (24 * 60 - now) + rise;
    const h = Math.floor(nextRise / 60);
    const m = nextRise % 60;
    return {
      progress: 100,
      label: `${h}h ${m}m`,
      sublabel: 'alla prossima alba',
      isDay: false
    };
  }

  const elapsed = now - rise;
  const remaining = set - now;
  const progress = (elapsed / daylightDuration) * 100;
  const h = Math.floor(remaining / 60);
  const m = remaining % 60;

  return {
    progress: Math.max(0, Math.min(100, progress)),
    label: `${h}h ${m}m`,
    sublabel: 'al tramonto',
    isDay: true
  };
}

function daylightThemeClass(sunrise, sunset) {
  const info = daylightProgressInfo(sunrise, sunset);
  return info.isDay ? 'daylight-day' : 'daylight-night';
}

function renderDaylightTile(wuForecast) {
  const astro = wuForecast?.raw?.astronomy || {};

  const sunrise =
    astro.sunrise ??
    wuForecast?.raw?.sunrise ??
    wuForecast?.raw?.astro?.sunrise ??
    wuForecast?.raw?.daily?.[0]?.sunrise ??
    '--';

  const sunset =
    astro.sunset ??
    wuForecast?.raw?.sunset ??
    wuForecast?.raw?.astro?.sunset ??
    wuForecast?.raw?.daily?.[0]?.sunset ??
    '--';

  const tile = document.getElementById('tile_daylight');
  if (tile) {
    tile.classList.remove('daylight-day', 'daylight-night');
    tile.classList.add(daylightThemeClass(sunrise, sunset));
  }

  const info = daylightProgressInfo(sunrise, sunset);

  setHtml('daylight_value', `
    <div class="daylight-visual">
      <div class="daylight-visual__dial-wrap">
        <div class="daylight-visual__dial">
          <div class="daylight-visual__arc"></div>
          <div class="daylight-visual__progress" style="--daylight-progress:${info.progress}%;"></div>

          <div class="daylight-visual__center">
            <div class="daylight-visual__remaining">${info.label}</div>
            <div class="daylight-visual__remaining-sub">${info.sublabel}</div>
          </div>

          <div class="daylight-visual__sunrise">🌅 ${safeValue(sunrise)}</div>
          <div class="daylight-visual__sunset">🌇 ${safeValue(sunset)}</div>
        </div>
      </div>
    </div>
  `);

  setText(
    'daylight_summary',
    info.isDay ? 'Giorno in corso' : 'Fascia notturna'
  );

  setHtml('daylight_meta', `
    <div class="daylight-info-card">
      <span class="daylight-info-card__label">Alba</span>
      <span class="daylight-info-card__value">${safeValue(sunrise)}</span>
    </div>

    <div class="daylight-info-card">
      <span class="daylight-info-card__label">Tramonto</span>
      <span class="daylight-info-card__value">${safeValue(sunset)}</span>
    </div>

    <div class="daylight-info-card">
      <span class="daylight-info-card__label">Provider</span>
      <span class="daylight-info-card__value">${safeValue(wuForecast?.provider)}</span>
    </div>
  `);
}

function renderRainfallTile(current, primaryForecast) {
  const tile = document.getElementById('tile_rainfall');
  if (tile) {
    tile.classList.remove('rain-dry', 'rain-light', 'rain-moderate', 'rain-heavy');
    tile.classList.add(rainThemeClass(current));
  }

  const rainToday = safeValue(current.rainToday);
  const rainRate = safeValue(current.rainRate);
  const rainState = classifyRain(current);
  const fillPercent = rainfallFillPercent(current);
  const forecastRain = primaryForecast?.daily?.[0]?.rainProb !== null && primaryForecast?.daily?.[0]?.rainProb !== undefined
    ? `${primaryForecast.daily[0].rainProb}%`
    : '--';

  setHtml('rainfall_value', `
    <div class="rain-visual">
      <div class="rain-visual__top">
        <div class="rain-visual__glass-wrap">
          <div class="rain-visual__glass">
            <div class="rain-visual__water" style="height: ${fillPercent}%"></div>
            <div class="rain-visual__glass-shine"></div>
          </div>
        </div>

        <div class="rain-visual__main">
          <div class="rain-visual__number">${rainToday}</div>
          <div class="rain-visual__state">${rainState}</div>
        </div>
      </div>

      <div class="rain-visual__pills">
        <span class="rain-visual__pill">💧 Rate ${rainRate}</span>
        <span class="rain-visual__pill">☔ Forecast ${forecastRain}</span>
      </div>
    </div>
  `);

  setText('rainfall_summary', `${rainState} · Rate ${rainRate}`);

  setHtml('rainfall_meta', `
    <div class="rain-info-card">
      <span class="rain-info-card__label">Rain Rate</span>
      <span class="rain-info-card__value">${rainRate}</span>
    </div>

    <div class="rain-info-card">
      <span class="rain-info-card__label">Forecast pioggia</span>
      <span class="rain-info-card__value">${forecastRain}</span>
    </div>

    <div class="rain-info-card">
      <span class="rain-info-card__label">Ultimo update</span>
      <span class="rain-info-card__value">${safeValue(current.updated)}</span>
    </div>
  `);
}

function renderUvTile(current) {
  const tile = document.getElementById('tile_uv');
  const uv = safeValue(current.uvIndex);
  const uvState = classifyUv(current.uvIndex);
  const radiation = safeValue(current.radiation);
  const activeState = parseNumber(current.uvIndex) > 0 ? 'Attivo' : 'Basso / assente';
  const icon = uvVisualIcon(current.uvIndex);

  if (tile) {
    tile.classList.remove('uv-low', 'uv-moderate', 'uv-high', 'uv-very-high', 'uv-extreme', 'uv-neutral');
    tile.classList.add(uvThemeClass(current.uvIndex));
  }

  setHtml('uv_value', `
    <div class="uv-visual">
      <div class="uv-visual__top">
        <div class="uv-visual__icon-wrap">
          <div class="uv-visual__icon-glow"></div>
          <div class="uv-visual__icon">${icon}</div>
        </div>

        <div class="uv-visual__main">
          <div class="uv-visual__number">${uv}</div>
          <div class="uv-visual__state">${uvState}</div>
        </div>
      </div>

      <div class="uv-visual__pills">
        <span class="uv-visual__pill">☀️ UV ${uv}</span>
        <span class="uv-visual__pill">📡 ${radiation}</span>
      </div>
    </div>
  `);

  setText('uv_summary', `${uvState} · Radiazione ${radiation}`);

  setHtml('uv_meta', `
    <div class="uv-info-card">
      <span class="uv-info-card__label">UV Index</span>
      <span class="uv-info-card__value">${uv}</span>
    </div>

    <div class="uv-info-card">
      <span class="uv-info-card__label">Radiazione</span>
      <span class="uv-info-card__value">${radiation}</span>
    </div>

    <div class="uv-info-card">
      <span class="uv-info-card__label">Stato</span>
      <span class="uv-info-card__value">${activeState}</span>
    </div>
  `);
}

function renderAqiTile(aqi) {
  const tile = document.getElementById('tile_aqi');
  const local = aqi?.local || {};
  const area = aqi?.area || {};

  if (tile) {
    tile.classList.remove('aqi-good', 'aqi-moderate', 'aqi-sensitive', 'aqi-unhealthy', 'aqi-danger', 'aqi-neutral');
    tile.classList.add(aqiThemeClass(local.aqi));
  }

  const localAqi = local.aqi ?? '--';
  const areaAqi = area.aqi ?? '--';
  const localState = classifyAqi(local.aqi, local.category);
  const comparison = safeValue(aqi?.comparison, 'Confronto non disponibile');
  const icon = aqiVisualIcon(local.aqi);

  setHtml('aqi_value', `
    <div class="aqi-visual">
      <div class="aqi-visual__top">
        <div class="aqi-visual__icon-wrap">
          <div class="aqi-visual__icon-glow"></div>
          <div class="aqi-visual__icon">${icon}</div>
        </div>

        <div class="aqi-visual__main">
          <div class="aqi-visual__numbers">
            <div class="aqi-visual__number-block">
              <div class="aqi-visual__number-label">Locale</div>
              <div class="aqi-visual__number">${localAqi}</div>
            </div>

            <div class="aqi-visual__number-block aqi-visual__number-block--secondary">
              <div class="aqi-visual__number-label">Area</div>
              <div class="aqi-visual__number-secondary">${areaAqi}</div>
            </div>
          </div>

          <div class="aqi-visual__state">${localState}</div>
        </div>
      </div>

      <div class="aqi-visual__pills">
        <span class="aqi-visual__pill">📍 Locale ${localAqi}</span>
        <span class="aqi-visual__pill">🌍 Area ${areaAqi}</span>
        <span class="aqi-visual__pill">📊 ${comparison}</span>
      </div>
    </div>
  `);

  setText('aqi_summary', `${localState} · ${comparison}`);

  setHtml('aqi_meta', `
    <div class="aqi-info-card">
      <span class="aqi-info-card__label">PM1</span>
      <span class="aqi-info-card__value">${local.pm1_0 ?? local.pm1 ?? '--'}</span>
    </div>

    <div class="aqi-info-card">
      <span class="aqi-info-card__label">PM2.5</span>
      <span class="aqi-info-card__value">${local.pm2_5 ?? '--'}</span>
    </div>

    <div class="aqi-info-card">
      <span class="aqi-info-card__label">PM10</span>
      <span class="aqi-info-card__value">${local.pm10_0 ?? '--'}</span>
    </div>
  `);
}

function moonPhaseIcon(phase) {
  const p = String(phase || '').toLowerCase();

  if (/new|nuova/.test(p)) return '🌑';
  if (/waxing crescent|crescente/.test(p)) return '🌒';
  if (/first quarter|primo quarto/.test(p)) return '🌓';
  if (/waxing gibbous|gibbosa crescente/.test(p)) return '🌔';
  if (/full|piena/.test(p)) return '🌕';
  if (/waning gibbous|gibbosa calante/.test(p)) return '🌖';
  if (/last quarter|ultimo quarto|third quarter/.test(p)) return '🌗';
  if (/waning crescent|calante/.test(p)) return '🌘';

  return '🌙';
}

function astronomyThemeClass(phase) {
  const p = String(phase || '').toLowerCase();
  if (/full|piena/.test(p)) return 'astro-full';
  if (/new|nuova/.test(p)) return 'astro-new';
  if (/quarter|quarto/.test(p)) return 'astro-quarter';
  return 'astro-moon';
}

function renderAstronomyTile(wuForecast) {
  const astro = wuForecast?.raw?.astronomy || {};

  const moonrise =
    astro.moonrise ??
    wuForecast?.raw?.moonrise ??
    wuForecast?.raw?.astro?.moonrise ??
    wuForecast?.raw?.daily?.[0]?.moonrise ??
    '--';

  const moonset =
    astro.moonset ??
    wuForecast?.raw?.moonset ??
    wuForecast?.raw?.astro?.moonset ??
    wuForecast?.raw?.daily?.[0]?.moonset ??
    '--';

  const moonPhase =
    astro.moonPhase ??
    wuForecast?.raw?.moonPhase ??
    wuForecast?.raw?.moon_phase ??
    wuForecast?.raw?.astro?.moonPhase ??
    wuForecast?.raw?.daily?.[0]?.moonPhase ??
    'Fase non disponibile';

  const tile = document.getElementById('tile_astronomy');
  if (tile) {
    tile.classList.remove('astro-full', 'astro-new', 'astro-quarter', 'astro-moon');
    tile.classList.add(astronomyThemeClass(moonPhase));
  }

  const moonIcon = moonPhaseIcon(moonPhase);

  setHtml('astronomy_value', `
    <div class="astro-visual">
      <div class="astro-visual__top">
        <div class="astro-visual__moon-wrap">
          <div class="astro-visual__moon-glow"></div>
          <div class="astro-visual__moon-disc">
            <div class="astro-visual__moon-icon">${moonIcon}</div>
          </div>
        </div>

        <div class="astro-visual__main">
          <div class="astro-visual__phase">${safeValue(moonPhase)}</div>
          <div class="astro-visual__state">Vista lunare attuale</div>
        </div>
      </div>

      <div class="astro-visual__pills">
        <span class="astro-visual__pill">🌙 Moonrise ${safeValue(moonrise)}</span>
        <span class="astro-visual__pill">🌘 Moonset ${safeValue(moonset)}</span>
      </div>
    </div>
  `);

  setText('astronomy_summary', `Luna: ${safeValue(moonrise)} → ${safeValue(moonset)}`);

  setHtml('astronomy_meta', `
    <div class="astro-info-card">
      <span class="astro-info-card__label">Moonrise</span>
      <span class="astro-info-card__value">${safeValue(moonrise)}</span>
    </div>

    <div class="astro-info-card">
      <span class="astro-info-card__label">Moonset</span>
      <span class="astro-info-card__value">${safeValue(moonset)}</span>
    </div>

    <div class="astro-info-card">
      <span class="astro-info-card__label">Provider</span>
      <span class="astro-info-card__value">${safeValue(wuForecast?.provider)}</span>
    </div>
  `);
}

function renderNearbyTile(nearby) {
  const places = Array.isArray(nearby?.places) ? nearby.places.slice(0, 6) : [];
  const primary = places[0] || null;

  if (!primary) {
    setText('nearby_value', '--');
    setText('nearby_summary', 'Dati località vicine non disponibili');
    setHtml('nearby_meta', '');
    return;
  }

  // === HERO (top)
  const temp = primary.tempC !== null ? formatTemp(primary.tempC) : '--';
  const condition = `
	${weatherIcon(primary.icon)} ${safeValue(primary.weather, '--')}
  `;

  const wind = primary.windKph !== null
    ? `${formatNumber(primary.windKph, ' km/h', 0)} ${windDirectionToText(primary.windDirDeg)}`
    : '--';

  const humidity = primary.humidity !== null
    ? `${formatNumber(primary.humidity, '%', 0)}`
    : '--';

  setHtml('nearby_value', `
    <div class="nearby-hero">
      <div class="nearby-temp">${temp}</div>
      <div class="nearby-extra">
        <div class="nearby-cond">${condition}</div>
        <div>💨 ${wind}</div>
        <div>💧 ${humidity}</div>
      </div>
    </div>
  `);

  setText('nearby_summary', `${safeValue(primary.name, '')}`);

  // === LISTA LOCALITÀ
  setHtml('nearby_meta', places.map((p) => {
    const temp = p.tempC !== null ? formatTemp(p.tempC) : '--';
    const wind = p.windKph !== null ? formatNumber(p.windKph, ' km/h', 0) : '--';
    const humidity = p.humidity !== null ? formatNumber(p.humidity, '%', 0) : '--';

    const distance = p.distance_km !== null ? `${p.distance_km} km` : '';

    return `
      <div class="nearby-row">
        <div class="nearby-row-left">
          <div class="nearby-name">${safeValue(p.name, 'Località')}</div>
          <div class="nearby-distance">${distance}</div>
        </div>

        <div class="nearby-row-right">
		  <span>${temp}</span>
		  <span>${weatherIcon(p.icon)}</span>
          <span>💨 ${wind}</span>
          <span>💧 ${humidity}</span>
        </div>
      </div>
    `;
  }).join(''));
}

function renderSimpleHistoryPlaceholder(type) {
  const cfg = HISTORY_CONFIG[type] || { title: 'Storico', description: 'Area placeholder.' };
  setText('history_title', cfg.title);
  setText('history_description', cfg.description);
  setHtml('history_toolbar', '');
  setHtml('history_placeholder_list', `
    <div class="history-placeholder-item">
      <strong>Hook pronto</strong>
      Qui puoi collegare un grafico WeeWX, una pagina secondaria o un modal dedicato a <em>${cfg.title}</em>.
    </div>
    <div class="history-placeholder-item">
      <strong>UX suggerita</strong>
      Mantieni questo pannello come destinazione rapida desktop e apri un modal su mobile, se preferisci.
    </div>
    <div class="history-placeholder-item">
      <strong>Implementazione futura</strong>
      Il pulsante usa <code>data-history="${type}"</code>, quindi puoi agganciare facilmente nuove sorgenti o route.
    </div>
  `);
}

function buildForecastToolbar(view) {
  return `
    <div class="history-segmented" aria-label="Vista forecast">
      <button type="button" class="history-segmented__button ${view === 'hourly' ? 'is-active' : ''}" data-forecast-view="hourly">Orario</button>
      <button type="button" class="history-segmented__button ${view === 'parts' ? 'is-active' : ''}" data-forecast-view="parts">Mattina / Sera</button>
      <button type="button" class="history-segmented__button ${view === 'daily' ? 'is-active' : ''}" data-forecast-view="daily">Giornaliero</button>
    </div>
  `;
}

function buildForecastEntryCard(entry, view) {
  if (view === 'hourly') {
    return `
      <article class="forecast-entry-card forecast-entry-card--hourly">
        <div class="forecast-entry-card__time">${formatHourLabel(entry.time)}</div>
        <div class="forecast-entry-card__icon">${safeValue(entry.icon, '⛅')}</div>
        <div class="forecast-entry-card__temp">${formatTemp(entry.temp)}</div>
        <div class="forecast-entry-card__meta-row">
          ${humidityBadge(entry.humidity)}
          ${rainBadge(entry.rainProb)}
        </div>
        <div class="forecast-entry-card__meta-row forecast-entry-card__meta-row--single">
          ${windBadge(entry.windDir, entry.windKmh)}
        </div>
      </article>
    `;
  }

  if (view === 'parts') {
    const tempLabel = entry.temp !== null && entry.temp !== undefined
      ? formatTemp(entry.temp)
      : `${formatTemp(entry.tempMin)} · ${formatTemp(entry.tempMax)}`;

    return `
      <article class="forecast-entry-card forecast-entry-card--part">
        <div class="forecast-entry-card__time">${safeValue(entry.label)}</div>
        <div class="forecast-entry-card__icon">${safeValue(entry.icon, '🌥️')}</div>
        <div class="forecast-entry-card__temp">${tempLabel}</div>
        <div class="forecast-entry-card__summary">${cleanForecastSummary(entry.summary)}</div>
        <div class="forecast-entry-card__meta-row">
          ${humidityBadge(entry.humidity)}
          ${rainBadge(entry.rainProb)}
        </div>
        <div class="forecast-entry-card__meta-row forecast-entry-card__meta-row--single">
          ${windBadge(entry.windDir, entry.windKmh)}
        </div>
      </article>
    `;
  }

  return `
    <article class="forecast-entry-card forecast-entry-card--daily">
      <div class="forecast-entry-card__time">${safeValue(entry.label)}</div>
      <div class="forecast-entry-card__icon">${safeValue(entry.icon, '⛅')}</div>
      <div class="forecast-entry-card__temp forecast-entry-card__temp--range">${formatTemp(entry.min)} / ${formatTemp(entry.max)}</div>
      <div class="forecast-entry-card__summary">${cleanForecastSummary(entry.summary)}</div>
      <div class="forecast-entry-card__meta-row">
        ${humidityBadge(entry.humidity)}
        ${rainBadge(entry.rainProb)}
      </div>
      <div class="forecast-entry-card__meta-row forecast-entry-card__meta-row--single">
        ${windBadge(entry.windDir, entry.windKmh)}
      </div>
    </article>
  `;
}

function buildForecastDetailCards(forecast, view) {
  const entries = view === 'hourly'
    ? forecast.hourly
    : view === 'parts'
      ? forecast.dayparts
      : forecast.daily;

  const emptyMessage = view === 'hourly'
    ? `La vista oraria non è disponibile per <strong>${forecast.provider}</strong>.`
    : view === 'parts'
      ? `Nessun dettaglio giorno / notte disponibile per <strong>${forecast.provider}</strong>.`
      : `Nessun dettaglio giornaliero disponibile per <strong>${forecast.provider}</strong>.`;

  const statusMessage = forecast.status?.message ? `<span class="forecast-provider__status ${forecast.status?.partial ? 'is-partial' : ''}">${forecast.status.message}</span>` : '';

  return `
    <section class="forecast-provider-block">
      <div class="forecast-provider-block__head">
        <div>
          <p class="forecast-provider-block__label">Provider</p>
          <h3 class="forecast-provider-block__title">${forecast.provider}</h3>
        </div>
        <div class="forecast-provider-block__head-right">
          ${statusMessage}
          <span class="forecast-provider-block__updated">${forecast.updated}</span>
        </div>
      </div>
      ${entries.length ? `
        <div class="forecast-entry-scroller">
          ${entries.map((entry) => buildForecastEntryCard(entry, view)).join('')}
        </div>
      ` : `
        <div class="forecast-detail__empty">${emptyMessage}</div>
      `}
    </section>
  `;
}

function bindForecastToolbar() {
  document.querySelectorAll('[data-forecast-view]').forEach((button) => {
    button.addEventListener('click', () => {
      DASHBOARD_STATE.forecastView = button.dataset.forecastView || 'daily';
      renderForecastHistory();
    });
  });
}

function renderForecastHistory() {
  const cfg = HISTORY_CONFIG.forecast;
  setText('history_title', cfg.title);
  setText('history_description', cfg.description);
  setHtml('history_toolbar', buildForecastToolbar(DASHBOARD_STATE.forecastView));

  const pws = normalizeForecast(DASHBOARD_STATE.forecastPws || {});
  const wu = normalizeForecast(DASHBOARD_STATE.forecastWu || {});
  setHtml('history_placeholder_list', `
    <div class="forecast-detail">
      ${buildForecastDetailCards(pws, DASHBOARD_STATE.forecastView)}
      ${buildForecastDetailCards(wu, DASHBOARD_STATE.forecastView)}
    </div>
  `);

  bindForecastToolbar();
}

function renderHistory(type) {
  if (type === 'forecast') {
    renderForecastHistory();
    return;
  }
  renderSimpleHistoryPlaceholder(type);
}

function bindHistoryButtons() {
  // I pulsanti con data-history-open sono gestiti dalla modale in history-modal.js.
  // Qui bindiamo solo eventuali pulsanti legacy con data-history.
  document.querySelectorAll('.tile-history-btn[data-history]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.history;
      if (!type) return;
      renderHistory(type);
      $('history_panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function stopRadarAnimation() {
  if (radarTimer) {
    clearInterval(radarTimer);
    radarTimer = null;
  }
}

function buildRainviewerTileUrl(cfg, frame) {
  return `${cfg.host}${frame.path}/256/{z}/{x}/{y}/${cfg.color}/${cfg.smooth}_${cfg.snow}.png`;
}

function showRadarFrame(index) {
  if (!radarMap || !radarFrames.length) return;
  radarFrameIndex = (index + radarFrames.length) % radarFrames.length;
  radarFrames.forEach((layer, idx) => {
    if (!radarMap.hasLayer(layer)) layer.addTo(radarMap);
    layer.setOpacity(idx === radarFrameIndex ? 0.82 : 0);
  });
  const frame = radarConfig?.frames?.[radarFrameIndex];
  if (frame?.time) {
    setText('radar_frame_label', new Date(frame.time * 1000).toLocaleString('it-IT'));
  }
}

function startRadarAnimation() {
  if (!radarConfig?.frames?.length) return;
  stopRadarAnimation();
  const interval = Number(radarConfig.frame_interval_ms || 700);
  radarTimer = setInterval(() => showRadarFrame(radarFrameIndex + 1), interval);
  radarPlaying = true;
  setText('radar_play', 'Pause');
}

function pauseRadarAnimation() {
  stopRadarAnimation();
  radarPlaying = false;
  setText('radar_play', 'Play');
}

async function initRadar() {
  const cfg = await fetchJson('./data/radar-rainviewer.json');
  radarConfig = cfg;
  setText('radar_updated', safeValue(cfg.updated));

  const lat = Number(cfg.center_lat || 41.88);
  const lon = Number(cfg.center_lon || 12.44);
  const zoom = Math.min(Number(cfg.zoom || 7), 7);

  if (!radarMap) {
    radarMap = L.map('radar_map', {
      zoomControl: true,
      minZoom: 4,
      maxZoom: 7
    }).setView([lat, lon], zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
      opacity: 0.75
    }).addTo(radarMap);
  } else {
    radarMap.setView([lat, lon], zoom);
  }

  if (stationMarker) radarMap.removeLayer(stationMarker);
  stationMarker = L.marker([lat, lon]).addTo(radarMap).bindPopup('Stazione');

  radarFrames.forEach((layer) => {
    if (radarMap.hasLayer(layer)) radarMap.removeLayer(layer);
  });

  radarFrames = (cfg.frames || []).map((frame) => L.tileLayer(buildRainviewerTileUrl(cfg, frame), {
    tileSize: 256,
    opacity: 0,
    zIndex: 300,
    updateWhenIdle: false
  }));

  if (radarFrames.length) {
    showRadarFrame(radarFrames.length - 1);
    startRadarAnimation();
  }
}

function bindRadarControls() {
  $('radar_prev')?.addEventListener('click', () => {
    pauseRadarAnimation();
    showRadarFrame(radarFrameIndex - 1);
  });

  $('radar_next')?.addEventListener('click', () => {
    pauseRadarAnimation();
    showRadarFrame(radarFrameIndex + 1);
  });

  $('radar_play')?.addEventListener('click', () => {
    if (radarPlaying) {
      pauseRadarAnimation();
    } else {
      startRadarAnimation();
    }
  });
}

async function loadDashboard() {
  try {
    const [current, currentCondition, forecastPwsRaw, forecastWuRaw, aqi, alerts, nearby] = await Promise.all([
      fetchJson('./data/current.json'),
	  fetchJson('./data/current-condition.json').catch(() => null),
      fetchJson('./data/forecast-pws.json'),
      fetchJson('./data/forecast-wu.json'),
      fetchJson('./data/aqi.json'),
	  fetchJson('./data/alerts.json'),
	  fetchJson('./data/nearby.json').catch(() => null)
    ]);

    DASHBOARD_STATE.current = current;
	DASHBOARD_STATE.currentCondition = currentCondition;
    DASHBOARD_STATE.forecastPws = forecastPwsRaw;
    DASHBOARD_STATE.forecastWu = forecastWuRaw;
    DASHBOARD_STATE.aqi = aqi;
	DASHBOARD_STATE.alerts = alerts;
	DASHBOARD_STATE.nearby = nearby;

    const forecastPws = normalizeForecast(forecastPwsRaw);
    const forecastWu = normalizeForecast(forecastWuRaw);
    const primaryForecast = forecastPws.daily.length ? forecastPws : forecastWu;

    renderHero(current, primaryForecast, currentCondition);
    renderTemperatureTile(current);
    renderWindTile(current);
    renderBarometerTile(current);
    renderForecastTile(forecastPws, forecastWu);
    renderDaylightTile(forecastWu);
    renderRainfallTile(current, primaryForecast);
    renderUvTile(current);
    renderAqiTile(aqi);
	renderAlertsStrip(alerts);
    renderAstronomyTile(forecastWu);
	renderNearbyTile(nearby || {});
    renderForecastHistory();
  } catch (error) {
    console.error('Errore caricamento dashboard:', error);
    setText('hero_summary', 'Errore nel caricamento dei dati');
  }

  try {
    await initRadar();
  } catch (error) {
    console.error('Errore radar:', error);
    setText('radar_updated', 'Errore caricamento radar');
  }
}

function bindRefreshButton() {
  $('refresh_button')?.addEventListener('click', loadDashboard);
}

document.addEventListener('DOMContentLoaded', () => {
  bindHistoryButtons();
  bindRadarControls();
  bindRefreshButton();
  bindAlertsUi();
  renderForecastHistory();
  loadDashboard();
  setInterval(loadDashboard, REFRESH_MS);
});
