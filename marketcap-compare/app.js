const CG = "https://api.coingecko.com/api/v3";

const state = {
  stocks: [],
  privates: [],
  selected: { a: null, b: null },
  cgCache: new Map(),
};

async function boot() {
  const [stocks, privates] = await Promise.all([
    fetch("data/stocks.json").then((r) => r.json()),
    fetch("data/private.json").then((r) => r.json()),
  ]);
  state.stocks = stocks.stocks.map((s) => ({ ...s, kind: "stock" }));
  state.privates = privates.companies.map((c) => ({ ...c, kind: "private" }));

  document.querySelectorAll(".picker").forEach(wirePicker);
  renderExamples();
}

function wirePicker(pickerEl) {
  const side = pickerEl.dataset.side;
  const input = pickerEl.querySelector(".search");
  const list = pickerEl.querySelector(".suggestions");
  const selected = pickerEl.querySelector(".selected");

  let debounceId;
  let activeIdx = -1;
  let currentResults = [];

  input.addEventListener("input", () => {
    clearTimeout(debounceId);
    const q = input.value.trim();
    if (!q) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    list.innerHTML = `<li class="loading">Searching…</li>`;
    debounceId = setTimeout(async () => {
      currentResults = await search(q);
      activeIdx = -1;
      renderSuggestions(list, currentResults);
    }, 200);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, currentResults.length - 1);
      updateActive(list, activeIdx);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      updateActive(list, activeIdx);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = currentResults[Math.max(activeIdx, 0)];
      if (pick) choose(side, pick);
    } else if (e.key === "Escape") {
      list.hidden = true;
    }
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-idx]");
    if (!li) return;
    const pick = currentResults[Number(li.dataset.idx)];
    if (pick) choose(side, pick);
  });

  document.addEventListener("click", (e) => {
    if (!pickerEl.contains(e.target)) list.hidden = true;
  });

  selected.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      state.selected[side] = null;
      selected.hidden = true;
      input.value = "";
      input.focus();
      renderResult();
    }
  });
}

function updateActive(list, idx) {
  list.querySelectorAll("li").forEach((li, i) => {
    li.classList.toggle("active", i === idx);
  });
}

function renderSuggestions(list, results) {
  if (!results.length) {
    list.innerHTML = `<li class="loading">No matches.</li>`;
    return;
  }
  list.innerHTML = results
    .map(
      (r, i) => `
      <li data-idx="${i}">
        <span class="name">${escape(r.name)}</span>
        <span class="sym">${escape(r.ticker || r.symbol || "")}</span>
        <span class="badge ${r.kind}">${r.kind}</span>
      </li>`,
    )
    .join("");
}

async function search(q) {
  const ql = q.toLowerCase();
  const localStocks = state.stocks.filter(
    (s) =>
      s.ticker.toLowerCase().includes(ql) ||
      s.name.toLowerCase().includes(ql),
  );
  const localPrivates = state.privates.filter(
    (s) =>
      s.ticker.toLowerCase().includes(ql) ||
      s.name.toLowerCase().includes(ql),
  );

  let cryptos = [];
  try {
    const res = await fetch(`${CG}/search?query=${encodeURIComponent(q)}`);
    const data = await res.json();
    cryptos = (data.coins || []).slice(0, 8).map((c) => ({
      kind: "crypto",
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      ticker: c.symbol?.toUpperCase(),
    }));
  } catch (err) {
    console.warn("CoinGecko search failed", err);
  }

  return [
    ...localStocks.slice(0, 5),
    ...localPrivates.slice(0, 5),
    ...cryptos,
  ].slice(0, 20);
}

async function choose(side, pick) {
  const pickerEl = document.querySelector(`.picker[data-side="${side}"]`);
  const input = pickerEl.querySelector(".search");
  const list = pickerEl.querySelector(".suggestions");
  const selected = pickerEl.querySelector(".selected");

  list.hidden = true;
  input.value = "";
  selected.hidden = false;
  selected.innerHTML = `<button title="Clear">×</button><div class="name">Loading ${escape(pick.name)}…</div>`;

  try {
    const asset = await hydrate(pick);
    state.selected[side] = asset;
    selected.innerHTML = `
      <button title="Clear">×</button>
      <div class="name">${escape(asset.name)} <span class="sym muted">${escape(asset.ticker || "")}</span></div>
      <div class="mcap">Market cap: ${fmtMoney(asset.market_cap)}${asset.price ? ` · Price: ${fmtMoney(asset.price, true)}` : ""}</div>
    `;
    renderResult();
  } catch (err) {
    selected.innerHTML = `<button title="Clear">×</button><div class="error">${escape(err.message)}</div>`;
  }
}

async function hydrate(pick) {
  if (pick.kind === "stock" || pick.kind === "private") {
    return {
      kind: pick.kind,
      name: pick.name,
      ticker: pick.ticker,
      market_cap: pick.market_cap,
      supply: pick.shares_outstanding || null,
      price:
        pick.shares_outstanding && pick.market_cap
          ? pick.market_cap / pick.shares_outstanding
          : null,
      unit: pick.kind === "stock" ? "share" : "company",
    };
  }
  if (pick.kind === "crypto") {
    if (state.cgCache.has(pick.id)) return state.cgCache.get(pick.id);
    const res = await fetch(
      `${CG}/coins/${pick.id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`,
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    const md = data.market_data || {};
    const asset = {
      kind: "crypto",
      name: data.name,
      ticker: data.symbol?.toUpperCase(),
      market_cap: md.market_cap?.usd ?? null,
      supply: md.circulating_supply ?? null,
      price: md.current_price?.usd ?? null,
      unit: "token",
    };
    if (!asset.market_cap) {
      throw new Error(
        `${asset.name} has no market cap on CoinGecko (likely unlisted or pre-launch).`,
      );
    }
    state.cgCache.set(pick.id, asset);
    return asset;
  }
  throw new Error("Unknown asset kind");
}

function renderResult() {
  const section = document.querySelector(".result");
  const { a, b } = state.selected;
  if (!a || !b) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const mult = b.market_cap / a.market_cap;
  const multEl = section.querySelector(".multiplier");
  const priceEl = section.querySelector(".price-line");
  const detailsEl = section.querySelector(".details");

  multEl.textContent = `${fmtMult(mult)}`;
  multEl.style.color = mult >= 1 ? "" : "var(--red)";

  if (a.price) {
    const newPrice = a.price * mult;
    priceEl.innerHTML = `1 <strong>${escape(a.ticker || a.name)}</strong> would be worth <strong>${fmtMoney(newPrice, true)}</strong> <span class="muted">(currently ${fmtMoney(a.price, true)})</span>`;
  } else {
    priceEl.innerHTML = `${escape(a.name)} would be valued at <strong>${fmtMoney(b.market_cap)}</strong> total.`;
  }

  detailsEl.innerHTML = `
    ${escape(a.name)} market cap: ${fmtMoney(a.market_cap)} ·
    ${escape(b.name)} market cap: ${fmtMoney(b.market_cap)}
  `;
}

function renderExamples() {
  const chips = document.querySelector(".chips");
  const examples = [
    ["DOGE", "Apple"],
    ["SHIB", "NVIDIA"],
    ["PEPE", "Tesla"],
    ["ETH", "Microsoft"],
    ["SOL", "Meta"],
    ["GME", "Tesla"],
    ["BTC", "OpenAI"],
    ["Anthropic", "OpenAI"],
  ];

  chips.innerHTML = examples
    .map(
      ([a, b]) =>
        `<button class="chip" data-a="${escape(a)}" data-b="${escape(b)}">${escape(a)} → ${escape(b)}</button>`,
    )
    .join("");

  chips.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await runExample(btn.dataset.a, btn.dataset.b);
    });
  });
}

async function runExample(aQ, bQ) {
  const [aRes, bRes] = await Promise.all([search(aQ), search(bQ)]);
  if (aRes[0]) await choose("a", aRes[0]);
  if (bRes[0]) await choose("b", bRes[0]);
}

function fmtMoney(n, allowSmall = false) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (allowSmall && abs < 1) {
    if (abs < 0.000001) return `$${n.toExponential(3)}`;
    return `$${n.toPrecision(4)}`;
  }
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtMult(m) {
  if (!isFinite(m)) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(1)}K×`;
  if (m >= 100) return `${m.toFixed(0)}×`;
  if (m >= 10) return `${m.toFixed(1)}×`;
  if (m >= 1) return `${m.toFixed(2)}×`;
  return `${(m * 100).toFixed(1)}%`;
}

function escape(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

boot();
