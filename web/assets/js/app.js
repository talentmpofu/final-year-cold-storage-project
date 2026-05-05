// Mock live data updates and simple UI interactions
(function () {
  const fmt = (n) => (typeof n === "number" ? n.toFixed(1) : "--");
  const fmtPrecise = (n) => (typeof n === "number" ? n.toFixed(1) : "--");
  const fmtWhole = (n) => (typeof n === "number" ? n.toFixed(0) : "--");
  const el = (id) => document.getElementById(id);
  const ctx = (cid) => {
    const c = document.getElementById(cid);
    return c ? c.getContext("2d") : null;
  };

  const series = {
    temp: [],
    humidity: [],
    ethylene: [],
    times: [],
  };
  const targets = {
    temp: { min: 2, max: 4 },
    humidity: { min: 85, max: 95 },
    ethylene: { max: 30 }, // VOCs threshold: 30 ppm
  };
  const MAX_POINTS = 50;
  let currentTimeRange = "24h";
  let trendLoadRequestId = 0;
  let alertDismissedUntil = 0;
  let dismissedAlertText = "";
  let previousMetrics = {
    temp: null,
    humidity: null,
    ethylene: null,
  };
  let currentProduceContext = {
    type: null,
    thresholds: null,
    manualOverride: false,
  };

  function setMetricCardState(ringId, state) {
    const ring = el(ringId);
    if (!ring) return;
    const card = ring.closest(".metric-card");
    if (!card) return;
    card.classList.remove("status-good", "status-warn", "status-critical");
    if (state === "good") card.classList.add("status-good");
    if (state === "warn") card.classList.add("status-warn");
    if (state === "critical") card.classList.add("status-critical");
  }

  function setDelta(elId, delta, decimals, unit) {
    const node = el(elId);
    if (!node) return;
    node.classList.remove("delta-up", "delta-down", "delta-flat");
    if (typeof delta !== "number" || Number.isNaN(delta)) {
      node.textContent = "No prior sample";
      node.classList.add("delta-flat");
      return;
    }
    if (Math.abs(delta) < 0.001) {
      node.textContent = "No change vs prior sample";
      node.classList.add("delta-flat");
      return;
    }
    const sign = delta > 0 ? "+" : "-";
    const amount = Math.abs(delta).toFixed(decimals);
    node.textContent = `${sign}${amount} ${unit} vs prior sample`;
    node.classList.add(delta > 0 ? "delta-up" : "delta-down");
  }

  function isBannerSuppressed(message) {
    const localSuppressed =
      Date.now() < alertDismissedUntil && message === dismissedAlertText;
    const globalSuppressed =
      Date.now() < (window.__bannerManualDismissUntil || 0) &&
      message === (window.__dismissedBannerMessage || "");
    return localSuppressed || globalSuppressed;
  }

  function syncSidebarActiveLink() {
    const navLinks = document.querySelectorAll(".sidebar-nav .nav-link");
    if (!navLinks.length) return;

    const currentHash = location.hash || "#dashboard";
    navLinks.forEach((link) => {
      const isActive = link.getAttribute("href") === currentHash;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  async function fetchMetrics() {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();

      if (data.produce) {
        if (data.produce.manualOverride) {
          updateProduceDisplay(data.produce);
        } else {
          currentProduceContext = {
            ...currentProduceContext,
            thresholds: data.produce?.thresholds || null,
            manualOverride: false,
          };
        }
      }

      return {
        temp: Number(data?.temperature?.value),
        humidity: Number(data?.humidity?.value),
        ethylene: Number(data?.vocs?.value) / 1000.0,
        produce: data.produce,
      };
    } catch (e) {
      return null;
    }
  }

  function drawSpark(ctx2d, data, color) {
    if (!ctx2d) return;
    const w = ctx2d.canvas.width,
      h = ctx2d.canvas.height;
    ctx2d.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const min = Math.min(...data),
      max = Math.max(...data);
    const range = max - min || 1;
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 2;
    ctx2d.lineCap = "round";
    ctx2d.lineJoin = "round";
    ctx2d.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * (w - 2) + 1;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    });
    ctx2d.stroke();
  }

  function drawEnvTrend(canvasCtx, allSeries) {
    if (!canvasCtx) return;
    const w = canvasCtx.canvas.width;
    const h = canvasCtx.canvas.height;
    canvasCtx.clearRect(0, 0, w, h);
    const PAD = 24;
    const gridRows = 6;
    const gridCols = 10;
    const maxLen = Math.max(
      allSeries.temp.length,
      allSeries.humidity.length,
      allSeries.ethylene.length,
    );
    if (maxLen < 1) return;

    const tempMin = 0;
    const tempMax = 35;
    const ethMin = 0;
    const ethMax = 50;
    const humMin = 0;
    const humMax = 100;
    const tempRange = tempMax - tempMin || 1;
    const ethRange = ethMax - ethMin || 1;
    const humRange = humMax - humMin || 1;

    canvasCtx.strokeStyle = "#edf2f7";
    canvasCtx.lineWidth = 1;
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      canvasCtx.beginPath();
      canvasCtx.moveTo(PAD, y);
      canvasCtx.lineTo(w - PAD, y);
      canvasCtx.stroke();
    }
    for (let j = 0; j <= gridCols; j++) {
      const x = PAD + (j / gridCols) * (w - PAD * 2);
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, PAD);
      canvasCtx.lineTo(x, h - PAD);
      canvasCtx.stroke();
    }

    canvasCtx.strokeStyle = "#d6e0ea";
    canvasCtx.lineWidth = 1.5;
    canvasCtx.beginPath();
    canvasCtx.moveTo(PAD, h - PAD);
    canvasCtx.lineTo(w - PAD, h - PAD);
    canvasCtx.moveTo(PAD, PAD);
    canvasCtx.lineTo(PAD, h - PAD);
    canvasCtx.moveTo(w - PAD, PAD);
    canvasCtx.lineTo(w - PAD, h - PAD);
    canvasCtx.stroke();

    canvasCtx.fillStyle = "#6b7280";
    canvasCtx.font = "12px Inter, Arial, sans-serif";

    canvasCtx.fillStyle = "#d1495b";
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      const tv = tempMax - (i / gridRows) * tempRange;
      canvasCtx.fillText(tv.toFixed(1), 4, y + 4);
    }

    canvasCtx.fillStyle = "#d97706";
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      const ev = ethMax - (i / gridRows) * ethRange;
      canvasCtx.fillText(ev.toFixed(1), 46, y + 4);
    }

    canvasCtx.fillStyle = "#0077b6";
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      const hv = humMax - (i / gridRows) * humRange;
      const hlabel = hv.toFixed(1) + "%";
      const tw = canvasCtx.measureText(hlabel).width;
      canvasCtx.fillText(hlabel, w - PAD - tw - 4, y + 4);
    }

    canvasCtx.fillStyle = "#6b7280";
    const times = allSeries.times;
    if (times && times.length > 1) {
      function fmtTime(t) {
        const dt = new Date(t);
        if (currentTimeRange === "24h") {
          return dt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
        }
        if (currentTimeRange === "7d") {
          return dt.toLocaleDateString([], { month: "short", day: "numeric" });
        }
        return dt.toLocaleDateString([], { month: "short", day: "numeric" });
      }
      for (let j = 0; j <= gridCols; j++) {
        const idx = Math.round((j / gridCols) * (times.length - 1));
        const x = PAD + (idx / (times.length - 1)) * (w - PAD * 2);
        const label = fmtTime(times[idx]);
        const tw = canvasCtx.measureText(label).width;
        const xText = Math.max(PAD + 2, Math.min(w - PAD - tw - 2, x - tw / 2));
        canvasCtx.fillText(label, xText, h - PAD + 16);
      }
    }

    canvasCtx.font = "13px Inter, Arial, sans-serif";
    canvasCtx.fillStyle = "#d1495b";
    canvasCtx.fillText("Temp (\u00B0C)", PAD + 6, PAD - 8);
    canvasCtx.fillStyle = "#d97706";
    canvasCtx.fillText("Ethylene (ppm)", PAD + 90, PAD - 8);
    canvasCtx.fillStyle = "#0077b6";
    const rightTitle = "Humidity (%)";
    const rtw = canvasCtx.measureText(rightTitle).width;
    canvasCtx.fillText(rightTitle, w - PAD - rtw - 6, PAD - 8);

    const lines = [
      { data: allSeries.temp, color: "#d1495b", width: 2.2, axis: "temp" },
      {
        data: allSeries.humidity,
        color: "#0077b6",
        width: 2.2,
        axis: "humidity",
      },
      {
        data: allSeries.ethylene,
        color: "#d97706",
        width: 2.2,
        axis: "ethylene",
      },
    ];

    lines.forEach((line) => {
      const { data, color, width, axis } = line;
      if (!data.length) return;

      if (data.length === 1) {
        let min, range;
        if (axis === "temp") {
          min = tempMin;
          range = tempRange;
        } else if (axis === "humidity") {
          min = humMin;
          range = humRange;
        } else {
          min = ethMin;
          range = ethRange;
        }
        const x = PAD + (w - PAD * 2) * 0.5;
        const y = h - PAD - ((data[0] - min) / range) * (h - PAD * 2);
        canvasCtx.fillStyle = color;
        canvasCtx.beginPath();
        canvasCtx.arc(x, y, 3, 0, Math.PI * 2);
        canvasCtx.fill();
        return;
      }

      canvasCtx.strokeStyle = color;
      canvasCtx.lineWidth = width;
      canvasCtx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = PAD + (i / (data.length - 1)) * (w - PAD * 2);
        let min, range;
        if (axis === "temp") {
          min = tempMin;
          range = tempRange;
        } else if (axis === "humidity") {
          min = humMin;
          range = humRange;
        } else {
          min = ethMin;
          range = ethRange;
        }
        const y = h - PAD - ((data[i] - min) / range) * (h - PAD * 2);
        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          const prevX = PAD + ((i - 1) / (data.length - 1)) * (w - PAD * 2);
          const prevMin =
            axis === "temp" ? tempMin : axis === "humidity" ? humMin : ethMin;
          const prevRange =
            axis === "temp"
              ? tempRange
              : axis === "humidity"
                ? humRange
                : ethRange;
          const prevY =
            h - PAD - ((data[i - 1] - prevMin) / prevRange) * (h - PAD * 2);
          const cpx = (prevX + x) / 2;
          const cpy = (prevY + y) / 2;
          canvasCtx.quadraticCurveTo(prevX, prevY, cpx, cpy);
          canvasCtx.lineTo(x, y);
        }
      }
      canvasCtx.stroke();
    });
  }

  function getCurrentThresholds() {
    const thresholds = currentProduceContext.thresholds || {};
    const tempRange = thresholds.temperature || targets.temp;
    const humidityRange = thresholds.humidity || targets.humidity;
    const vocLimit =
      typeof thresholds.voc === "number"
        ? thresholds.voc / 1000
        : targets.ethylene.max;

    return {
      tempRange,
      humidityRange,
      vocLimit,
    };
  }

  function getTrendDirection(values, tolerance = 0.1) {
    if (!values || values.length < 2) return "stable";
    const slice = values.slice(-5);
    const delta = slice[slice.length - 1] - slice[0];
    if (Math.abs(delta) <= tolerance) return "stable";
    return delta > 0 ? "rising" : "falling";
  }

  function computeShelfLife(baseDays, adjustment, badCount) {
    const spoilagePenalty = Math.max(0, Number(badCount || 0)) * 0.65;
    const estimate = baseDays - adjustment - spoilagePenalty;
    return Math.max(0.5, estimate);
  }

  function renderRecommendations() {
    const applesEl = el("forecast-apples");
    const potatoesEl = el("forecast-potatoes");
    const summaryEl = el("forecast-summary");
    const scoreEl = el("environment-score");
    const envSummaryEl = el("environment-summary");
    const recommendationList = el("recommendation-list");
    const priorityList = el("priority-list");

    const latestTemp = series.temp[series.temp.length - 1];
    const latestHumidity = series.humidity[series.humidity.length - 1];
    const latestEthylene = series.ethylene[series.ethylene.length - 1];

    if (
      !Number.isFinite(latestTemp) ||
      !Number.isFinite(latestHumidity) ||
      !Number.isFinite(latestEthylene)
    ) {
      if (applesEl) applesEl.textContent = "-- days";
      if (potatoesEl) potatoesEl.textContent = "-- days";
      if (summaryEl) {
        summaryEl.textContent =
          "Waiting for live conditions to calculate shelf-life outlook.";
      }
      if (scoreEl) scoreEl.textContent = "--";
      if (envSummaryEl) {
        envSummaryEl.textContent =
          "Temperature, humidity, and ethylene trend analysis will appear here.";
      }
      return;
    }

    const { tempRange, humidityRange, vocLimit } = getCurrentThresholds();
    const tempMid = (tempRange.min + tempRange.max) / 2;
    const humidityMid = (humidityRange.min + humidityRange.max) / 2;

    const tempSlope = getTrendDirection(series.temp, 0.05);
    const humiditySlope = getTrendDirection(series.humidity, 0.4);
    const ethyleneSlope = getTrendDirection(series.ethylene, 0.01);

    const tempDeviation =
      latestTemp > tempRange.max
        ? latestTemp - tempRange.max
        : latestTemp < tempRange.min
          ? tempRange.min - latestTemp
          : Math.abs(latestTemp - tempMid) * 0.12;
    const humidityDeviation =
      latestHumidity > humidityRange.max
        ? (latestHumidity - humidityRange.max) * 0.2
        : latestHumidity < humidityRange.min
          ? (humidityRange.min - latestHumidity) * 0.2
          : Math.abs(latestHumidity - humidityMid) * 0.05;
    const ethyleneDeviation =
      latestEthylene > vocLimit ? (latestEthylene - vocLimit) * 5 : 0;

    const tempTrendPenalty =
      tempSlope === "rising" ? 0.6 : tempSlope === "falling" ? -0.15 : 0;
    const humidityTrendPenalty =
      humiditySlope === "falling"
        ? 0.35
        : humiditySlope === "rising"
          ? -0.1
          : 0;
    const ethyleneTrendPenalty =
      ethyleneSlope === "rising" ? 0.8 : ethyleneSlope === "falling" ? -0.2 : 0;

    const applesShelfLife = computeShelfLife(
      8.5,
      tempDeviation * 1.2 +
        humidityDeviation * 1.1 +
        ethyleneDeviation * 1.4 +
        tempTrendPenalty +
        humidityTrendPenalty +
        ethyleneTrendPenalty,
      cameraInventorySummary.applesBad,
    );
    const potatoesShelfLife = computeShelfLife(
      21,
      tempDeviation * 0.9 +
        humidityDeviation * 0.8 +
        ethyleneDeviation * 0.9 +
        tempTrendPenalty * 0.7 +
        humidityTrendPenalty * 0.5 +
        ethyleneTrendPenalty,
      cameraInventorySummary.potatoesBad,
    );

    if (applesEl) applesEl.textContent = `${applesShelfLife.toFixed(1)} days`;
    if (potatoesEl)
      potatoesEl.textContent = `${potatoesShelfLife.toFixed(1)} days`;

    const riskScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          100 -
            tempDeviation * 12 -
            humidityDeviation * 8 -
            ethyleneDeviation * 10 -
            Math.max(0, cameraInventorySummary.applesBad || 0) * 4 -
            Math.max(0, cameraInventorySummary.potatoesBad || 0) * 3,
        ),
      ),
    );
    const riskLabel =
      riskScore >= 80 ? "Stable" : riskScore >= 60 ? "Watch" : "At risk";

    if (scoreEl) scoreEl.textContent = `${riskScore}/100 ${riskLabel}`;

    const envMessages = [];
    if (tempSlope === "rising") {
      envMessages.push(
        "Temperature is trending upward, so cooling should be checked first.",
      );
    } else if (tempSlope === "falling") {
      envMessages.push(
        "Temperature is trending down, which supports longer storage life.",
      );
    }
    if (humiditySlope === "falling") {
      envMessages.push(
        "Humidity is easing downward, so hold the humidifier closer to target.",
      );
    } else if (humiditySlope === "rising") {
      envMessages.push(
        "Humidity is climbing, so watch for condensation and excess moisture.",
      );
    }
    if (ethyleneSlope === "rising") {
      envMessages.push(
        "Ethylene/VOCs are rising, which usually shortens shelf life fastest.",
      );
    } else if (ethyleneSlope === "falling") {
      envMessages.push(
        "Ethylene/VOCs are easing, which improves produce stability.",
      );
    }
    if (envMessages.length === 0) {
      envMessages.push(
        "Conditions are steady across temperature, humidity, and ethylene/VOCs.",
      );
    }

    if (envSummaryEl) envSummaryEl.textContent = envMessages.join(" ");
    if (summaryEl) {
      summaryEl.textContent =
        applesShelfLife < potatoesShelfLife
          ? "Apples are under more pressure right now, so they should be inspected first."
          : "Potatoes are currently the longer-lived batch, while apples need closer attention.";
    }

    const actions = [];
    if (latestTemp > tempRange.max + 0.2 || tempSlope === "rising") {
      actions.push(
        "Reduce temperature slightly and check the cooling cycle for drift.",
      );
    }
    if (latestHumidity < humidityRange.min - 1) {
      actions.push("Increase humidity to keep stored produce from drying out.");
    } else if (latestHumidity > humidityRange.max + 1) {
      actions.push(
        "Lower humidity or improve ventilation to prevent condensation.",
      );
    }
    if (latestEthylene > vocLimit || ethyleneSlope === "rising") {
      actions.push(
        "Keep the scrubber active and remove bruised items that can accelerate spoilage.",
      );
    }
    if (
      cameraInventorySummary.applesBad > 0 ||
      cameraInventorySummary.potatoesBad > 0
    ) {
      actions.push(
        "Physically inspect the affected produce and remove damaged items first.",
      );
    }
    if (actions.length === 0) {
      actions.push(
        "Conditions are within target, so maintain the current setpoints and keep monitoring.",
      );
    }

    if (recommendationList) {
      recommendationList.innerHTML = actions
        .slice(0, 4)
        .map((action) => `<li>${action}</li>`)
        .join("");
    }

    const priorities = [
      {
        label: `Apples - ${applesShelfLife.toFixed(1)} days estimated`,
        score: applesShelfLife - (cameraInventorySummary.applesBad || 0) * 0.5,
      },
      {
        label: `Potatoes - ${potatoesShelfLife.toFixed(1)} days estimated`,
        score:
          potatoesShelfLife - (cameraInventorySummary.potatoesBad || 0) * 0.5,
      },
    ]
      .sort((a, b) => a.score - b.score)
      .map((item) => item.label);

    if (priorityList) {
      priorityList.innerHTML = priorities
        .map((item) => `<li>${item}</li>`)
        .join("");
    }
  }

  // Tooltip on hover for environmental trends
  function bindEnvTrendTooltip() {
    const canvas = document.getElementById("env-trend");
    const tooltip = document.getElementById("env-tooltip");
    if (!canvas || !tooltip) return;
    const PAD = 24;
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const maxLen = Math.max(
        series.temp.length,
        series.humidity.length,
        series.ethylene.length,
      );
      if (maxLen < 2) {
        tooltip.hidden = true;
        return;
      }
      const innerW = canvas.width - PAD * 2;
      const t = Math.max(0, Math.min(1, (x - PAD) / innerW));
      const idx = Math.round(t * (maxLen - 1));

      // Get exact values at this point
      const item = {
        temp: series.temp[idx],
        humidity: series.humidity[idx],
        ethylene: series.ethylene[idx],
        time: series.times[idx],
      };

      // Format time
      const timeStr = item.time ? new Date(item.time).toLocaleString() : "N/A";

      tooltip.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px; font-size: 12px;">${timeStr}</div>
        <div><span style="color:#d1495b">&#9679;</span> Temperature: <strong>${fmt(
          item.temp,
        )} &deg;C</strong></div>
        <div><span style="color:#0077b6">&#9679;</span> Humidity: <strong>${fmt(
          item.humidity,
        )} %</strong></div>
        <div><span style="color:#d97706">&#9679;</span> Ethylene/VOCs: <strong>${fmtPrecise(
          item.ethylene,
        )} ppm</strong></div>
      `;
      // Position relative to canvas, not viewport
      tooltip.style.left = `${x + 15}px`;
      tooltip.style.top = `${y - 10}px`;
      tooltip.hidden = false;
    });
    canvas.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });
  }
  // realtime temperature stream removed per request

  // Remove last-sync handling (element not present in DOM)

  async function updateMetrics() {
    console.log("updateMetrics called");
    const fetched = await fetchMetrics();
    console.log("Fetched result:", fetched);
    let temp, humidity, ethylene, tstamp;
    if (
      fetched &&
      ["temp", "humidity", "ethylene"].every(
        (k) => typeof fetched[k] === "number" && !Number.isNaN(fetched[k]),
      )
    ) {
      temp = fetched.temp;
      humidity = fetched.humidity;
      ethylene = fetched.ethylene;
      tstamp = Date.now();
      console.log("Using real data:", { temp, humidity, ethylene });
    } else {
      temp = 3 + Math.random() * 3.5;
      humidity = 85 + Math.random() * 8;
      ethylene = 0.01 + Math.random() * 0.14;
      tstamp = Date.now();
      console.log("Using mock data (fetch failed):", {
        temp,
        humidity,
        ethylene,
      });
    }

    el("temp-value").textContent =
      `Target ${fmtWhole(targets.temp.min)}-${fmtWhole(targets.temp.max)}\u00B0C`;
    el("humidity-value").textContent =
      `Target ${fmtWhole(targets.humidity.min)}-${fmtWhole(targets.humidity.max)}%`;
    el("ethylene-value").textContent =
      `Limit ${fmtWhole(targets.ethylene.max)} ppm`;
    console.log("Updated DOM elements");

    // Update indicator rings using meaningful target-based ranges.
    const percentWithinRange = (value, minValue, maxValue) => {
      if (maxValue <= minValue) return 0;
      return Math.max(
        0,
        Math.min(100, ((value - minValue) / (maxValue - minValue)) * 100),
      );
    };

    const setGauge = (gaugeId, labelId, percent, labelText) => {
      const gaugeEl = el(gaugeId);
      if (gaugeEl) gaugeEl.style.setProperty("--progress", `${percent}%`);
      const labelEl = el(labelId);
      if (labelEl) labelEl.textContent = labelText;
    };

    const tempRangeMin = targets.temp.min - 5;
    const tempRangeMax = targets.temp.max + 5;
    const tempPercent = percentWithinRange(temp, tempRangeMin, tempRangeMax);
    setGauge("temp-ring", "temp-percent", tempPercent, `${fmt(temp)}`);

    const humidityPercent = percentWithinRange(
      humidity,
      targets.humidity.min,
      targets.humidity.max,
    );
    setGauge(
      "humidity-ring",
      "humidity-percent",
      humidityPercent,
      `${fmt(humidity)}`,
    );

    const ethyleneRangeMax = Math.max(targets.ethylene.max * 2, 1);
    const ethylenePercent = percentWithinRange(ethylene, 0, ethyleneRangeMax);
    setGauge(
      "ethylene-ring",
      "ethylene-percent",
      ethylenePercent,
      `${fmtPrecise(ethylene)}`,
    );

    setDelta(
      "temp-delta",
      previousMetrics.temp == null ? NaN : temp - previousMetrics.temp,
      1,
      "°C",
    );
    setDelta(
      "humidity-delta",
      previousMetrics.humidity == null
        ? NaN
        : humidity - previousMetrics.humidity,
      1,
      "%",
    );
    setDelta(
      "ethylene-delta",
      previousMetrics.ethylene == null
        ? NaN
        : ethylene - previousMetrics.ethylene,
      3,
      "ppm",
    );

    previousMetrics = { temp, humidity, ethylene };

    // Keep live append behavior only for 24h mode.
    if (currentTimeRange === "24h") {
      const push = (arr, v) => {
        arr.push(v);
        if (arr.length > MAX_POINTS) arr.shift();
      };
      push(series.temp, temp);
      push(series.humidity, humidity);
      push(series.ethylene, ethylene);
      push(series.times, tstamp);

      drawSpark(ctx("temp-chart"), series.temp, "#d1495b");
      drawSpark(ctx("humidity-chart"), series.humidity, "#0077b6");
      drawSpark(ctx("ethylene-chart"), series.ethylene, "#d97706");
      drawEnvTrend(ctx("env-trend"), series);
    }
    // realtime stream removed

    el("temp-trend").textContent =
      temp > targets.temp.max
        ? "Above target"
        : temp < targets.temp.min
          ? "Below target"
          : "On target";
    el("humidity-trend").textContent =
      humidity < targets.humidity.min
        ? "Below target"
        : humidity > targets.humidity.max
          ? "Above target"
          : "On target";
    el("ethylene-trend").textContent =
      ethylene > targets.ethylene.max ? "High" : "Normal";

    const tempState =
      temp > targets.temp.max + 0.5 || temp < targets.temp.min - 0.5
        ? "critical"
        : temp > targets.temp.max || temp < targets.temp.min
          ? "warn"
          : "good";
    const humidityState =
      humidity > targets.humidity.max + 3 || humidity < targets.humidity.min - 3
        ? "critical"
        : humidity > targets.humidity.max || humidity < targets.humidity.min
          ? "warn"
          : "good";
    const ethyleneState =
      ethylene > targets.ethylene.max
        ? "critical"
        : ethylene > targets.ethylene.max * 0.8
          ? "warn"
          : "good";

    setMetricCardState("temp-ring", tempState);
    setMetricCardState("humidity-ring", humidityState);
    setMetricCardState("ethylene-ring", ethyleneState);

    // summary stats (min/avg/max)
    const stat = (arr) => {
      if (!arr.length) return { min: NaN, avg: NaN, max: NaN };
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return { min, avg, max };
    };
    const sTemp = stat(series.temp);
    const sHum = stat(series.humidity);
    const sEth = stat(series.ethylene);
    el("temp-min").textContent = fmt(sTemp.min);
    el("temp-avg").textContent = fmt(sTemp.avg);
    el("temp-max").textContent = fmt(sTemp.max);
    el("humidity-min").textContent = fmt(sHum.min);
    el("humidity-avg").textContent = fmt(sHum.avg);
    el("humidity-max").textContent = fmt(sHum.max);
    el("ethylene-min").textContent = fmt(sEth.min);
    el("ethylene-avg").textContent = fmt(sEth.avg);
    el("ethylene-max").textContent = fmt(sEth.max);

    renderRecommendations();

    const alerts = [];
    if (temp > targets.temp.max + 0.5)
      alerts.push({
        type: "err",
        text: `Temperature ${temp.toFixed(1)}\u00B0C is above safe range (max ${
          targets.temp.max
        }\u00B0C) - cooling system activated.`,
      });
    else if (temp < targets.temp.min - 0.5)
      alerts.push({
        type: "err",
        text: `Temperature ${temp.toFixed(1)}\u00B0C is below safe range (min ${
          targets.temp.min
        }\u00B0C) - heating required.`,
      });
    if (humidity < targets.humidity.min - 3)
      alerts.push({
        type: "err",
        text: `Humidity ${humidity.toFixed(1)}% is below safe range (min ${
          targets.humidity.min
        }%) - humidifier activated.`,
      });
    else if (humidity > targets.humidity.max + 3)
      alerts.push({
        type: "err",
        text: `Humidity ${humidity.toFixed(1)}% is above safe range (max ${
          targets.humidity.max
        }%) - dehumidifier activated.`,
      });
    if (ethylene > targets.ethylene.max) {
      alerts.push({
        type: "err",
        text: `VOC/Ethylene ${ethylene.toFixed(
          1,
        )}ppm is above safe threshold (max ${
          targets.ethylene.max
        }ppm) - air scrubber activated.`,
      });
      // Auto-activate scrubber when VOCs are high
      if (systemStatus.scrubber !== "active") {
        systemStatus.scrubber = "active";
        updateSystemStatus();
      }
    } else {
      // Auto-deactivate when VOCs are normal (with 20% hysteresis)
      if (
        systemStatus.scrubber === "active" &&
        ethylene < targets.ethylene.max * 0.8
      ) {
        systemStatus.scrubber = "standby";
        updateSystemStatus();
      }
    }

    // Update alert banner at top for important alerts
    const banner = document.getElementById("alert-banner");
    const bannerText = document.getElementById("alert-banner-text");
    if (alerts.length === 0) {
      if (banner) banner.hidden = true;
    } else {
      // Keep banner concise to avoid clipping when several alerts fire at once.
      if (banner && bannerText && alerts.length > 0) {
        const bannerMessage = alerts[0].text;
        if (isBannerSuppressed(bannerMessage)) {
          banner.hidden = true;
        } else {
          bannerText.textContent = "";
          const mainMessage = document.createElement("span");
          mainMessage.textContent = bannerMessage;
          bannerText.appendChild(mainMessage);

          if (alerts.length > 1) {
            const moreAlertsButton = document.createElement("button");
            moreAlertsButton.type = "button";
            moreAlertsButton.className = "alert-more-link";
            moreAlertsButton.textContent = `(+${alerts.length - 1} more alerts)`;
            moreAlertsButton.addEventListener("click", () => {
              const metricsSection = document.getElementById("live-metrics");
              if (metricsSection) {
                metricsSection.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }

              const highlightCard = (ringId) => {
                const ring = document.getElementById(ringId);
                const card = ring?.closest(".metric-card");
                if (!card) return;
                card.classList.remove("metric-card-attention");
                // restart animation when clicked repeatedly
                void card.offsetWidth;
                card.classList.add("metric-card-attention");
                setTimeout(() => {
                  card.classList.remove("metric-card-attention");
                }, 2200);
              };

              const joined = alerts
                .map((a) => String(a.text || ""))
                .join(" ")
                .toLowerCase();
              if (joined.includes("temperature")) highlightCard("temp-ring");
              if (joined.includes("humidity")) highlightCard("humidity-ring");
              if (joined.includes("voc") || joined.includes("ethylene")) {
                highlightCard("ethylene-ring");
              }
            });
            bannerText.appendChild(document.createTextNode(" "));
            bannerText.appendChild(moreAlertsButton);
          }

          banner.hidden = false;
          // adjust banner color to red for errors
          banner.style.background = "#fce8eb";
          banner.style.color = "#7f1d1d";
          banner.style.borderBottomColor = "#f4c5cf";
          // auto-hide when alerts clear
          clearTimeout(window.__alertBannerTimer);
        }
      }
    }
    // Update status badge to indicate data source
    const badge = document.getElementById("status-badge");
    if (badge) {
      badge.textContent = fetched ? "Live" : "Simulated";
    }
  }

  const systemStatus = {
    cooling: "active",
    humidifier: "active",
    scrubber: "standby",
    camera: "active",
  };

  // Filter health tracking
  let kmno4Health = 78; // KMnO4 filter health percentage
  let scrubberRunTime = 0; // Track scrubber runtime for KMnO4 degradation

  function updateSystemStatus() {
    const setStatusBadge = (component, status) => {
      const statusEl = el(`${component}-status`);
      if (!statusEl) return;

      let badgeEl = statusEl.querySelector(".status-badge");
      if (!badgeEl) {
        badgeEl = document.createElement("span");
        badgeEl.className = "status-badge";
        statusEl.appendChild(badgeEl);
      }

      badgeEl.className = `status-badge ${status.class}`;
      badgeEl.textContent = status.text;
    };

    // Check if we're in manual override mode
    const autoManualToggle = document.getElementById("auto-manual-toggle");
    const isAutoMode = autoManualToggle ? autoManualToggle.checked : true;

    // Only update system status badges if in auto mode
    // In manual mode, these are controlled by the manual override toggles
    if (!isAutoMode) {
      // Keep system status badges synced to manual control toggle states.
      const coolingToggle = el("cooling-toggle");
      const humidifierToggle = el("humidifier-toggle");
      const scrubberToggle = el("scrubber-toggle");

      const manualStatusByComponent = {
        cooling: coolingToggle?.checked ? "active" : "standby",
        humidifier: humidifierToggle?.checked ? "active" : "standby",
        scrubber: scrubberToggle?.checked ? "active" : "standby",
      };

      const statusMap = {
        active: { text: "Active", class: "active" },
        standby: { text: "Standby", class: "standby" },
      };

      ["cooling", "humidifier", "scrubber"].forEach((component) => {
        const status =
          statusMap[manualStatusByComponent[component]] || statusMap.standby;
        setStatusBadge(component, status);
      });

      // Still update camera status as it's not part of manual controls
      const cameraStatus =
        systemStatus.camera === "active"
          ? { text: "Active", class: "active" }
          : { text: "Standby", class: "standby" };
      setStatusBadge("camera", cameraStatus);
      return; // Don't update other components in manual mode
    }

    const statusMap = {
      active: { text: "Active", class: "active" },
      standby: { text: "Standby", class: "standby" },
      offline: { text: "Offline", class: "offline" },
    };

    ["cooling", "humidifier", "scrubber", "camera"].forEach((component) => {
      const status = statusMap[systemStatus[component]] || statusMap.standby;
      setStatusBadge(component, status);
    });
  }

  function updateFilterHealth() {
    // Degrade KMnO4 filter when scrubber is active
    if (systemStatus.scrubber === "active") {
      scrubberRunTime += 1;
      // KMnO4 degrades by 0.01% per update cycle when active (reacting with ethylene/VOCs)
      if (scrubberRunTime % 10 === 0 && kmno4Health > 0) {
        kmno4Health = Math.max(0, kmno4Health - 0.1);
      }
    }

    // Update UI
    const kmno4Bar = el("kmno4-bar");
    const kmno4Percent = el("kmno4-percent");

    if (kmno4Bar && kmno4Percent) {
      kmno4Bar.style.width = `${kmno4Health}%`;
      kmno4Percent.textContent = `${Math.round(kmno4Health)}%`;

      // Change color based on health
      if (kmno4Health < 20) {
        kmno4Bar.style.background = "linear-gradient(90deg, #d1495b, #e06a78)";
      } else if (kmno4Health < 50) {
        kmno4Bar.style.background = "linear-gradient(90deg, #d97706, #fbbf24)";
      } else {
        kmno4Bar.style.background = "linear-gradient(90deg, #0077b6, #00689f)";
      }
    }
  }

  function bindControls() {
    const notify = (msg) => {
      showAlert(msg, "success");
    };

    const autoManualToggle = document.getElementById("auto-manual-toggle");
    const modeIndicator = document.getElementById("mode-indicator");

    // Mode toggle handling
    if (autoManualToggle) {
      autoManualToggle.addEventListener("change", (e) => {
        const isAuto = e.target.checked;
        if (modeIndicator) {
          modeIndicator.textContent = isAuto ? "Automatic" : "Manual";
        }
        updateControlStatusDisplay(isAuto);
      });
    }

    function updateControlStatusDisplay(isAuto) {
      const controlMappings = [
        {
          key: "cooling",
          toggleId: "cooling-toggle",
          statusId: "cooling-status-text",
        },
        {
          key: "humidifier",
          toggleId: "humidifier-toggle",
          statusId: "humidifier-status-text",
        },
        {
          key: "scrubber",
          toggleId: "scrubber-toggle",
          statusId: "scrubber-status-text",
        },
      ];

      controlMappings.forEach(({ key, toggleId, statusId }) => {
        const toggleEl = el(toggleId);
        const statusEl = el(statusId);
        if (!statusEl) return;

        if (isAuto) {
          const isActive = systemStatus[key] === "active";
          if (toggleEl) toggleEl.checked = isActive;
          statusEl.textContent = isActive ? "Active" : "Standby";
          return;
        }

        statusEl.textContent = toggleEl?.checked ? "Active" : "Off";
      });
    }

    // Toggle switches
    const coolingToggle = el("cooling-toggle");
    const humidifierToggle = el("humidifier-toggle");
    const scrubberToggle = el("scrubber-toggle");

    if (coolingToggle) {
      coolingToggle.addEventListener("change", (e) => {
        systemStatus.cooling = e.target.checked ? "active" : "standby";
        const isAuto = autoManualToggle?.checked ?? true;
        el("cooling-status-text").textContent = isAuto
          ? e.target.checked
            ? "Active"
            : "Standby"
          : e.target.checked
            ? "Active"
            : "Off";
        updateSystemStatus();
        notify(e.target.checked ? "Cooling activated" : "Cooling deactivated");
      });
    }

    if (humidifierToggle) {
      humidifierToggle.addEventListener("change", (e) => {
        systemStatus.humidifier = e.target.checked ? "active" : "standby";
        const isAuto = autoManualToggle?.checked ?? true;
        el("humidifier-status-text").textContent = isAuto
          ? e.target.checked
            ? "Active"
            : "Standby"
          : e.target.checked
            ? "Active"
            : "Off";
        updateSystemStatus();
        notify(
          e.target.checked ? "Humidifier activated" : "Humidifier deactivated",
        );
      });
    }

    if (scrubberToggle) {
      scrubberToggle.addEventListener("change", (e) => {
        systemStatus.scrubber = e.target.checked ? "active" : "standby";
        const isAuto = autoManualToggle?.checked ?? true;
        el("scrubber-status-text").textContent = isAuto
          ? e.target.checked
            ? "Active"
            : "Standby"
          : e.target.checked
            ? "Active"
            : "Off";
        updateSystemStatus();
        notify(
          e.target.checked ? "Scrubber activated" : "Scrubber deactivated",
        );
      });
    }

    // Camera actions
    const refreshBtn = el("refresh-snapshot");
    const galleryBtn = el("open-gallery");
    const uploadBtn = el("upload-image-btn");
    const manualImageInput = el("manual-image-input");

    async function refreshDashboardAfterSnapshot() {
      await Promise.all([
        loadLatestSnapshot(),
        loadAIAlerts(),
        loadCameraInventorySummary(),
        updateMetrics(),
      ]);
    }

    if (uploadBtn && manualImageInput) {
      uploadBtn.dataset.defaultLabel = uploadBtn.textContent || "+";

      uploadBtn.addEventListener("click", () => {
        manualImageInput.click();
      });

      manualImageInput.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append("image", file);

        uploadBtn.disabled = true;
        uploadBtn.textContent = "Uploading...";

        try {
          const response = await fetch("/api/upload-image", {
            method: "POST",
            body: formData,
          });
          const payload = await response.json();

          if (!response.ok) {
            throw new Error(payload?.error || "Upload failed");
          }

          if (payload?.error) {
            console.warn("Upload completed but inference failed:", payload);
            notify(`Uploaded, but inference failed: ${payload.error}`);
          } else {
            const provider = String(
              payload?.provider || "inference",
            ).toUpperCase();
            const detected =
              payload?.detected || payload?.rawDetectedLabel || "none";
            notify(`Processed by ${provider}. Detected: ${detected}`);
          }

          if (payload?.inventorySummary) {
            cameraInventorySummary = payload.inventorySummary;
            renderCameraInventorySummary();
          }

          if (Array.isArray(payload?.aiAlerts)) {
            aiAlerts = payload.aiAlerts;
            renderAIAlerts();
            renderSpoilageBanner(payload.aiAlerts, payload);
          }

          await refreshDashboardAfterSnapshot();
        } catch (error) {
          console.error("Manual upload failed:", error);
          notify(`Upload failed: ${error.message}`);
        } finally {
          uploadBtn.disabled = false;
          uploadBtn.textContent = uploadBtn.dataset.defaultLabel || "+";
          manualImageInput.value = "";
        }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await refreshDashboardAfterSnapshot();
        notify("Snapshot refreshed");
      });
    }
    if (galleryBtn) {
      galleryBtn.addEventListener("click", () => {
        console.log("Gallery button clicked");
        openGalleryModal();
      });
    } else {
      console.error("Open Gallery button not found!");
    }
  }

  // Gallery functionality
  async function openGalleryModal() {
    // Remove any existing gallery modal first
    const existingModal = document.getElementById("gallery-modal");
    if (existingModal) {
      existingModal.remove();
    }

    try {
      const response = await fetch("/api/snapshots", { cache: "no-store" });
      const data = await response.json();

      if (!data.snapshots || data.snapshots.length === 0) {
        alert("No snapshots available yet");
        return;
      }

      // Create modal
      const modal = document.createElement("div");
      modal.id = "gallery-modal";
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.95);
        z-index: 10000;
        overflow-y: auto;
        padding: 20px;
      `;

      modal.innerHTML = `
        <div style="max-width: 1200px; margin: 0 auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
            <h2 style="color: white; margin: 0;">Image Gallery</h2>
            <button id="close-gallery" class="btn camera-btn camera-btn-secondary">Close Gallery</button>
          </div>
          <div id="gallery-grid" style="
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
          ">
            ${data.snapshots
              .map(
                (snapshot, index) => `
              <div class="gallery-item" data-url="${snapshot.url}" style="
                background: white;
                border-radius: 12px;
                overflow: hidden;
                cursor: pointer;
                transition: transform 0.2s;
              " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                <img src="${snapshot.url}" alt="Snapshot" style="
                  width: 100%;
                  height: 250px;
                  object-fit: contain;
                  background: #0b0f14;
                "/>
                <div style="padding: 12px; text-align: center; color: #1f2937; font-size: 14px;">
                  ${new Date(snapshot.timestamp).toLocaleString()}
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Close button - use a function to ensure clean removal
      const closeGallery = () => {
        const galleryModal = document.getElementById("gallery-modal");
        if (galleryModal) {
          galleryModal.remove();
        }
      };

      document
        .getElementById("close-gallery")
        .addEventListener("click", closeGallery);

      // Click image to view full size
      document.querySelectorAll(".gallery-item").forEach((item, index) => {
        item.addEventListener("click", () => {
          viewFullImage(data.snapshots, index, closeGallery);
        });
      });

      // Close on outside click
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          closeGallery();
        }
      });
    } catch (error) {
      console.error("Error loading gallery:", error);
      alert("Failed to load gallery");
    }
  }

  function viewFullImage(snapshots, currentIndex, closeGalleryCallback) {
    let index = currentIndex;

    // Remove any existing viewer first
    const existingViewer = document.getElementById("image-viewer");
    if (existingViewer) {
      existingViewer.remove();
    }

    // Create full-screen image viewer
    const viewer = document.createElement("div");
    viewer.id = "image-viewer";
    viewer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.98);
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 60px 80px;
    `;

    function updateImage() {
      const snapshot = snapshots[index];
      viewer.innerHTML = `
        <div id="viewer-stage" style="position: relative; max-width: 100%; max-height: 100%;">
          <img id="viewer-image" src="${snapshot.url}" style="max-width: 100%; max-height: 100%; object-fit: contain; display: block;" />
          <div id="viewer-overlay" style="position: absolute; inset: 0; pointer-events: none;"></div>
        </div>
        
        <!-- Close Button -->
        <button id="close-viewer" style="
          position: absolute;
          top: 20px;
          right: 20px;
          background: #d1495b;
          color: white;
          border: none;
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          z-index: 10002;
        ">Close</button>

        <!-- Timestamp -->
        <div style="
          position: absolute;
          top: 20px;
          left: 20px;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          z-index: 10002;
        ">
          Captured: ${new Date(snapshot.timestamp).toLocaleString()}<br>
          <span style="font-size: 12px; opacity: 0.8;">Image ${index + 1} of ${
            snapshots.length
          }</span><br>
          <span style="font-size: 12px; opacity: 0.85;">Source: ${String(
            snapshot.source || "esp32cam",
          ).toUpperCase()}</span><br>
          <span style="font-size: 12px; opacity: 0.85;">Provider: ${String(
            snapshot.provider || "inference",
          ).toUpperCase()}</span>
        </div>

        <!-- Left Arrow -->
        ${
          index > 0
            ? `
        <button id="prev-image" style="
          position: absolute;
          left: 20px;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(255, 255, 255, 0.9);
          color: #1f2937;
          border: none;
          padding: 16px 20px;
          font-size: 24px;
          font-weight: 700;
          border-radius: 50%;
          cursor: pointer;
          width: 60px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10002;
          transition: background 0.2s;
        " onmouseover="this.style.background='white'" onmouseout="this.style.background='rgba(255, 255, 255, 0.9)'" aria-label="Previous image" title="Previous image">
          &larr;
        </button>
        `
            : ""
        }

        <!-- Right Arrow -->
        ${
          index < snapshots.length - 1
            ? `
        <button id="next-image" style="
          position: absolute;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          background: rgba(255, 255, 255, 0.9);
          color: #1f2937;
          border: none;
          padding: 16px 20px;
          font-size: 24px;
          font-weight: 700;
          border-radius: 50%;
          cursor: pointer;
          width: 60px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10002;
          transition: background 0.2s;
        " onmouseover="this.style.background='white'" onmouseout="this.style.background='rgba(255, 255, 255, 0.9)'" aria-label="Next image" title="Next image">
          &rarr;
        </button>
        `
            : ""
        }
      `;

      const imgEl = document.getElementById("viewer-image");
      const overlayEl = document.getElementById("viewer-overlay");
      const imageSize = snapshot?.imageSize || { width: 640, height: 640 };
      const sourceW = Number(imageSize.width || 640);
      const sourceH = Number(imageSize.height || 640);
      const detections = Array.isArray(snapshot?.detections)
        ? snapshot.detections
        : [];
      const alreadyAnnotated = Boolean(snapshot?.annotated);

      const drawDetections = () => {
        if (!overlayEl) return;
        overlayEl.innerHTML = "";

        if (alreadyAnnotated) {
          return;
        }

        detections.forEach((d) => {
          const bbox = Array.isArray(d?.bbox) ? d.bbox : [0, 0, 0, 0];
          const [x1, y1, x2, y2] = bbox.map((v) => Number(v || 0));

          const left = Math.max(0, Math.min(100, (x1 / sourceW) * 100));
          const top = Math.max(0, Math.min(100, (y1 / sourceH) * 100));
          const width = Math.max(
            0,
            Math.min(100 - left, ((x2 - x1) / sourceW) * 100),
          );
          const height = Math.max(
            0,
            Math.min(100 - top, ((y2 - y1) / sourceH) * 100),
          );

          const box = document.createElement("div");
          box.style.position = "absolute";
          box.style.left = `${left}%`;
          box.style.top = `${top}%`;
          box.style.width = `${width}%`;
          box.style.height = `${height}%`;
          box.style.border = "2px solid #22c55e";
          box.style.borderRadius = "4px";
          box.style.boxSizing = "border-box";

          const label = document.createElement("div");
          const className = String(d?.type || "unknown")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          const conf = `${Math.round(Number(d?.confidence || 0) * 100)}%`;
          label.textContent = `${className} ${conf}`;
          label.style.position = "absolute";
          label.style.left = "0";
          label.style.top = "-24px";
          label.style.padding = "3px 8px";
          label.style.fontSize = "12px";
          label.style.fontWeight = "700";
          label.style.color = "#06111f";
          label.style.background = "#86efac";
          label.style.borderRadius = "999px";
          label.style.whiteSpace = "nowrap";

          box.appendChild(label);
          overlayEl.appendChild(box);
        });
      };

      if (imgEl) {
        if (imgEl.complete) {
          drawDetections();
        } else {
          imgEl.addEventListener("load", drawDetections, { once: true });
        }
      }

      // Attach event listeners
      const closeBtn = document.getElementById("close-viewer");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          viewer.remove();
          document.removeEventListener("keydown", handleKeyPress);
        });
      }

      const prevBtn = document.getElementById("prev-image");
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          index--;
          updateImage();
        });
      }

      const nextBtn = document.getElementById("next-image");
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          index++;
          updateImage();
        });
      }
    }

    // Keyboard navigation
    function handleKeyPress(e) {
      if (e.key === "ArrowLeft" && index > 0) {
        index--;
        updateImage();
      } else if (e.key === "ArrowRight" && index < snapshots.length - 1) {
        index++;
        updateImage();
      } else if (e.key === "Escape") {
        const viewerToRemove = document.getElementById("image-viewer");
        if (viewerToRemove) {
          viewerToRemove.remove();
        }
        document.removeEventListener("keydown", handleKeyPress);
      }
    }

    document.addEventListener("keydown", handleKeyPress);

    // Close on background click
    viewer.addEventListener("click", (e) => {
      if (e.target === viewer || e.target.id === "image-viewer") {
        const viewerToRemove = document.getElementById("image-viewer");
        if (viewerToRemove) {
          viewerToRemove.remove();
        }
        document.removeEventListener("keydown", handleKeyPress);
      }
    });

    document.body.appendChild(viewer);
    updateImage();
  }

  // Inventory sample data and rendering
  const inventory = [
    {
      item: "Apples",
      qty: 24,
      unit: "units",
      shelf: 3,
      status: "critical",
      snapshot: "assets/img/icon-512.svg",
    },
    {
      item: "Potatoes",
      qty: 45,
      unit: "units",
      shelf: 21,
      status: "good",
      snapshot: "assets/img/icon-512.svg",
    },
  ];

  // AI alerts are fetched from backend camera analysis and auto-clear when resolved.
  const DUMMY_CAMERA_INVENTORY_SUMMARY = {
    totalApples: 5,
    totalPotatoes: 4,
    applesGood: 2,
    applesBad: 3,
    potatoesGood: 3,
    potatoesBad: 1,
    analyzedAt: null,
  };

  const DUMMY_AI_ALERTS = [
    {
      id: "dummy-apple-alert",
      title: "Apples",
      severity: "high",
      message:
        "AI detected overripening in 3 apples. Please inspect latest images and remove affected apples physically.",
    },
    {
      id: "dummy-potato-alert",
      title: "Potatoes",
      severity: "medium",
      message:
        "AI detected quality drop in 1 potato. Please inspect latest images and remove affected potatoes physically.",
    },
  ];

  const DUMMY_INVENTORY_ITEMS = [
    { id: "demo-a", type: "apples", quantity: 5, daysLeft: 3 },
    { id: "demo-p", type: "potatoes", quantity: 4, daysLeft: 21 },
  ];

  let aiAlerts = [];
  let cameraInventorySummary = {
    totalApples: 0,
    totalPotatoes: 0,
    applesGood: 0,
    applesBad: 0,
    potatoesGood: 0,
    potatoesBad: 0,
  };

  function renderSpoilageBanner(alerts = [], meta = {}) {
    const banner = el("spoilage-banner");
    const text = el("spoilage-banner-text");
    if (!banner || !text) return;

    const liveAlerts = Array.isArray(alerts) ? alerts : [];
    const shouldShow = Boolean(meta?.sourceSnapshot) && liveAlerts.length > 0;

    if (!shouldShow) {
      banner.hidden = true;
      text.textContent = "";
      return;
    }

    const summary = liveAlerts
      .map((alert) => {
        const title = String(alert?.title || "Item").trim();
        const count = Number(alert?.count || 1);
        return `${title} (${count})`;
      })
      .join(", ");

    text.textContent =
      liveAlerts.length === 1
        ? `HIGH ALERT: ${summary} spoilage detected. Remove affected items immediately.`
        : `HIGH ALERT: ${summary} spoilage detected. Remove affected items immediately.`;
    banner.hidden = false;
  }

  async function loadAIAlerts() {
    try {
      const res = await fetch("/api/ai-alerts", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch AI alerts");
      const data = await res.json();
      const liveAlerts = Array.isArray(data.alerts) ? data.alerts : [];
      aiAlerts = liveAlerts;
      renderAIAlerts();
      renderSpoilageBanner(liveAlerts, data);
    } catch (error) {
      console.error("Error loading AI alerts:", error);
      aiAlerts = [];
      renderAIAlerts();
      renderSpoilageBanner([], {});
    }
  }

  async function loadCameraInventorySummary() {
    try {
      const res = await fetch("/api/camera-inventory-summary", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch camera inventory summary");
      const data = await res.json();
      const summary = data.summary || {};
      const hasLiveSummary = Boolean(summary.analyzedAt);
      cameraInventorySummary = hasLiveSummary
        ? summary
        : DUMMY_CAMERA_INVENTORY_SUMMARY;
      renderCameraInventorySummary();
      syncStorageInfoFromCameraSummary(cameraInventorySummary);
      applyAutoThresholdMode();
      renderRecommendations();
    } catch (error) {
      console.error("Error loading camera inventory summary:", error);
      cameraInventorySummary = DUMMY_CAMERA_INVENTORY_SUMMARY;
      renderCameraInventorySummary();
      syncStorageInfoFromCameraSummary(cameraInventorySummary);
      applyAutoThresholdMode();
      renderRecommendations();
    }
  }

  function renderCameraInventorySummary() {
    const applesTotalEl = el("camera-apples-total");
    const applesGoodEl = el("camera-apples-good");
    const applesBadEl = el("camera-apples-bad");
    const applesStatusEl = el("camera-apples-status");
    const applesNoteEl = el("camera-apples-note");
    const potatoesTotalEl = el("camera-potatoes-total");
    const potatoesGoodEl = el("camera-potatoes-good");
    const potatoesBadEl = el("camera-potatoes-bad");
    const potatoesStatusEl = el("camera-potatoes-status");
    const potatoesNoteEl = el("camera-potatoes-note");

    const setRow = (
      totalEl,
      goodEl,
      badEl,
      statusEl,
      noteEl,
      itemName,
      total,
      good,
      bad,
    ) => {
      if (totalEl) totalEl.textContent = String(total || 0);
      if (goodEl) goodEl.textContent = String(good || 0);
      if (badEl) badEl.textContent = String(bad || 0);
      if (statusEl) {
        const badgeText = bad >= 1 ? "HIGH ALERT" : "OK";
        statusEl.textContent = badgeText;
        statusEl.classList.remove("camera-status-high", "camera-status-ok");
        statusEl.classList.add(
          bad >= 1 ? "camera-status-high" : "camera-status-ok",
        );
      }
      if (noteEl) {
        const actionText =
          bad > 0
            ? `High alert: check the latest camera images immediately, then remove affected ${itemName.toLowerCase()} from the storage unit.`
            : `No spoilage detected for ${itemName.toLowerCase()} in the latest camera run.`;
        noteEl.textContent = actionText;
      }
    };

    setRow(
      applesTotalEl,
      applesGoodEl,
      applesBadEl,
      applesStatusEl,
      applesNoteEl,
      "Apples",
      cameraInventorySummary.totalApples,
      cameraInventorySummary.applesGood,
      cameraInventorySummary.applesBad,
    );
    setRow(
      potatoesTotalEl,
      potatoesGoodEl,
      potatoesBadEl,
      potatoesStatusEl,
      potatoesNoteEl,
      "Potatoes",
      cameraInventorySummary.totalPotatoes,
      cameraInventorySummary.potatoesGood,
      cameraInventorySummary.potatoesBad,
    );
  }

  function renderRecommendations() {
    const applesForecastEl = el("forecast-apples");
    const potatoesForecastEl = el("forecast-potatoes");
    const forecastSummaryEl = el("forecast-summary");
    const environmentScoreEl = el("environment-score");
    const environmentSummaryEl = el("environment-summary");
    const recommendationListEl = el("recommendation-list");
    const priorityListEl = el("priority-list");

    if (!applesForecastEl || !potatoesForecastEl || !forecastSummaryEl) return;

    const latestTemp = series.temp[series.temp.length - 1];
    const latestHumidity = series.humidity[series.humidity.length - 1];
    const latestEthylene = series.ethylene[series.ethylene.length - 1];
    const hasLiveMetrics =
      Number.isFinite(latestTemp) &&
      Number.isFinite(latestHumidity) &&
      Number.isFinite(latestEthylene);

    const activeThresholds = currentProduceContext.thresholds || {
      temperature: targets.temp,
      humidity: targets.humidity,
      voc: targets.ethylene.max * 1000,
    };

    const tempMin = activeThresholds.temperature?.min ?? targets.temp.min;
    const tempMax = activeThresholds.temperature?.max ?? targets.temp.max;
    const humidityMin = activeThresholds.humidity?.min ?? targets.humidity.min;
    const humidityMax = activeThresholds.humidity?.max ?? targets.humidity.max;
    const vocMax = (activeThresholds.voc ?? targets.ethylene.max * 1000) / 1000;

    const recentWindow = 6;
    const recentTemp = series.temp.slice(-recentWindow);
    const recentHumidity = series.humidity.slice(-recentWindow);
    const recentEthylene = series.ethylene.slice(-recentWindow);

    const trendDelta = (values) =>
      values.length >= 2 ? values[values.length - 1] - values[0] : 0;
    const trendLabel = (delta, tolerance) =>
      Math.abs(delta) <= tolerance
        ? "stable"
        : delta > 0
          ? "rising"
          : "falling";

    const tempDelta = trendDelta(recentTemp);
    const humidityDelta = trendDelta(recentHumidity);
    const ethyleneDelta = trendDelta(recentEthylene);
    const tempTrend = trendLabel(tempDelta, 0.2);
    const humidityTrend = trendLabel(humidityDelta, 1.0);
    const ethyleneTrend = trendLabel(ethyleneDelta, 0.005);

    const tempMid = (tempMin + tempMax) / 2;
    const humidityMid = (humidityMin + humidityMax) / 2;
    const tempBand = Math.max(1, (tempMax - tempMin) / 2);
    const humidityBand = Math.max(1, (humidityMax - humidityMin) / 2);

    const tempStress = hasLiveMetrics
      ? Math.max(0, Math.abs(latestTemp - tempMid) - tempBand) * 1.4 +
        (tempTrend === "rising" ? Math.max(0, tempDelta) * 2.2 : 0)
      : 0;
    const humidityStress = hasLiveMetrics
      ? Math.max(0, Math.abs(latestHumidity - humidityMid) - humidityBand) *
          0.5 +
        (humidityTrend === "falling" ? Math.max(0, -humidityDelta) * 0.8 : 0)
      : 0;
    const ethyleneStress = hasLiveMetrics
      ? Math.max(0, latestEthylene - vocMax) * 18 +
        (ethyleneTrend === "rising" ? Math.max(0, ethyleneDelta) * 140 : 0)
      : 0;

    const riskScore = tempStress + humidityStress + ethyleneStress;
    const stabilityScore = Math.max(0, Math.round(100 - riskScore * 12));
    const stabilityLabel =
      stabilityScore >= 80
        ? "Stable"
        : stabilityScore >= 60
          ? "Watch"
          : "At risk";

    const shelfLifeOutlook = (produceType) => {
      const badCount = cameraInventorySummary[`${produceType}Bad`] || 0;
      const pressure =
        riskScore * (produceType === "potatoes" ? 0.8 : 1.1) + badCount * 0.9;

      if (!hasLiveMetrics) return "Assessing...";
      if (pressure <= 1.8) return "Expected to increase";
      if (pressure <= 3.5) return "Likely stable";
      if (pressure <= 5.5) return "May decrease";
      return "Likely to decrease";
    };

    const applesOutlook = shelfLifeOutlook("apples");
    const potatoesOutlook = shelfLifeOutlook("potatoes");

    applesForecastEl.textContent = applesOutlook;
    potatoesForecastEl.textContent = potatoesOutlook;

    const trendSummaryParts = [];
    if (hasLiveMetrics) {
      trendSummaryParts.push(
        `Temp ${tempTrend} (${Math.abs(tempDelta).toFixed(1)}\u00B0C)`,
      );
      trendSummaryParts.push(
        `Humidity ${humidityTrend} (${Math.abs(humidityDelta).toFixed(1)}%)`,
      );
      trendSummaryParts.push(
        `VOC ${ethyleneTrend} (${Math.abs(ethyleneDelta).toFixed(1)} ppm)`,
      );
    } else {
      trendSummaryParts.push("Waiting for live data");
    }

    const conditionSummary = hasLiveMetrics
      ? riskScore > 4
        ? "Current conditions are outside optimal ranges and can reduce shelf life unless corrected."
        : riskScore > 2
          ? "Conditions are near target, but tighter control is needed for shelf-life gains."
          : "Conditions are within target thresholds, so shelf life is expected to increase."
      : "Waiting for live data.";

    forecastSummaryEl.textContent = conditionSummary;
    if (environmentScoreEl) {
      environmentScoreEl.textContent = `${stabilityScore}/100`;
    }
    if (environmentSummaryEl) {
      environmentSummaryEl.textContent = `${stabilityLabel}: ${trendSummaryParts.join(" | ")}`;
    }

    const recommendations = [];
    if (hasLiveMetrics) {
      if (latestTemp > tempMax + 0.2 || tempTrend === "rising") {
        recommendations.push(
          `Lower temperature to ${tempMin}-${tempMax}\u00B0C.`,
        );
      }
      if (latestHumidity < humidityMin - 1) {
        recommendations.push(
          `Raise humidity to ${humidityMin}-${humidityMax}%.`,
        );
      } else if (latestHumidity > humidityMax + 1) {
        recommendations.push(
          `Lower humidity to ${humidityMin}-${humidityMax}%.`,
        );
      }
      if (latestEthylene > vocMax || ethyleneTrend === "rising") {
        recommendations.push("Run scrubber and remove damaged produce.");
      }
      if (recommendations.length === 0) {
        recommendations.push("Conditions are good. Keep current settings.");
      }
      recommendations.push("Check apples first.");
    } else {
      recommendations.push("Waiting for live data.");
    }

    if (recommendationListEl) {
      recommendationListEl.innerHTML = recommendations
        .slice(0, 3)
        .map((item) => `<li>${item}</li>`)
        .join("");
    }

    const priorityScore = (produceType) => {
      const badCount = cameraInventorySummary[`${produceType}Bad`] || 0;
      return riskScore * (produceType === "potatoes" ? 0.8 : 1.1) + badCount;
    };

    const priorityItems = [
      {
        name: "Apples",
        score: priorityScore("apples"),
        reason:
          cameraInventorySummary.applesBad > 0
            ? `${cameraInventorySummary.applesBad} bad detections`
            : "No current spoilage spike",
      },
      {
        name: "Potatoes",
        score: priorityScore("potatoes"),
        reason:
          cameraInventorySummary.potatoesBad > 0
            ? `${cameraInventorySummary.potatoesBad} bad detections`
            : "No current spoilage spike",
      },
    ].sort((a, b) => b.score - a.score);

    if (priorityListEl) {
      priorityListEl.innerHTML = priorityItems
        .map((item) => `<li>${item.name} (${item.reason})</li>`)
        .join("");
    }
  }

  function renderAIAlerts() {
    const container = document.getElementById("ai-alerts-list");
    const countBadge = document.getElementById("alert-count");
    const cameraBadge = document.getElementById("camera-nav-badge");

    const activeCount = aiAlerts.filter(
      (a) => a.severity === "high" || a.severity === "medium",
    ).length;
    if (countBadge) {
      countBadge.textContent =
        activeCount > 0
          ? `${activeCount} AI Active Alerts`
          : "No AI Active Alerts";
      countBadge.style.background = activeCount > 0 ? "#d1495b" : "#22c55e";
    }
    if (cameraBadge) {
      cameraBadge.textContent = String(activeCount);
      cameraBadge.hidden = activeCount === 0;
    }

    if (!container) return;

    container.innerHTML = "";

    if (aiAlerts.length === 0) {
      const card = document.createElement("div");
      card.className = "alert-card";
      card.innerHTML = `
        <header>
          <h3 class="produce-name">No active quality alerts</h3>
          <span class="severity low">GOOD</span>
        </header>
        <div class="alert-content">
          <p class="alert-message">AI camera currently detects no overripening or rotten items.</p>
        </div>
      `;
      container.appendChild(card);
      return;
    }

    aiAlerts.forEach((alert) => {
      const card = document.createElement("div");
      card.className = "alert-card";

      const severityClass =
        alert.severity === "high"
          ? "high"
          : alert.severity === "medium"
            ? "medium"
            : "low";

      const needsManualAction =
        alert.severity === "high" || alert.severity === "medium";

      const guidanceHtml = needsManualAction
        ? `<p class="alert-guidance">Action required: check the latest camera images, then remove affected items physically from the storage unit. This alert clears automatically after the camera no longer detects spoilage.</p>`
        : "";

      card.innerHTML = `
        <header>
          <h3 class="produce-name">${alert.title}</h3>
          <span class="severity ${severityClass}">${alert.severity.toUpperCase()}</span>
        </header>
        <div class="alert-content">
          <p class="alert-message">${alert.message}</p>
          ${guidanceHtml}
        </div>
      `;
      container.appendChild(card);
    });
  }

  function renderInventory(list) {
    const tbody = el("inv-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    list.forEach((r) => {
      const tr = document.createElement("tr");
      const statusClass =
        r.status === "critical"
          ? "critical"
          : r.status === "warning"
            ? "warning"
            : "good";
      const statusText = `${r.shelf} days left`;
      tr.innerHTML = `
        <td><strong>${r.item}</strong></td>
        <td>${r.qty} ${r.unit}</td>
        <td>${statusText}</td>
        <td><span class="status-col ${statusClass}">${r.status}</span></td>
        <td>
          <div class="actions">
            <button>Edit</button>
            <button>Remove</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function bindInventory() {
    // This function is deprecated - functionality moved to bindInventoryControls
    // Keeping empty stub to avoid errors from init() call
  }

  // Threshold profiles and dynamic mode selection based on AI camera detections.
  const thresholdProfiles = {
    custom: {
      temperature: { min: 4, max: 7 },
      humidity: { min: 85, max: 95 },
      voc: 30000,
    },
    apples: {
      temperature: { min: 1, max: 4 },
      humidity: { min: 85, max: 95 },
      voc: 30000,
    },
    potatoes: {
      temperature: { min: 7, max: 10 },
      humidity: { min: 85, max: 95 },
      voc: 30000,
    },
  };

  let customThresholdRanges = JSON.parse(
    JSON.stringify(thresholdProfiles.custom),
  );
  let activeThresholdMode = "custom";

  function clampRange(minVal, maxVal, minLimit, maxLimit) {
    let min = Number(minVal);
    let max = Number(maxVal);
    if (!Number.isFinite(min)) min = minLimit;
    if (!Number.isFinite(max)) max = maxLimit;
    min = Math.max(minLimit, Math.min(maxLimit, min));
    max = Math.max(minLimit, Math.min(maxLimit, max));
    if (min > max) {
      const tmp = min;
      min = max;
      max = tmp;
    }
    return { min, max };
  }

  function getDetectedThresholdMode() {
    const applesDetected =
      Number(cameraInventorySummary.totalApples || 0) > 0 ||
      Number(cameraInventorySummary.applesGood || 0) > 0 ||
      Number(cameraInventorySummary.applesBad || 0) > 0;
    const potatoesDetected =
      Number(cameraInventorySummary.totalPotatoes || 0) > 0 ||
      Number(cameraInventorySummary.potatoesGood || 0) > 0 ||
      Number(cameraInventorySummary.potatoesBad || 0) > 0;

    if (applesDetected && potatoesDetected) return "custom";
    if (applesDetected) return "apples";
    if (potatoesDetected) return "potatoes";

    if (currentProduceContext?.type === "apples") return "apples";
    if (currentProduceContext?.type === "potatoes") return "potatoes";

    return "custom";
  }

  function getProfileByMode(mode) {
    if (mode === "custom") return customThresholdRanges;
    return thresholdProfiles[mode] || customThresholdRanges;
  }

  function applyThresholdProfile(mode) {
    const normalizedMode = mode || "custom";
    const profile = getProfileByMode(normalizedMode);
    activeThresholdMode = normalizedMode;

    targets.temp.min = profile.temperature.min;
    targets.temp.max = profile.temperature.max;
    targets.humidity.min = profile.humidity.min;
    targets.humidity.max = profile.humidity.max;
    targets.ethylene.max = profile.voc / 1000;

    const tempEl = el("threshold-temp");
    const humidEl = el("threshold-humidity");
    const vocEl = el("threshold-voc");
    if (tempEl) {
      tempEl.textContent = `${fmtWhole(profile.temperature.min)}-${fmtWhole(profile.temperature.max)}\u00B0C`;
    }
    if (humidEl) {
      humidEl.textContent = `${fmtWhole(profile.humidity.min)}-${fmtWhole(profile.humidity.max)}%`;
    }
    if (vocEl) {
      vocEl.textContent = `${fmtWhole(profile.voc / 1000)} ppm`;
    }

    const tempTarget = document.querySelector(
      '[aria-label="Temperature"] .target',
    );
    const humidityTarget = document.querySelector(
      '[aria-label="Humidity"] .target',
    );
    const ethyleneTarget = document.querySelector(
      '[aria-label="Ethylene/VOCs"] .target',
    );
    if (tempTarget) {
      tempTarget.textContent = `Target: ${fmtWhole(profile.temperature.min)}-${fmtWhole(profile.temperature.max)}\u00B0C`;
    }
    if (humidityTarget) {
      humidityTarget.textContent = `Target: ${fmtWhole(profile.humidity.min)}-${fmtWhole(profile.humidity.max)}%`;
    }
    if (ethyleneTarget) {
      ethyleneTarget.textContent = `Threshold: ${fmtWhole(profile.voc / 1000)} ppm`;
    }

    const modeNote = el("threshold-mode-note");
    if (modeNote) {
      if (normalizedMode === "custom") {
        modeNote.textContent =
          "Mixed produce detected (or unknown). Using Custom range thresholds.";
      } else if (normalizedMode === "apples") {
        modeNote.textContent =
          "AI camera detects apples only. Apples thresholds are applied automatically.";
      } else {
        modeNote.textContent =
          "AI camera detects potatoes only. Potatoes thresholds are applied automatically.";
      }
    }

    const presetSelect = el("produce-preset");
    if (presetSelect) {
      presetSelect.value = normalizedMode;
    }
  }

  function applyAutoThresholdMode() {
    applyThresholdProfile(getDetectedThresholdMode());
  }

  function bindSettings() {
    const saveBtn = el("settings-save-btn");
    const inputs = document.querySelectorAll(".threshold-input");

    if (!saveBtn || !inputs.length) return;

    // Handle Save button click
    saveBtn.addEventListener("click", () => {
      // Collect values from each profile row
      const profiles = ["custom", "apples", "potatoes"];

      profiles.forEach((profileName) => {
        const tempMin = document.querySelector(
          `.threshold-input[data-profile="${profileName}"][data-field="temp-min"]`,
        );
        const tempMax = document.querySelector(
          `.threshold-input[data-profile="${profileName}"][data-field="temp-max"]`,
        );
        const humidityMin = document.querySelector(
          `.threshold-input[data-profile="${profileName}"][data-field="humidity-min"]`,
        );
        const humidityMax = document.querySelector(
          `.threshold-input[data-profile="${profileName}"][data-field="humidity-max"]`,
        );
        const voc = document.querySelector(
          `.threshold-input[data-profile="${profileName}"][data-field="voc"]`,
        );

        if (tempMin && tempMax && humidityMin && humidityMax && voc) {
          // Validate and clamp values
          const temperature = clampRange(
            Number(tempMin.value),
            Number(tempMax.value),
            -5,
            15,
          );
          const humidity = clampRange(
            Number(humidityMin.value),
            Number(humidityMax.value),
            50,
            100,
          );
          const vocValue = Math.max(0, Math.min(50000, Number(voc.value)));

          // Update thresholdProfiles
          thresholdProfiles[profileName].temperature = temperature;
          thresholdProfiles[profileName].humidity = humidity;
          thresholdProfiles[profileName].voc = vocValue;

          // Update input values to validated versions
          tempMin.value = temperature.min;
          tempMax.value = temperature.max;
          humidityMin.value = humidity.min;
          humidityMax.value = humidity.max;
          voc.value = vocValue;
        }
      });

      // Save custom ranges and reapply active threshold
      customThresholdRanges = JSON.parse(
        JSON.stringify(thresholdProfiles.custom),
      );

      // Re-apply the current active threshold mode to update displays
      applyAutoThresholdMode();

      // Show confirmation
      saveBtn.textContent = "Saved!";
      setTimeout(() => {
        saveBtn.textContent = "Save Settings";
      }, 1500);
    });
  }

  function bindTimeRangeButtons() {
    const buttons = document.querySelectorAll(".time-range-btn");
    if (!buttons.length) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        // Update active state
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // Get selected range
        currentTimeRange = btn.getAttribute("data-range");
        await loadHistoricalTrend(currentTimeRange);
      });
    });
  }

  function applyTrendSeries(nextSeries) {
    series.temp = nextSeries.temp;
    series.humidity = nextSeries.humidity;
    series.ethylene = nextSeries.ethylene;
    series.times = nextSeries.times;

    drawSpark(ctx("temp-chart"), series.temp, "#d1495b");
    drawSpark(ctx("humidity-chart"), series.humidity, "#0077b6");
    drawSpark(ctx("ethylene-chart"), series.ethylene, "#d97706");
    drawEnvTrend(ctx("env-trend"), series);
    renderRecommendations();
  }

  async function loadHistoricalTrend(range) {
    const requestId = ++trendLoadRequestId;
    const normalizedRange = String(range || "24h").toLowerCase();

    try {
      const res = await fetch(
        `/api/history?range=${encodeURIComponent(normalizedRange)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Failed to fetch history (${res.status})`);

      const data = await res.json();
      if (requestId !== trendLoadRequestId) return;

      const points = Array.isArray(data?.points) ? data.points : [];
      if (!points.length) {
        // Seed with current live values so any range has a visible baseline.
        const latest = await fetchMetrics();
        if (requestId !== trendLoadRequestId) return;
        if (
          latest &&
          ["temp", "humidity", "ethylene"].every(
            (k) => typeof latest[k] === "number" && !Number.isNaN(latest[k]),
          )
        ) {
          const now = Date.now();
          applyTrendSeries({
            temp: [latest.temp],
            humidity: [latest.humidity],
            ethylene: [latest.ethylene],
            times: [now],
          });
        } else {
          applyTrendSeries({ temp: [], humidity: [], ethylene: [], times: [] });
        }
        return;
      }

      applyTrendSeries({
        temp: points.map((p) => Number(p.temperature || 0)),
        humidity: points.map((p) => Number(p.humidity || 0)),
        ethylene: points.map((p) => Number(p.ethylene || 0)),
        times: points.map((p) => Number(p.timestamp || Date.now())),
      });
    } catch (error) {
      if (requestId !== trendLoadRequestId) return;
      console.error("Failed to load historical trend:", error);
      showAlert(
        `Failed to load ${normalizedRange.toUpperCase()} history`,
        "error",
      );
    }
  }

  function triggerFileDownload(url) {
    const link = document.createElement("a");
    link.href = url;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function bindExportButtons() {
    const combinedReportBtn = el("export-combined-report");

    if (combinedReportBtn) {
      combinedReportBtn.addEventListener("click", () => {
        triggerFileDownload(
          `/api/exports/summary.pdf?range=${encodeURIComponent(currentTimeRange)}`,
        );
        showAlert(
          `Downloading combined report PDF (${currentTimeRange.toUpperCase()})`,
          "success",
        );
      });
    }
  }

  // Produce management functions
  const produceNames = {
    apples: "Apples",
    potatoes: "Potatoes",
    null: "Not detected",
  };

  function updateProduceDisplay(produce) {
    currentProduceContext = {
      type: produce?.type || null,
      thresholds: produce?.thresholds || null,
      manualOverride: Boolean(produce?.manualOverride),
    };

    const name = el("current-produce-name");
    const method = el("current-produce-method");
    const confidence = el("current-produce-confidence");

    if (name)
      name.textContent = produceNames[produce.type] || produceNames.null;

    if (method) {
      if (produce.type) {
        method.textContent = produce.manualOverride
          ? "Manually selected"
          : "AI detected";
      } else {
        method.textContent = "Waiting for detection...";
      }
    }

    if (confidence) {
      if (produce.confidence && !produce.manualOverride) {
        confidence.textContent = `${(produce.confidence * 100).toFixed(
          1,
        )}% confidence`;
      } else {
        confidence.textContent = "";
      }
    }

    applyAutoThresholdMode();

    renderRecommendations();
  }

  function syncStorageInfoFromCameraSummary(summary) {
    if (!summary || currentProduceContext.manualOverride) return;

    const apples = Number(summary.totalApples || 0);
    const potatoes = Number(summary.totalPotatoes || 0);
    const total = apples + potatoes;

    const name = el("current-produce-name");
    const method = el("current-produce-method");
    const confidence = el("current-produce-confidence");

    if (total <= 0) {
      if (name) name.textContent = produceNames.null;
      if (method) method.textContent = "No camera detections yet";
      if (confidence) confidence.textContent = "";
      currentProduceContext.type = null;
      return;
    }

    if (apples > 0 && potatoes > 0) {
      if (name) name.textContent = "Apples + Potatoes";
      currentProduceContext.type = null;
    } else if (apples > 0) {
      if (name) name.textContent = produceNames.apples;
      currentProduceContext.type = "apples";
    } else if (potatoes > 0) {
      if (name) name.textContent = produceNames.potatoes;
      currentProduceContext.type = "potatoes";
    }

    if (method) method.textContent = "AI camera summary";
    if (confidence) {
      confidence.textContent = `${total} item${total === 1 ? "" : "s"} detected`;
    }
  }

  async function setProduceType(produceType) {
    try {
      const res = await fetch("/api/produce/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produceType }),
      });

      if (!res.ok) throw new Error("Failed to set produce type");

      const data = await res.json();
      if (data.success) {
        updateProduceDisplay(data.produce);
        showAlert(
          `Produce set to ${produceNames[produceType]}. Thresholds updated.`,
          "success",
        );
      }
    } catch (e) {
      showAlert(`Failed to set produce type: ${e.message}`, "error");
    }
  }

  function bindProduceControls() {
    const setBtn = el("set-produce-btn");
    const select = el("manual-produce-select");

    if (setBtn && select) {
      setBtn.addEventListener("click", () => {
        const selectedProduce = select.value;
        if (selectedProduce) {
          setProduceType(selectedProduce);
        } else {
          showAlert("Please select a produce type", "warning");
        }
      });
    }
  }

  // Inventory Management
  let inventoryItems = [];

  function renderInventory() {
    const tbody = el("inv-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (inventoryItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 24px; color: #9ca3af;">No items in inventory. Click "+ Add Items" to add produce.</td></tr>`;
      return;
    }

    inventoryItems.forEach((item) => {
      const row = document.createElement("tr");

      // Determine status
      let status = "Good";
      let statusClass = "good";
      if (item.daysLeft <= 3) {
        status = "Critical";
        statusClass = "critical";
      } else if (item.daysLeft <= 7) {
        status = "Warning";
        statusClass = "warning";
      }

      const itemIcon = produceIcons[item.type] || "";
      const itemName = produceNames[item.type] || item.type;

      row.innerHTML = `
        <td>${itemIcon} ${itemName}</td>
        <td>${item.quantity} units</td>
        <td style="color: ${
          statusClass === "critical"
            ? "#b23a48"
            : statusClass === "warning"
              ? "#d97706"
              : "#059669"
        };">
          ${item.daysLeft} days left
        </td>
        <td style="color: ${
          statusClass === "critical"
            ? "#b23a48"
            : statusClass === "warning"
              ? "#d97706"
              : "#059669"
        }; font-weight: 500;">${status}</td>
        <td>
          <button 
            class="delete-item-btn" 
            data-item-id="${item.id}"
            style="
              background: #d1495b;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 6px;
              cursor: pointer;
              font-size: 13px;
              font-weight: 600;
            "
            onmouseover="this.style.background='#b23a48'"
            onmouseout="this.style.background='#d1495b'"
          >Delete</button>
        </td>
      `;
      tbody.appendChild(row);

      // Add delete event listener
      const deleteBtn = row.querySelector(".delete-item-btn");
      if (deleteBtn) {
        deleteBtn.addEventListener("click", async () => {
          console.log("Delete button clicked for item:", item.id);
          if (confirm(`Delete ${item.quantity} units of ${itemName}?`)) {
            console.log("User confirmed deletion");
            await deleteInventoryItem(item.id);
          } else {
            console.log("User cancelled deletion");
          }
        });
      }
    });
  }

  function bindInventoryControls() {
    const addBtn = el("add-items-btn");
    const modal = el("add-inventory-modal");
    const form = el("add-inventory-form");
    const cancelBtn = el("cancel-add-item");

    if (!addBtn || !modal || !form) return;

    // Open modal
    addBtn.addEventListener("click", () => {
      modal.hidden = false;
      form.reset();
    });

    // Close modal
    cancelBtn.addEventListener("click", () => {
      modal.hidden = true;
    });

    // Submit form
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const produceType = el("item-produce-type").value;
      const quantity = parseInt(el("item-quantity").value);
      const daysLeft = parseInt(el("item-days-left").value);

      if (!produceType || !quantity || !daysLeft) {
        showAlert("Please fill all fields", "warning");
        return;
      }

      try {
        const res = await fetch("/api/inventory/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ produceType, quantity, daysLeft }),
        });

        const data = await res.json();

        if (data.success) {
          inventoryItems = data.inventory;
          renderInventory();
          modal.hidden = true;
          showAlert(
            `${quantity} units of ${produceNames[produceType]} added to inventory`,
            "success",
          );
        } else {
          showAlert(`Failed to add item: ${data.error}`, "error");
        }
      } catch (error) {
        showAlert(`Error adding item: ${error.message}`, "error");
      }
    });
  }

  async function loadInventory() {
    try {
      const res = await fetch("/api/inventory");
      const data = await res.json();

      if (data.success) {
        inventoryItems =
          Array.isArray(data.inventory) && data.inventory.length > 0
            ? data.inventory
            : DUMMY_INVENTORY_ITEMS;
        renderInventory();
      }
    } catch (error) {
      console.error("Error loading inventory:", error);
      inventoryItems = DUMMY_INVENTORY_ITEMS;
      renderInventory();
    }
  }

  async function deleteInventoryItem(itemId) {
    console.log("deleteInventoryItem called with ID:", itemId);
    try {
      const res = await fetch(`/api/inventory/delete/${itemId}`, {
        method: "DELETE",
      });

      console.log("Delete response status:", res.status);
      const data = await res.json();
      console.log("Delete response data:", data);

      if (data.success) {
        inventoryItems = data.inventory;
        renderInventory();
        showAlert("Item deleted successfully", "success");
      } else {
        showAlert(`Failed to delete item: ${data.error}`, "error");
      }
    } catch (error) {
      console.error("Error deleting item:", error);
      showAlert(`Error deleting item: ${error.message}`, "error");
    }
  }

  // Camera snapshot functions
  function getSnapshotLabel(snapshot) {
    const detections = Array.isArray(snapshot?.detections)
      ? snapshot.detections
      : [];
    if (!detections.length) return "No detections";

    const top = detections
      .slice()
      .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];
    const label = String(top?.type || "unknown")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const score = `${Math.round(Number(top?.confidence || 0) * 100)}%`;
    return `${label} (${score})`;
  }

  function renderLatestSnapshotsGrid(snapshots) {
    const grid = el("latest-snapshots-grid");
    if (!grid) return;

    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      grid.innerHTML = `
        <article class="camera-thumb-card camera-thumb-card--empty">
          <div class="camera-thumb-empty">No snapshots yet</div>
        </article>
      `;
      return;
    }

    grid.innerHTML = snapshots
      .map(
        (snapshot, idx) => `
      <article class="camera-thumb-card" data-snapshot-index="${idx}">
        <div class="camera-thumb-image-wrap">
          <img class="camera-thumb-image" src="${snapshot.url}?t=${Date.now()}" alt="Snapshot ${idx + 1}" />
        </div>
        <div class="camera-thumb-meta">
          <span class="camera-thumb-time">${new Date(snapshot.timestamp).toLocaleString()}</span>
          <span class="camera-thumb-label">${getSnapshotLabel(snapshot)}</span>
          <div class="camera-thumb-tags">
            <span class="ai-label-pill">SRC: ${String(snapshot.source || "esp32cam").toUpperCase()}</span>
            <span class="ai-label-pill">${String(snapshot.provider || "inference").toUpperCase()}</span>
          </div>
        </div>
      </article>
    `,
      )
      .join("");

    grid.querySelectorAll(".camera-thumb-card").forEach((card) => {
      card.addEventListener("click", () => {
        const index = Number(card.getAttribute("data-snapshot-index") || 0);
        viewFullImage(snapshots, index, null);
      });
    });
  }

  async function loadLatestSnapshot() {
    try {
      const res = await fetch("/api/snapshots?limit=3", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch snapshots");
      const data = await res.json();
      const latestThree = Array.isArray(data?.snapshots)
        ? data.snapshots.slice(0, 3)
        : [];
      renderLatestSnapshotsGrid(latestThree);
    } catch (e) {
      console.error("Error loading snapshots:", e);
      renderLatestSnapshotsGrid([]);
    }
  }

  async function openSnapshotGallery() {
    try {
      const res = await fetch("/api/snapshots", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch snapshots");

      const data = await res.json();

      if (!data.success || !data.snapshots || data.snapshots.length === 0) {
        showAlert("No snapshots available yet", "warning");
        return;
      }

      // Create gallery modal
      const modal = document.createElement("div");
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 20px;
        overflow-y: auto;
      `;

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Close Gallery";
      closeBtn.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: #d1495b;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        font-weight: 600;
        z-index: 10001;
      `;
      closeBtn.addEventListener("click", () => modal.remove());

      const gallery = document.createElement("div");
      gallery.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 20px;
        max-width: 1200px;
        margin-top: 60px;
      `;

      data.snapshots.forEach((snapshot) => {
        const imgContainer = document.createElement("div");
        imgContainer.style.cssText = `
          background: white;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        `;

        const img = document.createElement("img");
        img.src = snapshot.url;
        img.alt = snapshot.name;
        img.style.cssText = `
          width: 100%;
          height: auto;
          display: block;
        `;

        const caption = document.createElement("div");
        caption.textContent = new Date(snapshot.timestamp).toLocaleString();
        caption.style.cssText = `
          padding: 10px;
          background: #1e293b;
          color: white;
          text-align: center;
          font-size: 14px;
        `;

        imgContainer.appendChild(img);
        imgContainer.appendChild(caption);
        gallery.appendChild(imgContainer);
      });

      modal.appendChild(closeBtn);
      modal.appendChild(gallery);
      document.body.appendChild(modal);
    } catch (e) {
      console.error("Error opening gallery:", e);
      showAlert("Failed to load gallery", "error");
    }
  }

  function showAlert(message, type = "info") {
    const banner = el("alert-banner");
    const text = el("alert-banner-text");
    const resolvedMessage = String(message || "");
    if (banner && text) {
      if (isBannerSuppressed(resolvedMessage)) return;

      text.textContent = resolvedMessage;
      banner.className = `alert-banner alert-${type}`;
      banner.hidden = false;

      setTimeout(() => {
        banner.hidden = true;
      }, 5000);
    }
  }

  function init() {
    updateMetrics();
    updateSystemStatus();
    updateFilterHealth();
    loadAIAlerts();
    loadCameraInventorySummary();
    bindControls();
    bindInventory();
    bindSettings();
    bindEnvTrendTooltip();
    bindTimeRangeButtons();
    bindExportButtons();
    bindProduceControls();
    bindInventoryControls();
    loadInventory();
    loadLatestSnapshot(); // Load initial snapshot
    loadHistoricalTrend(currentTimeRange);

    // Initialize offline/online detection
    setupOfflineDetection();
    setupInferenceHealth();

    setInterval(() => {
      updateMetrics();
      updateFilterHealth();
    }, 5000);

    setInterval(() => {
      loadLatestSnapshot(); // Auto-refresh latest interval snapshot
      loadAIAlerts();
      loadCameraInventorySummary();
      updateInferenceHealthStatus();
      loadHistoricalTrend(currentTimeRange);
    }, 30000);
    // Header nav removed; scrolling handled by section anchor links in-page.
    if (!location.hash) {
      location.hash = "#dashboard";
    }
    syncSidebarActiveLink();
    window.addEventListener("hashchange", syncSidebarActiveLink);
    // If a section anchor is present, scroll to it
    ["camera", "controls"].forEach((id) => {
      if (location.hash === `#${id}`) {
        const anchor = document.getElementById(id);
        if (anchor)
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // Offline/Online Detection and Auto-Refresh
  let lastDataUpdateTime = Date.now();
  let isCurrentlyOffline = false;

  function setInferenceChipState(
    text,
    stateClass = "status-indicator--neutral",
  ) {
    const chip = document.getElementById("header-inference-text");
    if (!chip) return;
    chip.textContent = text;
    chip.className = `status-indicator ${stateClass}`;
  }

  async function updateInferenceHealthStatus() {
    if (!navigator.onLine) {
      setInferenceChipState("Inference: offline", "status-indicator--error");
      return;
    }

    try {
      const res = await fetch("/api/inference-health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const provider = String(data?.provider || "unknown");
      const ready = Boolean(data?.ready);
      if (ready) {
        setInferenceChipState(
          `Inference: ${provider} ready`,
          "status-indicator",
        );
      } else {
        setInferenceChipState(
          `Inference: ${provider} not ready`,
          "status-indicator--warning",
        );
      }
    } catch (error) {
      setInferenceChipState(
        "Inference: unavailable",
        "status-indicator--error",
      );
    }
  }

  function setupInferenceHealth() {
    updateInferenceHealthStatus();
  }

  function setupOfflineDetection() {
    // Only update header status - no separate banner
    const headerStatusText = document.getElementById("header-status-text");
    const headerLastUpdated = document.getElementById("header-last-updated");

    // Update "last updated" timestamp every second
    setInterval(() => {
      const secondsAgo = Math.floor((Date.now() - lastDataUpdateTime) / 1000);
      let timeText;
      if (secondsAgo < 5) {
        timeText = `Updated just now`;
      } else if (secondsAgo < 60) {
        timeText = `Updated ${secondsAgo}s ago`;
      } else if (secondsAgo < 3600) {
        const minutesAgo = Math.floor(secondsAgo / 60);
        timeText = `Updated ${minutesAgo}m ago`;
      } else {
        const hoursAgo = Math.floor(secondsAgo / 3600);
        timeText = `Updated ${hoursAgo}h ago`;
      }

      if (headerLastUpdated) headerLastUpdated.textContent = timeText;
    }, 1000);

    // Listen for online/offline events
    window.addEventListener("offline", () => {
      isCurrentlyOffline = true;
      if (headerStatusText) {
        headerStatusText.textContent = "Offline";
      }
      console.log("Connection lost - offline mode");
    });

    window.addEventListener("online", () => {
      isCurrentlyOffline = false;
      if (headerStatusText) {
        headerStatusText.textContent = "Connected";
      }
      console.log("Connection restored - fetching fresh data");

      // Auto-refresh data when coming back online
      setTimeout(() => {
        updateMetrics();
        updateFilterHealth();
        loadLatestSnapshot();
        updateInferenceHealthStatus();
      }, 500);
    });

    // Check initial state
    if (!navigator.onLine) {
      isCurrentlyOffline = true;
      if (statusBanner) {
        statusBanner.classList.add("offline");
      }
      if (statusIndicator) {
        statusIndicator.textContent = "Offline - showing cached data";
      }
    }
  }

  // Intercept fetch to update lastDataUpdateTime
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch
      .apply(this, args)
      .then((response) => {
        // If successful API call, update timestamp
        if (response.ok && args[0] && args[0].includes("/api/")) {
          lastDataUpdateTime = Date.now();
        }
        return response;
      })
      .catch((error) => {
        // Network error - likely offline
        console.warn("Fetch error (possibly offline):", error);
        throw error;
      });
  };

  document.addEventListener("DOMContentLoaded", init);
})();
