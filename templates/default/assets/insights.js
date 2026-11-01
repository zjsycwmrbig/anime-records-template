(() => {
  const tabs = [...document.querySelectorAll("[data-insights-tab]")];
  const panels = [...document.querySelectorAll("[data-insights-panel]")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const target = tab.dataset.insightsTab;
      for (const candidate of tabs) {
        const active = candidate === tab;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-selected", String(active));
      }
      for (const panel of panels) {
        const active = panel.dataset.insightsPanel === target;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
      }
    });
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next]?.focus();
      tabs[next]?.click();
    });
  }

  for (const carousel of document.querySelectorAll("[data-carousel]")) {
    const slides = [...carousel.querySelectorAll("[data-carousel-slide]")];
    if (!slides.length) {
      continue;
    }
    const status = carousel.querySelector("[data-carousel-status]");
    const previous = carousel.querySelector("[data-carousel-prev]");
    const next = carousel.querySelector("[data-carousel-next]");
    const subtabs = document.createElement("div");
    subtabs.className = "insight-subtabs";
    subtabs.setAttribute("role", "tablist");
    subtabs.setAttribute("aria-label", "当前模块快捷视图");
    const subtabsByIndex = [];
    slides.forEach((slide, slideIndex) => {
      const label = slide.getAttribute("aria-label") || `视图 ${slideIndex + 1}`;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "insight-subtab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", "false");
      tab.textContent = label;
      tab.addEventListener("click", () => showSlide(slideIndex));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? slides.length - 1
              : (slideIndex +
                  (event.key === "ArrowRight" ? 1 : -1) +
                  slides.length) %
                slides.length;
        subtabsByIndex[nextIndex]?.focus();
        showSlide(nextIndex);
      });
      subtabs.append(tab);
      subtabsByIndex.push(tab);
    });
    carousel.querySelector(".carousel-toolbar")?.after(subtabs);
    let activeIndex = 0;
    const showSlide = (index) => {
      activeIndex = (index + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => {
        const active = slideIndex === activeIndex;
        slide.classList.toggle("is-active", active);
        slide.hidden = !active;
      });
      subtabsByIndex.forEach((tab, tabIndex) => {
        const active = tabIndex === activeIndex;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      if (status) status.textContent = `${activeIndex + 1} / ${slides.length}`;
    };
    previous?.addEventListener("click", () => showSlide(activeIndex - 1));
    next?.addEventListener("click", () => showSlide(activeIndex + 1));
    showSlide(0);
  }

  for (const figure of document.querySelectorAll("[data-interactive-pie]")) {
    const pie = figure.querySelector(".year-pie");
    const tooltip = figure.querySelector(".pie-tooltip");
    const legend = figure.parentElement?.querySelector(".pie-legend");
    const segments = [...(legend?.querySelectorAll("[data-pie-segment]") ?? [])];
    if (!pie || !tooltip || !segments.length) {
      continue;
    }

    const clearActive = () => {
      tooltip.hidden = true;
      for (const segment of segments) {
        segment.classList.remove("is-active");
      }
    };

    const showSegment = (segment, left, top) => {
      for (const candidate of segments) {
        candidate.classList.toggle("is-active", candidate === segment);
      }
      tooltip.textContent =
        `${segment.dataset.label} · ${segment.dataset.count} 部 · ${segment.dataset.percent}%`;
      tooltip.hidden = false;
      const maximumLeft = Math.max(12, figure.clientWidth - tooltip.offsetWidth - 12);
      const maximumTop = Math.max(12, figure.clientHeight - tooltip.offsetHeight - 12);
      tooltip.style.left = `${Math.max(12, Math.min(maximumLeft, left))}px`;
      tooltip.style.top = `${Math.max(12, Math.min(maximumTop, top))}px`;
    };

    pie.addEventListener("pointermove", (event) => {
      const bounds = figure.getBoundingClientRect();
      const x = event.clientX - bounds.left - bounds.width / 2;
      const y = event.clientY - bounds.top - bounds.height / 2;
      if (Math.hypot(x, y) < bounds.width * 0.28) {
        clearActive();
        return;
      }
      const degrees = (Math.atan2(y, x) * 180) / Math.PI;
      const percent = ((degrees + 450) % 360) / 3.6;
      const segment =
        segments.find(
          (candidate) =>
            percent >= Number(candidate.dataset.start) &&
            percent < Number(candidate.dataset.end),
        ) ?? segments.at(-1);
      showSegment(
        segment,
        event.clientX - bounds.left + 12,
        event.clientY - bounds.top + 12,
      );
    });
    pie.addEventListener("pointerdown", (event) => {
      pie.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: event.clientX,
          clientY: event.clientY,
          bubbles: true,
        }),
      );
    });
    pie.addEventListener("pointerleave", clearActive);
    for (const segment of segments) {
      segment.addEventListener("focus", () => {
        showSegment(segment, figure.clientWidth / 2 - 70, 20);
      });
      segment.addEventListener("blur", clearActive);
    }
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const createSvgElement = (name, attributes = {}) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      node.setAttribute(key, String(value));
    }
    return node;
  };

  for (const figure of document.querySelectorAll("[data-tag-radar]")) {
    const host = figure.querySelector("[data-tag-radar-svg]");
    const tooltip = figure.querySelector("[data-tag-radar-tooltip]");
    const layout = figure.closest(".tag-radar-layout");
    const legendRows = [
      ...(layout?.querySelectorAll("[data-tag-radar-legend]") ?? []),
    ];
    if (!host || !tooltip || legendRows.length < 3) {
      continue;
    }

    const axes = legendRows
      .map((row, rowIndex) => ({
        index: Math.max(0, Number(row.dataset.tagIndex) || rowIndex),
        label:
          row.dataset.tagLabel ||
          row.textContent.trim() ||
          `标签 ${rowIndex + 1}`,
        count: Math.max(0, Number(row.dataset.tagCount) || 0),
        percent: Math.max(
          0,
          Math.min(100, Number(row.dataset.tagPercent) || 0),
        ),
        row,
      }))
      .sort((left, right) => left.index - right.index)
      .map((axis, index) => ({
        ...axis,
        index,
      }));
    const width = 560;
    const height = 430;
    const centerX = width / 2;
    const centerY = height / 2 + 4;
    const radius = 142;
    const labelRadius = 177;
    const step = (Math.PI * 2) / axes.length;
    const pointAt = (index, ratio) => {
      const angle = -Math.PI / 2 + index * step;
      return {
        x: centerX + Math.cos(angle) * radius * ratio,
        y: centerY + Math.sin(angle) * radius * ratio,
      };
    };
    const polygonPoints = (ratioForAxis) =>
      axes
        .map((axis) => {
          const point = pointAt(axis.index, ratioForAxis(axis));
          return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
        })
        .join(" ");

    const svg = createSvgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "group",
      "aria-label": "番剧标签偏好多边形图",
    });
    const title = createSvgElement("title");
    title.textContent = `标签偏好多边形图，共 ${axes.length} 个标签`;
    svg.append(title);

    for (let level = 1; level <= 4; level += 1) {
      svg.append(
        createSvgElement("polygon", {
          class: `tag-radar-ring${level === 4 ? " is-outer" : ""}`,
          points: polygonPoints(() => level / 4),
        }),
      );
    }

    const spokes = [];
    const labels = [];
    for (const axis of axes) {
      const edge = pointAt(axis.index, 1);
      const angle = -Math.PI / 2 + axis.index * step;
      const labelPoint = {
        x: centerX + Math.cos(angle) * labelRadius,
        y: centerY + Math.sin(angle) * labelRadius,
      };
      const spoke = createSvgElement("line", {
        class: "tag-radar-spoke",
        x1: centerX,
        y1: centerY,
        x2: edge.x,
        y2: edge.y,
      });
      const label = createSvgElement("text", {
        class: "tag-radar-axis-label",
        x: labelPoint.x,
        y: labelPoint.y,
        "text-anchor":
          labelPoint.x < centerX - 8
            ? "end"
            : labelPoint.x > centerX + 8
              ? "start"
              : "middle",
        "dominant-baseline":
          labelPoint.y < centerY - 8
            ? "auto"
            : labelPoint.y > centerY + 8
              ? "hanging"
              : "middle",
      });
      const visibleLabel =
        [...axis.label].length > 12
          ? `${[...axis.label].slice(0, 11).join("")}…`
          : axis.label;
      label.textContent = visibleLabel;
      svg.append(spoke, label);
      spokes.push(spoke);
      labels.push(label);
    }

    const radarShape = createSvgElement("polygon", {
      class: "tag-radar-shape",
      points: polygonPoints((axis) => axis.percent / 100),
    });
    svg.append(radarShape);

    const points = axes.map((axis) => {
      const point = pointAt(axis.index, axis.percent / 100);
      const group = createSvgElement("g", {
        class: "tag-radar-point-target",
        tabindex: "0",
        role: "img",
        "aria-label": `${axis.label}，${axis.count} 部作品`,
      });
      const hitArea = createSvgElement("circle", {
        class: "tag-radar-point-hit",
        cx: point.x,
        cy: point.y,
        r: 15,
      });
      const dot = createSvgElement("circle", {
        class: "tag-radar-point",
        cx: point.x,
        cy: point.y,
        r: 5,
      });
      group.append(hitArea, dot);
      svg.append(group);
      return group;
    });

    host.replaceChildren(svg);
    let activeIndex = null;

    const setActive = (index) => {
      activeIndex = index;
      spokes.forEach((spoke, spokeIndex) =>
        spoke.classList.toggle("is-active", spokeIndex === index),
      );
      labels.forEach((label, labelIndex) =>
        label.classList.toggle("is-active", labelIndex === index),
      );
      points.forEach((point, pointIndex) =>
        point.classList.toggle("is-active", pointIndex === index),
      );
      axes.forEach((axis, axisIndex) =>
        axis.row.classList.toggle("is-active", axisIndex === index),
      );
    };

    const hideTooltip = () => {
      tooltip.hidden = true;
      setActive(null);
    };

    const showTooltip = (axis, clientX, clientY) => {
      setActive(axis.index);
      tooltip.textContent = `${axis.label} · ${axis.count} 部 · ${axis.percent}%`;
      tooltip.hidden = false;
      const bounds = figure.getBoundingClientRect();
      const preferredLeft =
        Number.isFinite(clientX) ? clientX - bounds.left + 14 : bounds.width / 2;
      const preferredTop =
        Number.isFinite(clientY) ? clientY - bounds.top + 14 : 24;
      const maximumLeft = Math.max(
        10,
        bounds.width - tooltip.offsetWidth - 10,
      );
      const maximumTop = Math.max(
        10,
        bounds.height - tooltip.offsetHeight - 10,
      );
      tooltip.style.left = `${Math.max(10, Math.min(maximumLeft, preferredLeft))}px`;
      tooltip.style.top = `${Math.max(10, Math.min(maximumTop, preferredTop))}px`;
    };

    const showFromElement = (axis, element) => {
      const bounds = element.getBoundingClientRect();
      showTooltip(axis, bounds.left + bounds.width / 2, bounds.top + 8);
    };

    axes.forEach((axis) => {
      const point = points[axis.index];
      point.addEventListener("pointerenter", (event) =>
        showTooltip(axis, event.clientX, event.clientY),
      );
      point.addEventListener("pointermove", (event) =>
        showTooltip(axis, event.clientX, event.clientY),
      );
      point.addEventListener("pointerleave", hideTooltip);
      point.addEventListener("focus", () => showFromElement(axis, point));
      point.addEventListener("blur", hideTooltip);
      axis.row.addEventListener("pointerenter", () =>
        showFromElement(axis, axis.row),
      );
      axis.row.addEventListener("focus", () =>
        showFromElement(axis, axis.row),
      );
      axis.row.addEventListener("pointerleave", hideTooltip);
      axis.row.addEventListener("blur", hideTooltip);
    });

    figure.addEventListener("pointerleave", () => {
      if (activeIndex !== null) {
        hideTooltip();
      }
    });
  }

  const yearDistribution = document.querySelector("#year-distribution");
  const yearMinInput = document.querySelector("#insights-year-min");
  const yearMaxInput = document.querySelector("#insights-year-max");
  const yearSort = document.querySelector("#insights-year-sort");
  const ratingFilter = document.querySelector("#insights-rating-filter");
  const filterSummary = document.querySelector("#insights-filter-summary");
  if (!yearDistribution || !yearMinInput || !yearMaxInput || !yearSort || !ratingFilter) return;
  const yearRows = [...yearDistribution.querySelectorAll(".distribution-row")];
  const fineRatings = [...document.querySelectorAll(".rating-fine-item")];
  const numberValue = (value) => {
    const number = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(number) ? number : null;
  };
  const applyInsightFilters = () => {
    const minimum = numberValue(yearMinInput.value);
    const maximum = numberValue(yearMaxInput.value);
    const visibleYears = yearRows.filter((row) => {
      const year = numberValue(row.dataset.year);
      const visible = year === null || ((minimum === null || year >= minimum) && (maximum === null || year <= maximum));
      row.hidden = !visible;
      return visible;
    });
    visibleYears.sort((left, right) => {
      const leftYear = numberValue(left.dataset.year) ?? -1;
      const rightYear = numberValue(right.dataset.year) ?? -1;
      const leftCount = numberValue(left.dataset.count) ?? 0;
      const rightCount = numberValue(right.dataset.count) ?? 0;
      const leftAverage = numberValue(left.dataset.average) ?? -1;
      const rightAverage = numberValue(right.dataset.average) ?? -1;
      if (yearSort.value === "count-desc") return rightCount - leftCount || rightYear - leftYear;
      if (yearSort.value === "average-desc") return rightAverage - leftAverage || rightYear - leftYear;
      return yearSort.value === "year-asc" ? leftYear - rightYear : rightYear - leftYear;
    });
    yearDistribution.append(...visibleYears);
    let visibleRatings = 0;
    for (const item of fineRatings) {
      const rating = numberValue(item.dataset.rating);
      const visible = ratingFilter.value === "all" || (ratingFilter.value === "high" && rating >= 8) || (ratingFilter.value === "mid" && rating >= 6 && rating < 8) || (ratingFilter.value === "low" && rating < 6);
      item.hidden = !visible;
      if (visible) visibleRatings += 1;
    }
    if (filterSummary) filterSummary.textContent = `显示 ${visibleYears.length} 个年份分组 · ${visibleRatings} 个评分档位`;
  };
  [yearMinInput, yearMaxInput].forEach((input) => input.addEventListener("change", applyInsightFilters));
  yearSort.addEventListener("change", applyInsightFilters);
  ratingFilter.addEventListener("change", applyInsightFilters);
  applyInsightFilters();
})();

(() => {
  const section = document.querySelector("#repository-compare");
  if (!section) {
    return;
  }

  const form = document.querySelector("#compareForm");
  const repositoryInput = document.querySelector("#peerRepository");
  const branchInput = document.querySelector("#peerBranch");
  const submitButton = document.querySelector("#compareSubmit");
  const shareButton = document.querySelector("#shareComparison");
  const status = document.querySelector("#compareStatus");
  const results = document.querySelector("#compareResults");
  const currentTotal = document.querySelector("#currentTotal");
  const currentAverage = document.querySelector("#currentAverage");
  const currentCoverage = document.querySelector("#currentCoverage");
  const peerTotal = document.querySelector("#peerTotal");
  const peerAverage = document.querySelector("#peerAverage");
  const peerCoverage = document.querySelector("#peerCoverage");
  const sharedTotal = document.querySelector("#sharedTotal");
  const overlapPercent = document.querySelector("#overlapPercent");
  const overlapBar = document.querySelector("#overlapBar");
  const sharedCount = document.querySelector("#sharedCount");
  const currentOnlyCount = document.querySelector("#currentOnlyCount");
  const peerOnlyCount = document.querySelector("#peerOnlyCount");
  const sharedList = document.querySelector("#sharedList");
  const currentOnlyList = document.querySelector("#currentOnlyList");
  const peerOnlyList = document.querySelector("#peerOnlyList");
  const ratingDifferenceList = document.querySelector("#ratingDifferenceList");
  const compareYears = document.querySelector("#compareYears");
  const compareRatings = document.querySelector("#compareRatings");
  const ownRepository = section.dataset.ownRepository.trim();
  const ownBranch = section.dataset.ownBranch.trim() || "main";
  const currentDataUrl = section.dataset.currentDataUrl;
  const storageKey = "anime-records:repository-peers";
  const maximumPayloadLength = 8 * 1024 * 1024;
  const listLimit = 12;
  const ratingDifferenceLimit = 10;
  let busy = false;

  function setStatus(message, state = "") {
    status.textContent = message;
    if (state) {
      status.dataset.state = state;
    } else {
      delete status.dataset.state;
    }
  }

  function normalizeRepository(value) {
    let candidate = String(value ?? "").trim();
    if (!candidate) {
      throw new Error("请输入对方 GitHub 仓库");
    }
    if (/^https?:\/\//iu.test(candidate)) {
      let parsed;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new Error("GitHub 仓库地址格式不正确");
      }
      if (!["github.com", "www.github.com"].includes(parsed.hostname.toLowerCase())) {
        throw new Error("只支持 github.com 仓库");
      }
      candidate = parsed.pathname;
    }
    candidate = candidate
      .replace(/^\/+|\/+$/gu, "")
      .replace(/\.git$/iu, "");
    const match = candidate.match(
      /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u,
    );
    if (
      !match ||
      match[1].length > 100 ||
      match[2].length > 100 ||
      [".", ".."].includes(match[1]) ||
      [".", ".."].includes(match[2])
    ) {
      throw new Error("仓库格式应为 owner/repository");
    }
    return `${match[1]}/${match[2]}`;
  }

  function normalizeBranch(value) {
    const branch = String(value ?? "").trim();
    const segments = branch.split("/");
    if (
      !branch ||
      branch.length > 200 ||
      !/^[A-Za-z0-9._/-]+$/u.test(branch) ||
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      segments.some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          segment.startsWith(".") ||
          segment.endsWith("."),
      )
    ) {
      throw new Error("分支名称格式不正确");
    }
    return branch;
  }

  function rawIndexUrl(repository, branch) {
    const [owner, repo] = repository.split("/").map(encodeURIComponent);
    const branchPath = branch.split("/").map(encodeURIComponent).join("/");
    return `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branchPath}/data/anime-index.jsonl`;
  }

  async function fetchText(url, label) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json, text/plain;q=0.9" },
    });
    if (!response.ok) {
      throw new Error(`${label}读取失败（HTTP ${response.status}）`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > maximumPayloadLength) {
      throw new Error(`${label}超过 8 MiB，已停止读取`);
    }
    const text = await response.text();
    if (text.length > maximumPayloadLength) {
      throw new Error(`${label}超过 8 MiB，已停止读取`);
    }
    return text;
  }

  async function loadCurrentItems() {
    const text = await fetchText(
      new URL(currentDataUrl, window.location.href),
      "当前档案",
    );
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("当前档案数据格式不正确");
    }
    if (!Array.isArray(payload.items)) {
      throw new Error("当前档案缺少 items 数组");
    }
    return payload.items.filter((item) => !item.deletedAt);
  }

  async function loadPeerItems(repository, branch) {
    const text = await fetchText(
      rawIndexUrl(repository, branch),
      "对方索引",
    );
    const items = [];
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let item;
      try {
        item = JSON.parse(trimmed);
      } catch {
        throw new Error(`对方索引第 ${index + 1} 行不是有效 JSON`);
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`对方索引第 ${index + 1} 行不是对象`);
      }
      if (!item.deletedAt) {
        items.push(item);
      }
    }
    return items;
  }

  function itemKeys(item) {
    const keys = new Set();
    if (item?.id) {
      keys.add(`id:${item.id}`);
    }
    for (const [source, id] of Object.entries(item?.externalIds ?? {})) {
      if (id) {
        keys.add(`${source}:${id}`);
      }
    }
    return [...keys];
  }

  function compactItem(item) {
    return {
      id: item.id,
      title: item.title || item.id || "未命名作品",
      rating:
        item.rating === null || item.rating === undefined
          ? null
          : Number(item.rating),
      season: item.season ?? null,
      externalIds: item.externalIds ?? {},
    };
  }

  function average(items) {
    const ratings = items
      .map((item) => item.rating)
      .filter((rating) => Number.isFinite(rating));
    if (!ratings.length) {
      return null;
    }
    return (
      Math.round(
        (ratings.reduce((total, rating) => total + rating, 0) / ratings.length) *
          10,
      ) / 10
    );
  }

  function distribution(items, keyFor, labelFor) {
    const groups = new Map();
    for (const item of items) {
      const key = keyFor(item);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => {
        if (left === null) return 1;
        if (right === null) return -1;
        return Number(right) - Number(left);
      })
      .map(([key, count]) => ({ key, label: labelFor(key), count }));
  }

  function profile(items) {
    const rated = items.filter((item) => Number.isFinite(item.rating)).length;
    const yearDistribution = distribution(
      items,
      (item) => {
        const year = Number(item.season?.year);
        return Number.isInteger(year) && year >= 1900 ? year : null;
      },
      (key) => key === null ? "年份未知" : String(key),
    );
    const ratingDistribution = distribution(
      items,
      (item) => {
        if (!Number.isFinite(item.rating)) return "unrated";
        if (item.rating < 6) return "0-5.9";
        if (item.rating < 7) return "6-6.9";
        if (item.rating < 8) return "7-7.9";
        if (item.rating < 9) return "8-8.9";
        return "9-10";
      },
      (key) => ({"0-5.9": "0 - 5.9", "6-6.9": "6 - 6.9", "7-7.9": "7 - 7.9", "8-8.9": "8 - 8.9", "9-10": "9 - 10", unrated: "未评分"}[key] || key),
    );
    return {
      total: items.length,
      rated,
      ratedPercent: items.length ? Math.round((rated / items.length) * 1000) / 10 : 0,
      averageRating: average(items),
      years: yearDistribution,
      ratings: ratingDistribution,
    };
  }

  function compareItems(currentItems, peerItems) {
    const current = currentItems
      .filter((item) => item && item.id)
      .map(compactItem);
    const peer = peerItems
      .filter((item) => item && item.id)
      .map(compactItem);
    const peerLookup = new Map();
    for (const item of peer) {
      for (const key of itemKeys(item)) {
        if (!peerLookup.has(key)) {
          peerLookup.set(key, item);
        }
      }
    }

    const matchedPeerIds = new Set();
    const shared = [];
    const currentOnly = [];
    for (const item of current) {
      const match = itemKeys(item)
        .map((key) => peerLookup.get(key))
        .find(
          (candidate) =>
            candidate && !matchedPeerIds.has(candidate.id),
        );
      if (!match) {
        currentOnly.push(item);
        continue;
      }
      matchedPeerIds.add(match.id);
      const ratingDifference =
        Number.isFinite(item.rating) && Number.isFinite(match.rating)
          ? Math.round((item.rating - match.rating) * 10) / 10
          : null;
      shared.push({
        ...item,
        peerTitle: match.title,
        peerRating: match.rating,
        ratingDifference,
      });
    }
    const peerOnly = peer.filter((item) => !matchedPeerIds.has(item.id));
    const unionSize = current.length + peerOnly.length;
    const ratingDifferences = shared
      .filter((item) => item.ratingDifference !== null)
      .sort(
        (left, right) =>
          Math.abs(right.ratingDifference) -
          Math.abs(left.ratingDifference),
      );

    return {
      current,
      peer,
      currentProfile: profile(current),
      peerProfile: profile(peer),
      shared,
      currentOnly,
      peerOnly,
      ratingDifferences,
      overlapPercent: unionSize
        ? Math.round((shared.length / unionSize) * 1000) / 10
        : 0,
    };
  }

  function seasonLabel(season) {
    return (
      season?.label ||
      (season?.number ? `第${season.number}季` : "") ||
      (season?.year ? String(season.year) : "")
    );
  }

  function ratingLabel(rating) {
    return Number.isFinite(rating) ? rating.toFixed(1) : "—";
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    return element;
  }

  function renderSimpleList(container, items, total, mode) {
    container.replaceChildren();
    for (const item of items.slice(0, listLimit)) {
      const row = document.createElement("div");
      row.className = "compare-item";
      row.append(createTextElement("strong", "", item.title));
      const meta = [
        seasonLabel(item.season),
        `评分 ${ratingLabel(item.rating)}`,
        mode === "shared"
          ? `对方 ${ratingLabel(item.peerRating)}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
      row.append(createTextElement("span", "", meta));
      container.append(row);
    }
    if (!items.length) {
      container.append(
        createTextElement("p", "compare-empty", "暂无作品"),
      );
    } else if (total > items.slice(0, listLimit).length) {
      container.append(
        createTextElement(
          "p",
          "compare-more",
          `另有 ${total - listLimit} 部未展开`,
        ),
      );
    }
  }

  function renderRatingDifferences(items) {
    ratingDifferenceList.replaceChildren();
    for (const item of items.slice(0, ratingDifferenceLimit)) {
      const row = document.createElement("div");
      row.className = "rating-difference-item";
      const copy = document.createElement("div");
      copy.append(createTextElement("strong", "", item.title));
      copy.append(
        createTextElement(
          "span",
          "",
          `当前 ${ratingLabel(item.rating)} · 对方 ${ratingLabel(item.peerRating)}`,
        ),
      );
      const difference = item.ratingDifference;
      const value = createTextElement(
        "span",
        `rating-difference-value ${
          difference > 0 ? "is-positive" : "is-negative"
        }`,
        `${difference > 0 ? "+" : ""}${difference.toFixed(1)}`,
      );
      row.append(copy, value);
      ratingDifferenceList.append(row);
    }
    if (!items.length) {
      ratingDifferenceList.append(
        createTextElement(
          "p",
          "compare-empty",
          "共同作品中还没有双方都已评分的条目",
        ),
      );
    }
  }

  function renderComparisonBars(container, currentItems, peerItems) {
    if (!container) return;
    container.replaceChildren();
    const keys = new Map();
    [...currentItems, ...peerItems].forEach((item) => keys.set(item.label, item));
    const maximum = Math.max(1, ...[...keys.keys()].map((label) => {
      const current = currentItems.find((item) => item.label === label)?.count || 0;
      const peer = peerItems.find((item) => item.label === label)?.count || 0;
      return Math.max(current, peer);
    }));
    for (const label of keys.keys()) {
      const current = currentItems.find((item) => item.label === label)?.count || 0;
      const peer = peerItems.find((item) => item.label === label)?.count || 0;
      const row = document.createElement("div");
      row.className = "compare-bar-row";
      row.append(createTextElement("strong", "compare-bar-label", label));
      for (const [name, value, className] of [["当前", current, "is-current"], ["对方", peer, "is-peer"]]) {
        const line = document.createElement("div");
        line.className = "compare-bar-line";
        const track = document.createElement("span");
        track.className = `compare-bar-track ${className}`;
        const fill = document.createElement("span");
        fill.style.width = `${(value / maximum) * 100}%`;
        track.append(fill);
        line.append(createTextElement("span", "compare-bar-name", name), track, createTextElement("strong", "compare-bar-value", String(value)));
        row.append(line);
      }
      container.append(row);
    }
  }

  function renderComparison(comparison) {
    currentTotal.textContent = comparison.currentProfile.total.toLocaleString("zh-CN");
    peerTotal.textContent = comparison.peerProfile.total.toLocaleString("zh-CN");
    sharedTotal.textContent = comparison.shared.length.toLocaleString("zh-CN");
    currentAverage.textContent = `均分 ${
      comparison.currentProfile.averageRating?.toFixed(1) ?? "—"
    }`;
    peerAverage.textContent = `均分 ${
      comparison.peerProfile.averageRating?.toFixed(1) ?? "—"
    }`;
    currentCoverage.textContent = `评分覆盖 ${comparison.currentProfile.ratedPercent}%`;
    peerCoverage.textContent = `评分覆盖 ${comparison.peerProfile.ratedPercent}%`;
    overlapPercent.textContent = `重合率 ${comparison.overlapPercent}%`;
    overlapBar.style.width = `${comparison.overlapPercent}%`;
    sharedCount.textContent = String(comparison.shared.length);
    currentOnlyCount.textContent = String(comparison.currentOnly.length);
    peerOnlyCount.textContent = String(comparison.peerOnly.length);
    renderSimpleList(
      sharedList,
      comparison.shared,
      comparison.shared.length,
      "shared",
    );
    renderSimpleList(
      currentOnlyList,
      comparison.currentOnly,
      comparison.currentOnly.length,
      "only",
    );
    renderSimpleList(
      peerOnlyList,
      comparison.peerOnly,
      comparison.peerOnly.length,
      "only",
    );
    renderRatingDifferences(comparison.ratingDifferences);
    renderComparisonBars(compareYears, comparison.currentProfile.years, comparison.peerProfile.years);
    renderComparisonBars(compareRatings, comparison.currentProfile.ratings, comparison.peerProfile.ratings);
    results.hidden = false;
  }

  function rememberPeer(repository, branch) {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ repository, branch }),
      );
    } catch {
      // Private browsing can disable storage; the comparison still works.
    }
  }

  function syncUrl(repository, branch) {
    const url = new URL(window.location.href);
    url.searchParams.set("peer", repository);
    url.searchParams.set("branch", branch);
    window.history.replaceState(null, "", url);
  }

  function setBusy(value) {
    busy = value;
    submitButton.disabled = value;
    submitButton.textContent = value ? "正在比对" : "开始 PK";
    submitButton.classList.toggle("is-loading", value);
  }

  async function compare(event) {
    event?.preventDefault();
    if (busy) {
      return;
    }

    let repository;
    let branch;
    try {
      repository = normalizeRepository(repositoryInput.value);
      branch = normalizeBranch(branchInput.value);
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    repositoryInput.value = repository;
    branchInput.value = branch;
    setBusy(true);
    results.hidden = true;
    setStatus(`正在读取 ${repository} 的公开轻量索引…`, "loading");

    try {
      const [currentItems, peerItems] = await Promise.all([
        loadCurrentItems(),
        loadPeerItems(repository, branch),
      ]);
      const comparison = compareItems(currentItems, peerItems);
      renderComparison(comparison);
      rememberPeer(repository, branch);
      syncUrl(repository, branch);
      setStatus(
        `已读取 ${repository}@${branch}，匹配 ${comparison.shared.length} 部共同作品。`,
      );
    } catch (error) {
      setStatus(
        error.message || "仓库比对失败，请检查仓库、分支与公开访问设置。",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("浏览器未允许复制");
    }
  }

  async function shareComparison() {
    if (!ownRepository) {
      setStatus("请先在 config/site.json 配置 GitHub 仓库。", "error");
      return;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("peer", ownRepository);
    url.searchParams.set("branch", ownBranch);
    const label = shareButton.querySelector("span");
    const original = label.textContent;
    shareButton.disabled = true;
    try {
      await copyText(url.toString());
      shareButton.classList.add("is-success");
      label.textContent = "邀请链接已复制";
      setStatus("邀请链接已复制，打开后会填入你的分享仓库。");
      window.setTimeout(() => {
        shareButton.classList.remove("is-success");
        label.textContent = original;
        shareButton.disabled = false;
      }, 2200);
    } catch (error) {
      shareButton.disabled = false;
      setStatus(error.message || "复制失败，请手动复制浏览器地址。", "error");
    }
  }

  form.addEventListener("submit", compare);
  shareButton.addEventListener("click", shareComparison);

  const params = new URLSearchParams(window.location.search);
  let remembered = null;
  try {
    remembered = JSON.parse(window.localStorage.getItem(storageKey) || "null");
  } catch {
    remembered = null;
  }
  const sharedPeer = params.get("peer");
  repositoryInput.value =
    sharedPeer || remembered?.repository || "";
  branchInput.value =
    params.get("branch") || remembered?.branch || "main";

  if (sharedPeer) {
    setStatus("已填入分享者仓库，正在准备比对…");
    window.setTimeout(() => form.requestSubmit(), 0);
  } else if (remembered?.repository) {
    setStatus("已恢复上次使用的对比仓库。");
  }
})();
