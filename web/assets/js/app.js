// Mock live data updates and simple UI interactions
(function () {
  const fmt = (n) => (typeof n === "number" ? n.toFixed(1) : "--");
  const fmtPrecise = (n) => (typeof n === "number" ? n.toFixed(3) : "--");
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
    ethylene: { max: 0.1 },
  };
  const MAX_POINTS = 50;
  let currentTimeRange = "24h"; // Default time range

  async function fetchMetrics() {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      // Expected shape:
      // {
      //   temperature: { value: Number },
      //   humidity: { value: Number },
      //   ethylene: { value: Number },
      //   vocs: { value: Number },
      //   timestamp: ISOString
      // }
      return {
        temp: Number(data?.temperature?.value),
        humidity: Number(data?.humidity?.value),
        ethylene: Number(data?.ethylene?.value),
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
      allSeries.ethylene.length
    );
    if (maxLen < 2) return;

    // Fixed axis ranges - separate axes for temperature and ethylene
    const tempMin = 0;
    const tempMax = 30; // Temperature °C
    const ethMin = 0;
    const ethMax = 0.2; // Ethylene ppm (0-0.2 range to show 0.01-0.15 variations)
    const humMin = 0;
    const humMax = 100; // Humidity %
    const tempRange = tempMax - tempMin || 1;
    const ethRange = ethMax - ethMin || 1;
    const humRange = humMax - humMin || 1;

    // gridlines
    canvasCtx.strokeStyle = "#e5e7eb";
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

    // axes
    canvasCtx.strokeStyle = "#cbd5e1";
    canvasCtx.lineWidth = 1.5;
    canvasCtx.beginPath();
    canvasCtx.moveTo(PAD, h - PAD);
    canvasCtx.lineTo(w - PAD, h - PAD);
    canvasCtx.moveTo(PAD, PAD);
    canvasCtx.lineTo(PAD, h - PAD);
    canvasCtx.moveTo(w - PAD, PAD);
    canvasCtx.lineTo(w - PAD, h - PAD);
    canvasCtx.stroke();

    // labels (Y-left temp, Y-left2 ethylene, Y-right humidity, X time)
    canvasCtx.fillStyle = "#6b7280";
    canvasCtx.font = "12px Inter, Arial, sans-serif";

    // Left axis labels (Temperature) - in red
    canvasCtx.fillStyle = "#ef4444";
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      const tv = tempMax - (i / gridRows) * tempRange;
      canvasCtx.fillText(tv.toFixed(1), 4, y + 4);
    }

    // Left axis labels for Ethylene - in orange, offset to right
    canvasCtx.fillStyle = "#f59e0b";
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      const ev = ethMax - (i / gridRows) * ethRange;
      canvasCtx.fillText(ev.toFixed(2), 46, y + 4);
    }

    // Right axis labels (Humidity) - in blue
    canvasCtx.fillStyle = "#0ea5e9";
    for (let i = 0; i <= gridRows; i++) {
      const y = PAD + (i / gridRows) * (h - PAD * 2);
      const hv = humMax - (i / gridRows) * humRange;
      const hlabel = hv.toFixed(0) + "%";
      const tw = canvasCtx.measureText(hlabel).width;
      canvasCtx.fillText(hlabel, w - PAD - tw - 4, y + 4);
    }

    // X-axis time labels
    canvasCtx.fillStyle = "#6b7280";
    const times = allSeries.times;
    if (times && times.length > 1) {
      const first = times[0];
      const last = times[times.length - 1];
      const spanMs = last - first;
      function fmtTime(t) {
        const dt = new Date(t);
        const day = 24 * 60 * 60 * 1000;
        const month = 30 * day;
        if (spanMs < day) {
          return dt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
        } else if (spanMs < month) {
          return dt.toLocaleDateString([], { month: "short", day: "numeric" });
        } else {
          return dt.toLocaleDateString([], { year: "numeric", month: "short" });
        }
      }
      for (let j = 0; j <= gridCols; j++) {
        const idx = Math.round((j / gridCols) * (times.length - 1));
        const x = PAD + (idx / (times.length - 1)) * (w - PAD * 2);
        const label = fmtTime(times[idx]);
        const tw = canvasCtx.measureText(label).width;
        canvasCtx.fillText(label, x - tw / 2, h - PAD + 16);
      }
    }

    // Axis titles
    canvasCtx.font = "13px Inter, Arial, sans-serif";
    // Left axis title (Temperature) - red
    canvasCtx.fillStyle = "#ef4444";
    canvasCtx.fillText("Temp (°C)", PAD + 6, PAD - 8);
    // Left axis title (Ethylene) - orange, offset
    canvasCtx.fillStyle = "#f59e0b";
    canvasCtx.fillText("Ethylene (ppm)", PAD + 90, PAD - 8);
    // Right axis title (Humidity) - blue
    canvasCtx.fillStyle = "#0ea5e9";
    const rightTitle = "Humidity (%)";
    const rtw = canvasCtx.measureText(rightTitle).width;
    canvasCtx.fillText(rightTitle, w - PAD - rtw - 6, PAD - 8);

    const lines = [
      { data: allSeries.temp, color: "#ef4444", width: 2.5, axis: "temp" },
      {
        data: allSeries.humidity,
        color: "#0ea5e9",
        width: 2.5,
        axis: "humidity",
      },
      {
        data: allSeries.ethylene,
        color: "#f59e0b",
        width: 2.5,
        axis: "ethylene",
      },
    ];

    lines.forEach((line) => {
      const { data, color, width, axis } = line;
      if (data.length < 2) return;
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
        } else if (axis === "ethylene") {
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
        series.ethylene.length
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
        <div><span style="color:#ef4444">●</span> Temperature: <strong>${fmt(
          item.temp
        )} °C</strong></div>
        <div><span style="color:#0ea5e9">●</span> Humidity: <strong>${fmt(
          item.humidity
        )} %</strong></div>
        <div><span style="color:#f59e0b">●</span> Ethylene/VOCs: <strong>${fmtPrecise(
          item.ethylene
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
    const fetched = await fetchMetrics();
    let temp, humidity, ethylene, tstamp;
    if (
      fetched &&
      ["temp", "humidity", "ethylene"].every(
        (k) => typeof fetched[k] === "number" && !Number.isNaN(fetched[k])
      )
    ) {
      temp = fetched.temp;
      humidity = fetched.humidity;
      ethylene = fetched.ethylene;
      tstamp = Date.now();
    } else {
      temp = 3 + Math.random() * 3.5;
      humidity = 85 + Math.random() * 8;
      ethylene = 0.01 + Math.random() * 0.14;
      tstamp = Date.now();
    }

    el("temp-value").textContent = fmt(temp);
    el("humidity-value").textContent = fmt(humidity);
    el("ethylene-value").textContent = fmtPrecise(ethylene);

    // Update indicator bars
    // Temperature: 0-15°C range
    const tempPercent = Math.max(0, Math.min(100, (temp / 15) * 100));
    el("temp-bar").style.width = tempPercent + "%";

    // Humidity: 0-100% range
    const humidityPercent = Math.max(0, Math.min(100, humidity));
    el("humidity-bar").style.width = humidityPercent + "%";

    // Ethylene: 0-0.2 ppm range (display range)
    const ethylenePercent = Math.max(0, Math.min(100, (ethylene / 0.2) * 100));
    el("ethylene-bar").style.width = ethylenePercent + "%";

    // push data
    const push = (arr, v) => {
      arr.push(v);
      if (arr.length > MAX_POINTS) arr.shift();
    };
    push(series.temp, temp);
    push(series.humidity, humidity);
    push(series.ethylene, ethylene);
    push(series.times, tstamp);

    // draw sparks
    drawSpark(ctx("temp-chart"), series.temp, "#ef4444");
    drawSpark(ctx("humidity-chart"), series.humidity, "#0ea5e9");
    drawSpark(ctx("ethylene-chart"), series.ethylene, "#f59e0b");

    drawEnvTrend(ctx("env-trend"), series);
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
    el("ethylene-min").textContent = fmtPrecise(sEth.min);
    el("ethylene-avg").textContent = fmtPrecise(sEth.avg);
    el("ethylene-max").textContent = fmtPrecise(sEth.max);

    const alertList = el("alert-list");
    alertList.innerHTML = "";
    const alerts = [];
    if (temp > targets.temp.max + 0.5)
      alerts.push({
        type: "warn",
        text: "Temperature is rising above target.",
      });
    if (humidity < targets.humidity.min - 3)
      alerts.push({ type: "warn", text: "Humidity is dropping below target." });
    if (ethylene > targets.ethylene.max - 0.02) {
      alerts.push({
        type: "err",
        text: "Ethylene concentration high — air filter activated automatically.",
      });
      // Auto-activate scrubber when ethylene is high
      if (systemStatus.scrubber !== "active") {
        systemStatus.scrubber = "active";
        updateSystemStatus();
      }
    } else {
      // Auto-deactivate when ethylene is normal
      if (
        systemStatus.scrubber === "active" &&
        ethylene < targets.ethylene.max - 0.04
      ) {
        systemStatus.scrubber = "standby";
        updateSystemStatus();
      }
    }

    // Update alert banner at top for important alerts
    const banner = document.getElementById("alert-banner");
    const bannerText = document.getElementById("alert-banner-text");
    if (alerts.length === 0) {
      const li = document.createElement("li");
      li.className = "alert-item ok";
      li.textContent = "No active alerts";
      alertList.appendChild(li);
      if (banner) banner.hidden = true;
    } else {
      alerts.forEach((a) => {
        const li = document.createElement("li");
        li.className = `alert-item ${a.type}`;
        li.textContent = a.text;
        alertList.appendChild(li);
      });
      // Pick the most severe alert to show in banner
      const priorityOrder = { err: 3, warn: 2, ok: 1 };
      const topAlert = alerts.sort(
        (a, b) => (priorityOrder[b.type] || 0) - (priorityOrder[a.type] || 0)
      )[0];
      if (banner && bannerText && topAlert) {
        bannerText.textContent = topAlert.text;
        banner.hidden = false;
        // adjust banner color based on type
        if (topAlert.type === "err") {
          banner.style.background = "#fee2e2";
          banner.style.color = "#7f1d1d";
          banner.style.borderTopColor = "#fecaca";
          banner.style.borderBottomColor = "#fecaca";
        } else if (topAlert.type === "warn") {
          banner.style.background = "#fef3c7";
          banner.style.color = "#78350f";
          banner.style.borderTopColor = "#fde68a";
          banner.style.borderBottomColor = "#fde68a";
        } else {
          banner.style.background = "#dcfce7";
          banner.style.color = "#064e3b";
          banner.style.borderTopColor = "#bbf7d0";
          banner.style.borderBottomColor = "#bbf7d0";
        }
        // auto-hide after 10 seconds
        clearTimeout(window.__alertBannerTimer);
        window.__alertBannerTimer = setTimeout(() => {
          banner.hidden = true;
        }, 10000);
        // dismiss button
        const dismissBtn = document.getElementById("alert-banner-dismiss");
        if (dismissBtn && !dismissBtn.__bound) {
          dismissBtn.addEventListener("click", () => {
            banner.hidden = true;
            clearTimeout(window.__alertBannerTimer);
          });
          dismissBtn.__bound = true;
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
    const statusMap = {
      active: { text: "Active", class: "active" },
      standby: { text: "Standby", class: "standby" },
      offline: { text: "Offline", class: "offline" },
    };

    ["cooling", "humidifier", "scrubber", "camera"].forEach((component) => {
      const statusEl = el(`${component}-status`);
      if (statusEl) {
        const status = statusMap[systemStatus[component]] || statusMap.standby;
        statusEl.innerHTML = `<span class="status-badge ${status.class}">${status.text}</span>`;
      }
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
        kmno4Bar.style.background = "linear-gradient(90deg, #ef4444, #f87171)";
      } else if (kmno4Health < 50) {
        kmno4Bar.style.background = "linear-gradient(90deg, #f59e0b, #fbbf24)";
      } else {
        kmno4Bar.style.background = "linear-gradient(90deg, #0ea5e9, #38bdf8)";
      }
    }
  }

  function bindControls() {
    const notify = (msg) => {
      const li = document.createElement("li");
      li.className = "alert-item ok";
      li.textContent = msg;
      el("alert-list").prepend(li);
    };

    // Toggle switches
    const coolingToggle = el("cooling-toggle");
    const humidifierToggle = el("humidifier-toggle");
    const scrubberToggle = el("scrubber-toggle");

    if (coolingToggle) {
      coolingToggle.addEventListener("change", (e) => {
        systemStatus.cooling = e.target.checked ? "active" : "standby";
        el("cooling-status-text").textContent = e.target.checked
          ? "Active"
          : "Standby";
        updateSystemStatus();
        notify(e.target.checked ? "Cooling activated" : "Cooling deactivated");
      });
    }

    if (humidifierToggle) {
      humidifierToggle.addEventListener("change", (e) => {
        systemStatus.humidifier = e.target.checked ? "active" : "standby";
        el("humidifier-status-text").textContent = e.target.checked
          ? "Active"
          : "Standby";
        updateSystemStatus();
        notify(
          e.target.checked ? "Humidifier activated" : "Humidifier deactivated"
        );
      });
    }

    if (scrubberToggle) {
      scrubberToggle.addEventListener("change", (e) => {
        systemStatus.scrubber = e.target.checked ? "active" : "standby";
        el("scrubber-status-text").textContent = e.target.checked
          ? "Active"
          : "Standby";
        updateSystemStatus();
        notify(
          e.target.checked ? "Scrubber activated" : "Scrubber deactivated"
        );
      });
    }

    // Camera actions
    const refreshBtn = el("refresh-snapshot");
    const galleryBtn = el("open-gallery");
    if (refreshBtn)
      refreshBtn.addEventListener("click", () => notify("Snapshot refreshed"));
    if (galleryBtn)
      galleryBtn.addEventListener("click", () => notify("Gallery opened"));
  }

  // Inventory sample data and rendering
  const inventory = [
    {
      item: "Apples",
      variety: "Red Delicious",
      qty: 24,
      unit: "units",
      shelf: 3,
      status: "critical",
      snapshot: "assets/img/placeholder-produce.jpg",
    },
    {
      item: "Lettuce",
      variety: "Iceberg",
      qty: 12,
      unit: "heads",
      shelf: 5,
      status: "warning",
      snapshot: "assets/img/placeholder-produce.jpg",
    },
    {
      item: "Carrots",
      variety: "Organic",
      qty: 36,
      unit: "units",
      shelf: 12,
      status: "good",
      snapshot: "assets/img/placeholder-produce.jpg",
    },
    {
      item: "Bananas",
      variety: "Cavendish",
      qty: 18,
      unit: "units",
      shelf: 8,
      status: "good",
      snapshot: "assets/img/placeholder-produce.jpg",
    },
    {
      item: "Tomatoes",
      variety: "Cherry",
      qty: 28,
      unit: "units",
      shelf: 6,
      status: "good",
      snapshot: "assets/img/placeholder-produce.jpg",
    },
  ];

  // AI Alerts data
  const aiAlerts = [
    {
      id: 1,
      icon: "🍎",
      title: "Apples",
      message:
        "AI detected overripening in 3 apples. Recommend immediate removal.",
      severity: "high",
      actions: [
        { label: "Remove", type: "primary" },
        { label: "Details", type: "secondary" },
      ],
    },
    {
      id: 2,
      icon: "🥬",
      title: "Lettuce",
      message: "Early browning detected on outer leaves. Monitor closely.",
      severity: "medium",
      actions: [
        { label: "Schedule", type: "primary" },
        { label: "Image", type: "secondary" },
      ],
    },
    {
      id: 3,
      icon: "🥕",
      title: "Carrots",
      message: "All items optimal. Remaining time: 12 days.",
      severity: "good",
      actions: [],
    },
  ];

  function renderAIAlerts() {
    const container = document.getElementById("ai-alerts-list");
    const countBadge = document.getElementById("alert-count");
    if (!container) return;

    const activeCount = aiAlerts.filter(
      (a) => a.severity === "high" || a.severity === "medium"
    ).length;
    if (countBadge) {
      countBadge.textContent = `${activeCount} Active`;
      countBadge.style.background = activeCount > 0 ? "#ef4444" : "#22c55e";
    }

    container.innerHTML = "";
    aiAlerts.forEach((alert) => {
      const card = document.createElement("div");
      card.className = `ai-alert-card ${alert.severity}`;

      const actionsHTML =
        alert.actions.length > 0
          ? `<div class="ai-alert-actions">
            ${alert.actions
              .map(
                (action) =>
                  `<button class="ai-alert-btn ${action.type}">${action.label}</button>`
              )
              .join("")}
           </div>`
          : "";

      card.innerHTML = `
        <div class="ai-alert-icon">${alert.icon}</div>
        <div class="ai-alert-content">
          <div class="ai-alert-header">
            <h3 class="ai-alert-title">${alert.title}</h3>
            <span class="ai-alert-severity ${alert.severity}">${alert.severity}</span>
          </div>
          <p class="ai-alert-message">${alert.message}</p>
          ${actionsHTML}
        </div>
      `;
      container.appendChild(card);
    });

    // Bind button actions
    container.querySelectorAll(".ai-alert-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const action = e.target.textContent;
        alert(
          `Action "${action}" triggered. This would connect to backend API.`
        );
      });
    });
  }

  function renderInventory(list) {
    const tbody = el("inv-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    list.forEach((r) => {
      const tr = document.createElement("tr");
      const statusColor = "#f3f4f6";
      const statusTextColor = "#374151";
      const statusText =
        r.status === "critical"
          ? `${r.shelf} days left`
          : r.status === "warning"
          ? `${r.shelf} days left`
          : `${r.shelf} days left`;
      tr.innerHTML = `
        <td><strong>${r.item}</strong></td>
        <td>${r.variety}</td>
        <td>${r.qty} ${r.unit}</td>
        <td style="color: ${
          r.status === "critical"
            ? "#dc2626"
            : r.status === "warning"
            ? "#ca8a04"
            : "#16a34a"
        }; font-weight: 600;">${statusText}</td>
        <td style="color: #374151; font-weight: 500; text-transform: capitalize;">${
          r.status
        }</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function bindInventory() {
    const search = document.getElementById("inv-search");
    const filter = document.getElementById("inv-filter");
    const addBtn = document.getElementById("add-items-btn");

    if (!search || !filter) return;

    if (addBtn) {
      addBtn.addEventListener("click", () => {
        alert(
          "Add Items feature - would open a form to add new inventory items."
        );
      });
    }

    function apply() {
      const q = (search.value || "").toLowerCase();
      const f = filter.value || "all";
      const out = inventory.filter(
        (r) =>
          (f === "all" || r.status === f) &&
          (q === "" ||
            r.item.toLowerCase().includes(q) ||
            r.variety.toLowerCase().includes(q))
      );
      renderInventory(out);
    }
    search.addEventListener("input", apply);
    filter.addEventListener("change", apply);
    apply();
  }

  function bindTimeRangeButtons() {
    const buttons = document.querySelectorAll(".time-range-btn");
    if (!buttons.length) return;

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        // Update active state
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // Get selected range
        currentTimeRange = btn.getAttribute("data-range");

        // In a real implementation, this would fetch historical data from backend
        // For now, we'll just show a message
        console.log(`Time range changed to: ${currentTimeRange}`);

        // TODO: Fetch data based on time range
        // Example API call structure:
        // fetchHistoricalData(currentTimeRange).then(data => {
        //   series.temp = data.temp;
        //   series.humidity = data.humidity;
        //   series.ethylene = data.ethylene;
        //   series.vocs = data.vocs;
        //   series.times = data.times;
        //   drawEnvTrend(ctx("env-trend"), series);
        // });

        // For demo purposes, show alert
        alert(
          `Time range set to ${currentTimeRange.toUpperCase()}. In production, this would load historical data from the backend API.`
        );
      });
    });
  }

  function init() {
    updateMetrics();
    updateSystemStatus();
    updateFilterHealth();
    renderAIAlerts();
    bindControls();
    bindInventory();
    bindEnvTrendTooltip();
    bindTimeRangeButtons();
    setInterval(() => {
      updateMetrics();
      updateFilterHealth();
    }, 5000);
    // Header nav removed; scrolling handled by section anchor links in-page.
    if (!location.hash) {
      location.hash = "#dashboard";
    }
    // If a section anchor is present, scroll to it
    ["camera", "alerts", "controls"].forEach((id) => {
      if (location.hash === `#${id}`) {
        const anchor = document.getElementById(id);
        if (anchor)
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
