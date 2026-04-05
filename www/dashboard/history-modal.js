(function () {
  const modal = document.getElementById("historyModal");
  const titleEl = document.getElementById("historyModalTitle");
  const statusEl = document.getElementById("historyStatus");
  const summaryEl = document.getElementById("historySummary");
  const rangeButtons = Array.from(document.querySelectorAll(".history-range-btn"));
  const openButtons = Array.from(document.querySelectorAll("[data-history-open]"));
  const closeButtons = Array.from(document.querySelectorAll("[data-history-close]"));
  const chartCanvas = document.getElementById("historyChart");

  if (!modal || !chartCanvas) return;

  const METRIC_META = {
    temperature: {
      title: "Storico temperatura",
      file: "./data/history-temperature.json",
    },
    wind: {
      title: "Storico vento",
      file: "./data/history-wind.json",
    },
    rain: {
      title: "Storico pioggia",
      file: "./data/history-rain.json",
    },
    pressure: {
      title: "Storico pressione",
      file: "./data/history-pressure.json",
    },
    solar: {
      title: "Storico UV e radiazione",
      file: "./data/history-solar.json",
    },
	aqi: {
	  title: "Storico AQI",
	  file: "./data/history-aqi.json",
	},
  };

  let currentMetric = null;
  let currentRange = "24h";
  let historyChart = null;
  const cache = {};
  let scrollPosition = 0;

	function openModal() {
	  scrollPosition = window.scrollY || window.pageYOffset || 0;

	  document.body.style.position = "fixed";
	  document.body.style.top = `-${scrollPosition}px`;
	  document.body.style.left = "0";
	  document.body.style.right = "0";
	  document.body.style.width = "100%";
	  document.body.classList.add("history-modal-open");

	  modal.classList.add("is-open");
	  modal.setAttribute("aria-hidden", "false");
	}

	function closeModal() {
	  modal.classList.remove("is-open");
	  modal.setAttribute("aria-hidden", "true");

	  document.body.classList.remove("history-modal-open");
	  document.body.style.position = "";
	  document.body.style.top = "";
	  document.body.style.left = "";
	  document.body.style.right = "";
	  document.body.style.width = "";

	  window.scrollTo(0, scrollPosition);
	}

  function setActiveRange(range) {
    currentRange = range;
    rangeButtons.forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.range === range);
    });
  }

  async function fetchMetricData(metric) {
    if (cache[metric]) return cache[metric];
    const meta = METRIC_META[metric];
    if (!meta) throw new Error("Metrica non supportata");

    const resp = await fetch(meta.file, { cache: "no-store" });
    if (!resp.ok) {
      throw new Error(`Errore caricamento ${resp.status}`);
    }
    const data = await resp.json();
    cache[metric] = data;
    return data;
  }

  function formatNumber(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toFixed(digits);
  }

  function formatStatus(data) {
    const updated = data?.updated ? new Date(data.updated).toLocaleString() : "—";
    const stale = data?.status?.stale ? " • dati precedenti" : "";
    statusEl.textContent = `Aggiornato: ${updated}${stale}`;
  }

  function buildSummaryCards(cards) {
    summaryEl.innerHTML = cards.map(card => `
      <div class="history-summary__card">
        <div class="history-summary__label">${card.label}</div>
        <div class="history-summary__value">${card.value}</div>
      </div>
    `).join("");
  }

  function getPoints(data) {
    return data?.ranges?.[currentRange]?.points || [];
  }

  function destroyChart() {
    if (historyChart) {
      historyChart.destroy();
      historyChart = null;
    }
  }

  function makeChart(config) {
    destroyChart();
    historyChart = new Chart(chartCanvas.getContext("2d"), config);
  }

	function pointLabel(p) {
	  if (currentRange === "24h") {
		return (p.time || "").slice(11, 16);
	  }

	  if (currentRange === "7d") {
		// usa MM-DD come base label
		if (p.day) return p.day;
		if (p.time) return p.time.slice(0, 10);
		return "";
	  }

	  if (currentRange === "30d" || currentRange === "1y" || currentRange === "5y") {
		return p.day || (p.time ? p.time.slice(0, 10) : "");
	  }

	  return p.day || p.time || "";
	}

	function tickLabel(value, index) {
	  const label = this.getLabelForValue(value);
	  if (!label) return "";

	  if (currentRange === "24h") {
		// mostra 1 label ogni 3 punti (~15 min se i punti sono ogni 5 min)
		return index % 3 === 0 ? label : "";
	  }

	  if (currentRange === "7d") {
		// dati orari: mostra ogni 12 ore
		// label tipo 2026-04-04T14:00:00+02:00 oppure day/time
		if (index % 12 !== 0) return "";
		return label.length >= 10 ? label.slice(5, 10) : label;
	  }

	  if (currentRange === "30d") {
		// giornaliero: mostra ogni 3 giorni
		return index % 3 === 0 ? label : "";
	  }

	  if (currentRange === "1y") {
		// mostra solo il primo giorno del mese: YYYY-MM-01
		if (/^\d{4}-\d{2}-01$/.test(label)) {
		  const [y, m] = label.split("-");
		  return `${m}/${y.slice(2)}`;
		}
		return "";
	  }

	  if (currentRange === "5y") {
		// label mensili YYYY-MM, mostra ogni 3 mesi
		if (index % 3 !== 0) return "";
		const [y, mm] = label.split("-");
		return `${mm}/${y.slice(2)}`;
	  }

	  return label;
	}

  function renderTemperature(data) {
    const points = getPoints(data);
    const labels = points.map(pointLabel);
	const tempSeries = points.map(p => p.temp_c ?? p.temp_avg_c);
    const minSeries = points.map(p => p.temp_min_c ?? null);
    const maxSeries = points.map(p => p.temp_max_c ?? null);

    makeChart({
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Temperatura", data: tempSeries, tension: 0.25 },
          { label: "Min", data: minSeries, tension: 0.25, hidden: currentRange === "24h" },
          { label: "Max", data: maxSeries, tension: 0.25, hidden: currentRange === "24h" },
        ]
      },
      options: baseChartOptions("°C")
    });

    const vals = tempSeries.filter(v => v != null);
    buildSummaryCards([
      { label: "Min", value: `${formatNumber(Math.min(...vals), 1)} °C` },
      { label: "Max", value: `${formatNumber(Math.max(...vals), 1)} °C` },
      { label: "Punti", value: `${vals.length}` },
    ]);
  }

  function renderWind(data) {
    const points = getPoints(data);
    const labels = points.map(pointLabel);
	const avgSeries = points.map(p => p.wind_avg_kmh);
    const gustSeries = points.map(p => p.wind_gust_kmh);

    makeChart({
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Vento medio", data: avgSeries, tension: 0.25 },
          { label: "Raffica", data: gustSeries, tension: 0.25 },
        ]
      },
      options: baseChartOptions("km/h")
    });

    const gusts = gustSeries.filter(v => v != null);
    buildSummaryCards([
      { label: "Raffica max", value: `${formatNumber(Math.max(...gusts), 1)} km/h` },
      { label: "Punti", value: `${gusts.length}` },
    ]);
  }

  function renderRain(data) {
	  const points = getPoints(data);
	  const labels = points.map(pointLabel);
	  const rainSeries = points.map(p => p.rain_mm);

	  makeChart({
		type: "bar",
		data: {
		  labels,
		  datasets: [
			{ label: "Pioggia", data: rainSeries }
		  ]
		},
		options: baseChartOptions("mm")
	  });

	  const vals = rainSeries.filter(v => v != null);
	  const total = vals.reduce((sum, v) => sum + Number(v), 0);
	  const max = vals.length ? Math.max(...vals) : 0;

	  buildSummaryCards([
		{ label: "Totale periodo", value: `${formatNumber(total, 1)} mm` },
		{ label: "Picco bucket", value: `${formatNumber(max, 1)} mm` },
		{ label: "Punti", value: `${points.length}` },
	  ]);
  }

  function renderPressure(data) {
    const points = getPoints(data);
    const labels = points.map(pointLabel);
	const series = points.map(p => p.barometer_hpa ?? p.barometer_avg_hpa);
    const minSeries = points.map(p => p.barometer_min_hpa ?? null);
    const maxSeries = points.map(p => p.barometer_max_hpa ?? null);

    makeChart({
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Barometro", data: series, tension: 0.25 },
          { label: "Min", data: minSeries, tension: 0.25, hidden: currentRange === "24h" },
          { label: "Max", data: maxSeries, tension: 0.25, hidden: currentRange === "24h" },
        ]
      },
      options: baseChartOptions("hPa")
    });

    const vals = series.filter(v => v != null);
    buildSummaryCards([
      { label: "Min", value: `${formatNumber(Math.min(...vals), 1)} hPa` },
      { label: "Max", value: `${formatNumber(Math.max(...vals), 1)} hPa` },
      { label: "Punti", value: `${vals.length}` },
    ]);
  }

  function renderSolar(data) {
    const points = getPoints(data);
    const labels = points.map(pointLabel);
	const uvSeries = points.map(p => p.uv ?? p.uv_avg);
    const radSeries = points.map(p => p.radiation_wm2 ?? p.radiation_avg_wm2);

    makeChart({
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "UV", data: uvSeries, tension: 0.25, yAxisID: "y" },
          { label: "Radiazione", data: radSeries, tension: 0.25, yAxisID: "y1" },
        ]
      },
		options: {
		  responsive: true,
		  maintainAspectRatio: false,
		  interaction: { mode: "index", intersect: false },
		  plugins: { legend: { display: true } },
		  scales: {
			x: {
			  ticks: {
				autoSkip: false,
				maxRotation: currentRange === "24h" ? 50 : 0,
				minRotation: 0,
				callback: tickLabel
			  }
			},
			y: {
			  beginAtZero: true,
			  title: { display: true, text: "UV" }
			},
			y1: {
			  beginAtZero: true,
			  position: "right",
			  grid: { drawOnChartArea: false },
			  title: { display: true, text: "W/m²" }
			}
		  }
		}
    });

    const uvVals = uvSeries.filter(v => v != null);
    const radVals = radSeries.filter(v => v != null);
    buildSummaryCards([
      { label: "UV max", value: `${formatNumber(Math.max(...uvVals), 1)}` },
      { label: "Rad max", value: `${formatNumber(Math.max(...radVals), 0)} W/m²` },
    ]);
  }

	function renderAqi(data) {
	  const points = getPoints(data);
	  const labels = points.map(pointLabel);
	  const aqiSeries = points.map(p => p.aqi);
	  const pm25Series = points.map(p => p.pm25);
	  const pm10Series = points.map(p => p.pm10);

	  makeChart({
		type: "line",
		data: {
		  labels,
		  datasets: [
			{ label: "AQI", data: aqiSeries, tension: 0.25, yAxisID: "y" },
			{ label: "PM2.5", data: pm25Series, tension: 0.25, yAxisID: "y1" },
			{ label: "PM10", data: pm10Series, tension: 0.25, yAxisID: "y1" },
		  ]
		},
		options: {
		  responsive: true,
		  maintainAspectRatio: false,
		  interaction: { mode: "index", intersect: false },
		  plugins: { legend: { display: true } },
		  scales: {
			x: {
			  ticks: {
				autoSkip: false,
				maxRotation: currentRange === "24h" ? 50 : 0,
				minRotation: 0,
				callback: tickLabel
			  }
			},
			y: {
			  beginAtZero: true,
			  title: { display: true, text: "AQI" }
			},
			y1: {
			  beginAtZero: true,
			  position: "right",
			  grid: { drawOnChartArea: false },
			  title: { display: true, text: "µg/m³" }
			}
		  }
		}
	  });

	  const aqiVals = aqiSeries.filter(v => v != null);
	  const pm25Vals = pm25Series.filter(v => v != null);
	  const pm10Vals = pm10Series.filter(v => v != null);

	  buildSummaryCards([
		{ label: "AQI max", value: `${formatNumber(aqiVals.length ? Math.max(...aqiVals) : null, 0)}` },
		{ label: "PM2.5 max", value: `${formatNumber(pm25Vals.length ? Math.max(...pm25Vals) : null, 1)} µg/m³` },
		{ label: "PM10 max", value: `${formatNumber(pm10Vals.length ? Math.max(...pm10Vals) : null, 1)} µg/m³` },
	  ]);
	}
	function baseChartOptions(unitLabel) {
	  return {
		responsive: true,
		maintainAspectRatio: false,
		interaction: { mode: "index", intersect: false },
		plugins: {
		  legend: { display: true }
		},
		scales: {
		  x: {
			  ticks: {
				autoSkip: false,
				maxRotation: currentRange === "24h" ? 50 : 0,
				minRotation: 0,
				callback: tickLabel
			  }
		  },
		  y: {
			beginAtZero: false,
			title: {
			  display: true,
			  text: unitLabel
			}
		  }
		}
	  };
	}

  function renderMetric(metric, data) {
    titleEl.textContent = METRIC_META[metric]?.title || "Storico";
    formatStatus(data);

    if (metric === "temperature") return renderTemperature(data);
    if (metric === "wind") return renderWind(data);
    if (metric === "rain") return renderRain(data);
    if (metric === "pressure") return renderPressure(data);
    if (metric === "solar") return renderSolar(data);
	if (metric === "aqi") return renderAqi(data);
  }

  async function loadAndRender() {
    if (!currentMetric) return;
    statusEl.textContent = "Caricamento...";
    try {
      const data = await fetchMetricData(currentMetric);
      renderMetric(currentMetric, data);
    } catch (err) {
      destroyChart();
      summaryEl.innerHTML = "";
      statusEl.textContent = `Errore: ${err.message}`;
    }
  }

  openButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      currentMetric = btn.dataset.historyOpen;
      setActiveRange("24h");
      openModal();
      await loadAndRender();
    });
  });

  rangeButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      setActiveRange(btn.dataset.range);
      await loadAndRender();
    });
  });

  closeButtons.forEach(btn => {
    btn.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) {
      closeModal();
    }
  });
})();
