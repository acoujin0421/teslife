const STORAGE_KEY = "tesla-car-ledger:v1";
const CLOUD_KEY = "tesla-car-ledger:cloud:v1";
const PRESET_PASS_SESSION = "tesla-car-ledger:preset-pass-session";
const PRESET_PASS_LOCAL = "tesla-car-ledger:preset-pass-local";

/** 암호화된 cloud-preset 복호화 결과 (평문 preset보다 우선) */
let decryptedPresetCache = null;

/** PAT 앞뒤 공백·실수로 붙인 Bearer 접두어 제거 */
function normalizeGithubToken(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, "").trim();
  return s;
}

const KNOWN_PROVIDERS = [
  "테슬라(슈퍼차저)",
  "환경부",
  "한국전력(KEPCO)",
  "현대 E-pit",
  "차지비(ChargEV)",
  "EVSIS(이브이시스)",
  "대영채비",
  "에버온(EVERON)",
  "SK일렉링크",
  "GS칼텍스",
  "LG유플러스",
  "스타코프",
  "한전KDN",
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayISO() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function currentMonthISO() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function toMonth(dateISO) {
  return (dateISO || "").slice(0, 7);
}

function formatWon(n) {
  const v = Number(n || 0);
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

function formatNum(n, digits = 1) {
  const v = Number(n || 0);
  const fixed = Number.isFinite(v) ? v.toFixed(digits) : "0.0";
  const trimmed = fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  return trimmed;
}

function computeUnitWonPerKwh(cost, kwh) {
  const c = Number(cost || 0);
  const k = Number(kwh || 0);
  if (!Number.isFinite(c) || !Number.isFinite(k) || k <= 0 || c <= 0) return null;
  return Math.round(c / k);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw)
      return { charge: [], hipass: [], expense: [], ui: { month: currentMonthISO(), trendMetric: "total" }, editing: null };
    const parsed = JSON.parse(raw);
    return {
      charge: Array.isArray(parsed.charge) ? parsed.charge : [],
      hipass: Array.isArray(parsed.hipass) ? parsed.hipass : [],
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      ui:
        parsed.ui && typeof parsed.ui === "object"
          ? {
              month: parsed.ui.month || currentMonthISO(),
              trendMetric: parsed.ui.trendMetric || "total",
              providerExtras: Array.isArray(parsed.ui.providerExtras) ? parsed.ui.providerExtras : [],
              chargeTypeFilter: parsed.ui.chargeTypeFilter || "all",
              hipassKindFilter: parsed.ui.hipassKindFilter || "all",
            }
          : { month: currentMonthISO(), trendMetric: "total", providerExtras: [], chargeTypeFilter: "all", hipassKindFilter: "all" },
      editing: parsed.editing && typeof parsed.editing === "object" ? parsed.editing : null,
    };
  } catch {
    return { charge: [], hipass: [], expense: [], ui: { month: currentMonthISO(), trendMetric: "total" }, editing: null };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  scheduleAutosync();
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) {
      return {
        owner: "",
        repo: "",
        branch: "main",
        path: "data.json",
        token: "",
        autosync: false,
        lastSha: null,
        lastSyncAt: null,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      owner: parsed.owner || "",
      repo: parsed.repo || "",
      branch: parsed.branch || "main",
      path: parsed.path || "data.json",
      token: normalizeGithubToken(parsed.token || ""),
      autosync: Boolean(parsed.autosync),
      lastSha: parsed.lastSha || null,
      lastSyncAt: parsed.lastSyncAt || null,
    };
  } catch {
    return { owner: "", repo: "", branch: "main", path: "data.json", token: "", autosync: false, lastSha: null, lastSyncAt: null };
  }
}

function saveCloudConfig(next) {
  try {
    const merged = { ...cloud, ...next };
    if (merged.token != null) merged.token = normalizeGithubToken(merged.token);
    cloud = merged;
    localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
  } catch (e) {
    console.warn("saveCloudConfig", e);
  }
}

function hasEncryptedPreset() {
  const enc = typeof window !== "undefined" ? window.__TESLA_CLOUD_PRESET_ENC__ : null;
  if (enc == null) return false;
  if (typeof enc === "object" && enc !== null && Number(enc.v) === 1 && enc.ciphertext) return true;
  const s = typeof enc === "string" ? enc.trim() : "";
  return s !== "" && s !== "null";
}

function getPresetPasswordForDecrypt() {
  const el = document.getElementById("ghPresetPass");
  const typed = (el?.value || "").trim();
  if (typed) return typed;
  return sessionStorage.getItem(PRESET_PASS_SESSION) || localStorage.getItem(PRESET_PASS_LOCAL) || "";
}

function persistPresetPassword(plain) {
  sessionStorage.setItem(PRESET_PASS_SESSION, plain);
  if (document.getElementById("ghPresetRemember")?.checked) {
    localStorage.setItem(PRESET_PASS_LOCAL, plain);
  } else {
    localStorage.removeItem(PRESET_PASS_LOCAL);
  }
}

/** 저장소의 cloud-preset.js — 평문 또는 복호화된 캐시 */
function applyCloudPreset() {
  try {
    let p = null;
    if (hasEncryptedPreset()) {
      p = decryptedPresetCache;
      if (!p) return;
    } else {
      p = typeof window !== "undefined" ? window.__TESLA_CLOUD_PRESET__ : null;
    }
    if (!p || typeof p !== "object") return;
    const owner = String(p.owner || "").trim();
    const repo = String(p.repo || "").trim();
    if (!owner || !repo) return;
    if (owner === "YOUR_GITHUB_USERNAME" || repo === "YOUR_REPO_NAME") return;
    const branch = String(p.branch || "main").trim() || "main";
    const path = String(p.path || "data.json").trim() || "data.json";
    const next = { owner, repo, branch, path };
    const pt = normalizeGithubToken(p.token);
    if (pt) next.token = pt;
    saveCloudConfig(next);
  } catch (e) {
    console.warn("applyCloudPreset", e);
  }
}

async function tryLoadEncryptedPreset(options = {}) {
  const silent = Boolean(options.silent);
  try {
    decryptedPresetCache = null;
    if (!hasEncryptedPreset()) return;
    if (!window.PresetCrypto?.decryptPreset) {
      if (!silent) setCloudStatus("preset-crypto.js 로드 필요");
      return;
    }
    let payload = window.__TESLA_CLOUD_PRESET_ENC__;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        if (!silent) setCloudStatus("__TESLA_CLOUD_PRESET_ENC__ JSON 형식이 아닙니다.");
        return;
      }
    }
    const pass = getPresetPasswordForDecrypt();
    if (!pass) {
      setCloudStatus("암호화 프리셋: ⚙에서 비밀번호 입력 후 「적용」");
      return;
    }
    try {
      decryptedPresetCache = await window.PresetCrypto.decryptPreset(payload, pass);
      if (!silent) setCloudStatus("프리셋 복호화 완료");
    } catch (e) {
      const name = e?.name || "";
      const msg = String(e?.message || e);
      let hint = msg;
      if (name === "OperationError" || /decrypt|unable|fail/i.test(msg)) {
        hint = "비밀번호가 틀렸거나, 암호문이 잘못 복사되었습니다. encrypt-preset.html로 다시 생성해 보세요.";
      } else if (msg.includes("잘못된 암호화")) {
        hint = "cloud-preset.js의 __TESLA_CLOUD_PRESET_ENC__ 한 줄이 온전한지 확인하세요.";
      }
      setCloudStatus(`프리셋 복호화 실패: ${hint}`);
      console.warn("decryptPreset", e);
    }
  } catch (e) {
    console.warn("tryLoadEncryptedPreset", e);
    if (!silent) setCloudStatus(`프리셋 처리 오류: ${e?.message || e}`);
  }
}

function syncCloudBeforeApi() {
  cloud = loadCloudConfig();
  applyCloudPreset();
  const tokenEl = document.getElementById("ghToken");
  if (tokenEl) {
    const t = (tokenEl.value || "").trim();
    if (t && !t.includes("•")) saveCloudConfig({ token: normalizeGithubToken(t) });
  }
  if (cloud.token) saveCloudConfig({ token: normalizeGithubToken(cloud.token) });
  const auto = document.getElementById("ghAutosync");
  if (auto) saveCloudConfig({ autosync: auto.checked });
}

function getDataForCloud() {
  // 토큰/편집중 상태는 제외하고, 기록/설정만 저장
  return {
    charge: state.charge,
    hipass: state.hipass,
    expense: state.expense,
    ui: state.ui,
  };
}

function applyCloudData(obj) {
  const next = {
    charge: Array.isArray(obj?.charge) ? obj.charge : [],
    hipass: Array.isArray(obj?.hipass) ? obj.hipass : [],
    expense: Array.isArray(obj?.expense) ? obj.expense : [],
    ui: obj?.ui && typeof obj.ui === "object" ? obj.ui : state.ui,
    editing: null,
  };
  state = { ...state, ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  seedProvidersFromHistory();
  syncEditUi();
  render();
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decodeUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function ghHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
  };
  const t = normalizeGithubToken(cloud.token);
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

function ghUrl(path) {
  return `https://api.github.com${path}`;
}

async function ghGetJsonFile() {
  const { owner, repo, path, branch } = cloud;
  const url = ghUrl(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`불러오기 실패 (${res.status}): ${txt}${hintGithubAuthError(res.status, txt)}`);
  }
  const data = await res.json();
  // { content, sha, encoding }
  const jsonText = b64decodeUtf8((data.content || "").replaceAll("\n", ""));
  return { sha: data.sha, json: JSON.parse(jsonText) };
}

async function ghPutJsonFile({ json, message }) {
  const { owner, repo, path, branch } = cloud;
  const url = ghUrl(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`);
  const body = {
    message,
    content: b64encodeUtf8(JSON.stringify(json, null, 2)),
    branch,
  };
  if (cloud.lastSha) body.sha = cloud.lastSha;

  const res = await fetch(url, { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`저장(커밋) 실패 (${res.status}): ${txt}${hintGithubAuthError(res.status, txt)}`);
  }
  const data = await res.json();
  const newSha = data?.content?.sha || data?.content?.sha;
  return { sha: newSha || null };
}

function isCloudConfigured() {
  return Boolean(cloud.owner && cloud.repo && cloud.branch && cloud.path && normalizeGithubToken(cloud.token));
}

function hintGithubAuthError(status, bodyText) {
  if (status !== 401 && status !== 403) return "";
  const lower = String(bodyText || "").toLowerCase();
  if (lower.includes("bad credentials") || status === 401) {
    return " 인증 실패: PAT가 잘못되었거나 만료·폐기되었습니다. GitHub에서 새 토큰을 발급하고, Fine-grained면 이 저장소에 Contents(Read/Write) 권한이 있는지 확인하세요.";
  }
  if (status === 403 || lower.includes("resource not accessible")) {
    return " 권한 없음: 토큰에 해당 저장소 Contents 쓰기 권한이 있는지, 저장소 owner/repo 이름이 맞는지 확인하세요.";
  }
  return "";
}

function setCloudStatus(msg) {
  const el = document.getElementById("cloudStatus");
  if (el) el.textContent = msg;
  const bar = document.getElementById("cloudBarStatus");
  if (bar) bar.textContent = msg;
}

function updateCloudSettingsInputs() {
  const tokenEl = document.getElementById("ghToken");
  if (tokenEl) tokenEl.value = cloud.token ? "••••••••" : "";
  const auto = document.getElementById("ghAutosync");
  if (auto) auto.checked = Boolean(cloud.autosync);
  const passEl = document.getElementById("ghPresetPass");
  if (passEl) {
    passEl.value = "";
    const stored = sessionStorage.getItem(PRESET_PASS_SESSION) || localStorage.getItem(PRESET_PASS_LOCAL);
    passEl.placeholder = stored ? "저장됨 · 바꾸려면 새 비밀번호 입력 후 적용" : "encrypt-preset.html로 암호화할 때 쓴 비밀번호";
  }
  const rem = document.getElementById("ghPresetRemember");
  if (rem) rem.checked = Boolean(localStorage.getItem(PRESET_PASS_LOCAL));
}

async function cloudLoad() {
  syncCloudBeforeApi();
  if (!isCloudConfigured()) {
    setCloudStatus("cloud-preset.js에 owner/repo를 넣고, 토큰은 preset 또는 ⚙에서 입력하세요.");
    return;
  }
  setCloudStatus("불러오는 중...");
  const { sha, json } = await ghGetJsonFile();
  saveCloudConfig({ lastSha: sha, lastSyncAt: Date.now() });
  applyCloudData(json);
  setCloudStatus(`불러오기 완료 · sha ${String(sha).slice(0, 7)}`);
}

async function cloudSave(reason = "manual") {
  syncCloudBeforeApi();
  if (!isCloudConfigured()) {
    setCloudStatus("cloud-preset.js에 owner/repo를 넣고, 토큰은 preset 또는 ⚙에서 입력하세요.");
    return;
  }
  setCloudStatus("저장(커밋) 중...");

  // 최신 sha를 먼저 가져와 충돌 가능성을 줄임
  try {
    const { sha } = await ghGetJsonFile();
    saveCloudConfig({ lastSha: sha });
  } catch {
    // data.json이 없거나 권한 문제일 수 있음. (없는 경우는 sha 없이 생성 시도)
    saveCloudConfig({ lastSha: null });
  }

  const message = reason === "autosync" ? "Update data.json (autosync)" : "Update data.json";
  const payload = getDataForCloud();
  const { sha } = await ghPutJsonFile({ json: payload, message });
  saveCloudConfig({ lastSha: sha, lastSyncAt: Date.now() });
  setCloudStatus(`저장 완료 · sha ${String(sha || "").slice(0, 7)}`);
}

let autosyncTimer = null;
function scheduleAutosync() {
  if (!cloud.autosync) return;
  if (!isCloudConfigured()) return;
  if (autosyncTimer) clearTimeout(autosyncTimer);
  autosyncTimer = setTimeout(() => {
    cloudSave("autosync").catch((e) => setCloudStatus(String(e.message || e)));
  }, 2000);
}

function parsePositiveNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setDefaultDates() {
  const t = todayISO();
  const ids = ["cDate", "hDate", "eDate"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = t;
  }
}

function setHipassDefaultNoteIfEmpty() {
  const el = document.getElementById("hNote");
  if (!el) return;
  if (!el.value || !el.value.trim()) el.value = "출퇴근";
}

function setMonthPickerDefault() {
  const el = document.getElementById("monthPicker");
  if (!el) return;
  el.value = state.ui.month || currentMonthISO();
}

function getSelectedMonth() {
  const el = document.getElementById("monthPicker");
  return el?.value || currentMonthISO();
}

function withinSelectedMonth(item) {
  return toMonth(item.date) === getSelectedMonth();
}

function sortByDateDesc(a, b) {
  const da = a.date || "";
  const db = b.date || "";
  if (da === db) return (b.createdAt || 0) - (a.createdAt || 0);
  return db.localeCompare(da);
}

function render() {
  renderTables();
  renderKpis();
  wireProviderDatalist();
}

function renderTables() {
  renderChargeTable();
  renderHipassTable();
  renderExpenseTable();
}

function renderChargeTable() {
  const tbody = document.getElementById("tbodyCharge");
  if (!tbody) return;
  const typeFilter = state.ui.chargeTypeFilter || "all";
  const rows = state.charge
    .filter(withinSelectedMonth)
    .filter((r) => (typeFilter === "all" ? true : (r.type || "") === typeFilter))
    .sort(sortByDateDesc);
  tbody.innerHTML =
    rows.length === 0
      ? `<tr><td colspan="7" class="muted">선택한 월의 충전 기록이 없습니다.</td></tr>`
      : rows
          .map((r) => {
            const unit = r.kwh > 0 ? Math.round(r.cost / r.kwh) : 0;
            const noteRaw = r.note ? String(r.note) : "";
            const note = noteRaw ? escapeHtml(noteRaw) : "";
            const provider = r.provider ? escapeHtml(r.provider) : "";
            const typeText = escapeHtml(r.type || "");
            const typeBadgeClass =
              r.type === "집밥" || r.type === "완속" ? "badge badge--mint" : r.type === "슈퍼차저" ? "badge badge--accent" : "badge";
            const providerHtml = provider ? `<div class="nowrap">${provider}</div>` : `<div class="cellSub">-</div>`;
            return `<tr>
  <td class="nowrap">${escapeHtml(r.date)}</td>
  <td class="nowrap"><span class="${typeBadgeClass}">${typeText}</span></td>
  <td>${providerHtml}</td>
  <td class="num">${escapeHtml(formatNum(r.kwh, 1))}</td>
  <td class="num"><span class="money">${escapeHtml(formatWon(r.cost))}</span><div class="cellSub">${unit ? `${unit.toLocaleString("ko-KR")}원/kWh` : "-"}</div></td>
  <td class="memoCell" title="${note ? escapeHtml(noteRaw) : ""}">${note}</td>
  <td class="cell-actions">
    <button class="iconBtn" data-action="edit-charge" data-id="${escapeHtml(r.id)}" type="button">편집</button>
    <button class="iconBtn iconBtn--danger" data-action="del-charge" data-id="${escapeHtml(r.id)}" type="button">삭제</button>
  </td>
</tr>`;
          })
          .join("");
}

function renderHipassTable() {
  const tbody = document.getElementById("tbodyHipass");
  if (!tbody) return;
  const kindFilter = state.ui.hipassKindFilter || "all";
  const rows = state.hipass
    .filter(withinSelectedMonth)
    .filter((r) => (kindFilter === "all" ? true : (r.kind || "") === kindFilter))
    .sort(sortByDateDesc);
  tbody.innerHTML =
    rows.length === 0
      ? `<tr><td colspan="5" class="muted">선택한 월의 하이패스 기록이 없습니다.</td></tr>`
      : rows
          .map((r) => {
            const noteRaw = r.note ? String(r.note) : "";
            const note = noteRaw ? escapeHtml(noteRaw) : "";
            const signed = r.kind === "충전" ? "+" : "-";
            const kindText = escapeHtml(r.kind);
            const kindBadgeClass = r.kind === "사용" ? "badge badge--rose" : "badge badge--accent";
            return `<tr>
  <td class="nowrap">${escapeHtml(r.date)}</td>
  <td class="nowrap"><span class="${kindBadgeClass}">${kindText}</span></td>
  <td class="num"><span class="money">${signed}${escapeHtml(formatWon(r.amount))}</span></td>
  <td class="memoCell" title="${note ? escapeHtml(noteRaw) : ""}">${note}</td>
  <td class="cell-actions">
    <button class="iconBtn" data-action="edit-hipass" data-id="${escapeHtml(r.id)}" type="button">편집</button>
    <button class="iconBtn iconBtn--danger" data-action="del-hipass" data-id="${escapeHtml(r.id)}" type="button">삭제</button>
  </td>
</tr>`;
          })
          .join("");
}

function renderExpenseTable() {
  const tbody = document.getElementById("tbodyExpense");
  if (!tbody) return;
  const rows = state.expense.filter(withinSelectedMonth).sort(sortByDateDesc);
  tbody.innerHTML =
    rows.length === 0
      ? `<tr><td colspan="5" class="muted">선택한 월의 기타 지출이 없습니다.</td></tr>`
      : rows
          .map((r) => {
            const note = r.note ? escapeHtml(r.note) : "";
            return `<tr>
  <td>${escapeHtml(r.date)}</td>
  <td>${escapeHtml(r.category)}</td>
  <td class="num">${escapeHtml(formatWon(r.cost))}</td>
  <td>${note}</td>
  <td class="cell-actions">
    <button class="iconBtn" data-action="edit-expense" data-id="${escapeHtml(r.id)}" type="button">편집</button>
    <button class="iconBtn iconBtn--danger" data-action="del-expense" data-id="${escapeHtml(r.id)}" type="button">삭제</button>
  </td>
</tr>`;
          })
          .join("");
}

function setEditing(next) {
  state.editing = next; // { list: "charge"|"hipass"|"expense", id: string } | null
  saveState();
  syncEditUi();
}

function getEditing() {
  if (!state.editing) return null;
  const { list, id } = state.editing;
  if (!list || !id) return null;
  return state.editing;
}

function syncEditUi() {
  const editing = getEditing();

  const ebCharge = document.getElementById("editBarCharge");
  const ebHipass = document.getElementById("editBarHipass");
  const ebExpense = document.getElementById("editBarExpense");
  if (ebCharge) ebCharge.hidden = !(editing && editing.list === "charge");
  if (ebHipass) ebHipass.hidden = !(editing && editing.list === "hipass");
  if (ebExpense) ebExpense.hidden = !(editing && editing.list === "expense");

  const btnCharge = document.getElementById("btnChargeSubmit");
  const btnHipass = document.getElementById("btnHipassSubmit");
  const btnExpense = document.getElementById("btnExpenseSubmit");
  if (btnCharge) btnCharge.textContent = editing?.list === "charge" ? "수정 저장" : "저장";
  if (btnHipass) btnHipass.textContent = editing?.list === "hipass" ? "수정 저장" : "저장";
  if (btnExpense) btnExpense.textContent = editing?.list === "expense" ? "수정 저장" : "저장";
}

function renderKpis() {
  const month = getSelectedMonth();

  const charge = state.charge.filter((x) => toMonth(x.date) === month);
  const hipass = state.hipass.filter((x) => toMonth(x.date) === month);
  const expense = state.expense.filter((x) => toMonth(x.date) === month);

  const chargeCost = sum(charge.map((x) => x.cost));
  const chargeKwh = sum(charge.map((x) => x.kwh));
  const chargeUnit = chargeKwh > 0 ? Math.round(chargeCost / chargeKwh) : 0;

  const hipassUse = sum(hipass.filter((x) => x.kind === "사용").map((x) => x.amount));
  const hipassTopup = sum(hipass.filter((x) => x.kind === "충전").map((x) => x.amount));
  const hipassNet = hipassUse; // 비용 관점에서는 "사용"만 합산

  const expenseCost = sum(expense.map((x) => x.cost));
  const total = chargeCost + hipassNet + expenseCost;

  setText("kpiChargeCost", formatWon(chargeCost));
  setText(
    "kpiChargeMeta",
    charge.length === 0 ? "기록 없음" : `${formatNum(chargeKwh, 1)}kWh · ${chargeUnit.toLocaleString("ko-KR")}원/kWh`,
  );

  setText("kpiHipassCost", formatWon(hipassNet));
  setText(
    "kpiHipassMeta",
    hipass.length === 0 ? "기록 없음" : `사용 ${formatWon(hipassUse)} · 충전 ${formatWon(hipassTopup)}`,
  );

  setText("kpiExpenseCost", formatWon(expenseCost));
  setText("kpiExpenseMeta", expense.length === 0 ? "기록 없음" : `${expense.length}건`);

  setText("kpiTotal", formatWon(total));

  renderChargeUnitSummary(charge);
  renderChargeTrendMessage(charge);
  renderTrendChart();
}

function daysBetween(a, b) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / ms);
}

function monthRange(selectedMonthISO) {
  const [y, m] = selectedMonthISO.split("-").map((x) => Number(x));
  const start = new Date(y, (m || 1) - 1, 1);
  const endOfMonth = new Date(y, (m || 1), 0); // last day

  const isCurrent = selectedMonthISO === currentMonthISO();
  const today = new Date();
  const end = isCurrent ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : endOfMonth;
  return { start, end, isCurrent };
}

function renderChargeTrendMessage(chargeRows) {
  const el = document.getElementById("chargeTrendMessage");
  if (!el) return;

  const month = getSelectedMonth();
  const { start, end, isCurrent } = monthRange(month);
  const title = isCurrent ? "이번달" : `${month}`;

  const rows = [...chargeRows].filter((x) => x.date).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const count = rows.length;
  if (count === 0) {
    el.textContent = `${title} 충전 기록이 없습니다.`;
    return;
  }

  const totalCost = sum(rows.map((x) => x.cost));
  const totalKwh = sum(rows.map((x) => x.kwh));
  const avgCost = totalCost / count;
  const avgKwh = totalKwh / count;

  // "평균 X일에 한 번"은 월 기간(이번달은 오늘까지) / 충전횟수로 산출
  const spanDays = Math.max(1, daysBetween(start, end) + 1);
  const everyDays = spanDays / count;

  const lastDate = rows[rows.length - 1].date;
  const avgUnit = computeUnitWonPerKwh(totalCost, totalKwh);

  if (count === 1) {
    el.textContent = `${title}에는 1회 충전했습니다. (${lastDate}, ${formatNum(totalKwh, 1)}kWh · ${formatWon(
      totalCost,
    )}${avgUnit ? ` · ${avgUnit.toLocaleString("ko-KR")}원/kWh` : ""})`;
    return;
  }

  el.textContent =
    `${title}에는 평균 ${formatNum(everyDays, 1)}일에 한 번, 평균 ${formatWon(avgCost)}씩(` +
    `${formatNum(avgKwh, 1)}kWh) 충전하고 있습니다. ` +
    `총 ${count}회 · ${formatNum(totalKwh, 1)}kWh · ${formatWon(totalCost)}${avgUnit ? ` · 평균 ${avgUnit.toLocaleString("ko-KR")}원/kWh` : ""} · 최근 ${lastDate}`;
}

function renderChargeUnitSummary(chargeRows) {
  const el = document.getElementById("chargeUnitSummary");
  if (!el) return;

  const groups = new Map(); // unit -> { unit, slowKwh, fastKwh, slowCost, fastCost, slowCount, fastCount }
  for (const r of chargeRows) {
    const unit = Number.isFinite(r.unit) ? r.unit : computeUnitWonPerKwh(r.cost, r.kwh);
    if (!unit) continue;
    const key = String(unit);
    const g =
      groups.get(key) || { unit, slowKwh: 0, fastKwh: 0, slowCost: 0, fastCost: 0, slowCount: 0, fastCount: 0 };
    const kwh = Number(r.kwh || 0);
    const cost = Number(r.cost || 0);
    const speed = chargeSpeedGroup(r.type);
    if (speed === "slow") {
      g.slowKwh += kwh;
      g.slowCost += cost;
      g.slowCount += 1;
    } else {
      g.fastKwh += kwh;
      g.fastCost += cost;
      g.fastCount += 1;
    }
    groups.set(key, g);
  }

  const list = Array.from(groups.values()).sort((a, b) => b.slowKwh + b.fastKwh - (a.slowKwh + a.fastKwh));
  if (list.length === 0) {
    el.textContent = "단가를 계산할 수 있는 충전 기록이 없습니다.";
    return;
  }

  const top = list.slice(0, 8);
  const rest = list.slice(8);
  const restAgg = rest.reduce(
    (acc, x) => {
      acc.slowKwh += x.slowKwh;
      acc.fastKwh += x.fastKwh;
      acc.slowCost += x.slowCost;
      acc.fastCost += x.fastCost;
      acc.slowCount += x.slowCount;
      acc.fastCount += x.fastCount;
      return acc;
    },
    { slowKwh: 0, fastKwh: 0, slowCost: 0, fastCost: 0, slowCount: 0, fastCount: 0 },
  );

  const lines = top.map((x) => {
    const totalKwh = x.slowKwh + x.fastKwh;
    const totalCost = x.slowCost + x.fastCost;
    const parts = [
      `${x.unit.toLocaleString("ko-KR")}원/kWh`,
      `완속 ${formatNum(x.slowKwh, 1)}kWh(${x.slowCount}회)`,
      `급속 ${formatNum(x.fastKwh, 1)}kWh(${x.fastCount}회)`,
      `합계 ${formatNum(totalKwh, 1)}kWh · ${formatWon(totalCost)}`,
    ];
    return parts.join(" · ");
  });
  if (rest.length > 0) {
    const totalKwh = restAgg.slowKwh + restAgg.fastKwh;
    const totalCost = restAgg.slowCost + restAgg.fastCost;
    lines.push(
      `기타 · 완속 ${formatNum(restAgg.slowKwh, 1)}kWh(${restAgg.slowCount}회) · 급속 ${formatNum(
        restAgg.fastKwh,
        1,
      )}kWh(${restAgg.fastCount}회) · 합계 ${formatNum(totalKwh, 1)}kWh · ${formatWon(totalCost)}`,
    );
  }
  el.innerHTML = `<div style="display:grid;gap:8px">${lines.map((s) => `<div>${escapeHtml(s)}</div>`).join("")}</div>`;
}

function chargeSpeedGroup(type) {
  // 완속: 집밥/완속, 급속: 급속/슈퍼차저(기본)
  if (type === "집밥" || type === "완속") return "slow";
  return "fast";
}

function monthsBack(fromMonthISO, count) {
  // fromMonthISO: "YYYY-MM"
  const [y, m] = fromMonthISO.split("-").map((x) => Number(x));
  const start = new Date(y, (m || 1) - 1, 1);
  const months = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    const yy = d.getFullYear();
    const mm = `${d.getMonth() + 1}`.padStart(2, "0");
    months.push(`${yy}-${mm}`);
  }
  return months;
}

function getTrendMetric() {
  const el = document.getElementById("trendMetric");
  return el?.value || state.ui.trendMetric || "total";
}

function computeMonthTotals(monthISO) {
  const charge = state.charge.filter((x) => toMonth(x.date) === monthISO);
  const hipass = state.hipass.filter((x) => toMonth(x.date) === monthISO);
  const expense = state.expense.filter((x) => toMonth(x.date) === monthISO);

  const chargeCost = sum(charge.map((x) => x.cost));
  const hipassUse = sum(hipass.filter((x) => x.kind === "사용").map((x) => x.amount));
  const expenseCost = sum(expense.map((x) => x.cost));
  const total = chargeCost + hipassUse + expenseCost;

  return { total, charge: chargeCost, hipass: hipassUse, expense: expenseCost };
}

function renderTrendChart() {
  const wrap = document.getElementById("sparkWrap");
  const hint = document.getElementById("sparkHint");
  if (!wrap || !hint) return;

  const baseMonth = getSelectedMonth();
  const metric = getTrendMetric();
  const months = monthsBack(baseMonth, 12);
  const values = months.map((m) => computeMonthTotals(m)[metric] || 0);

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);

  // SVG dimensions
  const W = 600;
  const H = 120;
  const padX = 16;
  const padY = 16;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;

  const denom = max - min || 1;
  const pts = values.map((v, i) => {
    const x = padX + (innerW * i) / Math.max(1, values.length - 1);
    const t = (v - min) / denom; // 0..1
    const y = padY + innerH * (1 - t);
    return { x, y, v };
  });

  const lineD = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaD = `${lineD} L ${(padX + innerW).toFixed(1)} ${(padY + innerH).toFixed(1)} L ${padX.toFixed(
    1,
  )} ${(padY + innerH).toFixed(1)} Z`;

  const stroke = "rgba(124,140,255,.95)";
  const fill = "rgba(124,140,255,.16)";
  const dot = "rgba(103,211,192,.95)";

  const last = pts[pts.length - 1];
  wrap.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="월별 추이 차트">
  <defs>
    <linearGradient id="gFill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${fill}" />
      <stop offset="100%" stop-color="rgba(124,140,255,0)" />
    </linearGradient>
  </defs>
  <path d="${areaD}" fill="url(#gFill)"></path>
  <path d="${lineD}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"></path>
  <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="${dot}"></circle>
</svg>`;

  const labels = { total: "총합", charge: "충전비", hipass: "하이패스(사용)", expense: "기타 지출" };
  hint.textContent = `${months[0]} ~ ${months[months.length - 1]} · ${labels[metric] || metric} · 최소 ${formatWon(
    min,
  )} / 최대 ${formatWon(max)}`;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function sum(arr) {
  return arr.reduce((acc, v) => acc + Number(v || 0), 0);
}

function addCharge(form) {
  const date = form.date.value;
  const type = form.type.value;
  const provider = (form.provider?.value || "").trim();
  const kwh = parsePositiveNumber(form.kwh.value);
  const cost = parsePositiveNumber(form.cost.value);
  const unit = computeUnitWonPerKwh(cost, kwh);
  const note = (form.note.value || "").trim();
  const editing = getEditing();
  if (editing?.list === "charge") {
    const idx = state.charge.findIndex((x) => x.id === editing.id);
    if (idx >= 0) {
      const prev = state.charge[idx];
      state.charge[idx] = {
        ...prev,
        date,
        type,
        provider: provider || undefined,
        kwh,
        cost,
        unit: unit ?? undefined,
        note,
      };
      setEditing(null);
    }
  } else {
    state.charge.push({
      id: uid(),
      createdAt: Date.now(),
      date,
      type,
      provider: provider || undefined,
      kwh,
      cost,
      unit: unit ?? undefined,
      note,
    });
  }
  if (provider) rememberProvider(provider);
  saveState();
  render();
  if (form.provider) form.provider.value = "";
  form.kwh.value = "";
  form.cost.value = "";
  if (form.unit) form.unit.value = "-";
  form.note.value = "";
}

function addHipass(form) {
  const date = form.date.value;
  const kind = form.kind.value; // 충전 | 사용
  const amount = parsePositiveNumber(form.amount.value);
  const note = (form.note.value || "").trim();
  const editing = getEditing();
  if (editing?.list === "hipass") {
    const idx = state.hipass.findIndex((x) => x.id === editing.id);
    if (idx >= 0) {
      const prev = state.hipass[idx];
      state.hipass[idx] = { ...prev, date, kind, amount, note };
      setEditing(null);
    }
  } else {
    state.hipass.push({ id: uid(), createdAt: Date.now(), date, kind, amount, note });
  }
  saveState();
  render();
  form.amount.value = "";
  form.note.value = "출퇴근";
}

/** 폼에 적힌 날짜·2,520원·메모 출퇴근으로 하이패스(사용) 1건 추가 */
function addHipassCommuteQuick() {
  if (getEditing()?.list === "hipass") return;
  const form = document.getElementById("formHipass");
  if (!form) return;
  const date = form.date.value || todayISO();
  state.hipass.push({
    id: uid(),
    createdAt: Date.now(),
    date,
    kind: "사용",
    amount: 2520,
    note: "출퇴근",
  });
  saveState();
  render();
  form.amount.value = "";
  form.note.value = "출퇴근";
}

function addExpense(form) {
  const date = form.date.value;
  const category = form.category.value;
  const cost = parsePositiveNumber(form.cost.value);
  const note = (form.note.value || "").trim();
  const editing = getEditing();
  if (editing?.list === "expense") {
    const idx = state.expense.findIndex((x) => x.id === editing.id);
    if (idx >= 0) {
      const prev = state.expense[idx];
      state.expense[idx] = { ...prev, date, category, cost, note };
      setEditing(null);
    }
  } else {
    state.expense.push({ id: uid(), createdAt: Date.now(), date, category, cost, note });
  }
  saveState();
  render();
  form.cost.value = "";
  form.note.value = "";
}

function openTab(tab) {
  const buttons = Array.from(document.querySelectorAll(".tab"));
  const btn = buttons.find((b) => b.dataset.tab === tab);
  btn?.click();
}

function scrollToForm(formId) {
  const el = document.getElementById(formId);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startEditCharge(id) {
  const item = state.charge.find((x) => x.id === id);
  if (!item) return;
  openTab("charge");
  const form = document.getElementById("formCharge");
  if (!form) return;
  form.date.value = item.date || todayISO();
  form.type.value = item.type || "집밥";
  if (form.provider) form.provider.value = item.provider || "";
  form.kwh.value = item.kwh ?? "";
  form.cost.value = item.cost ?? "";
  if (form.note) form.note.value = item.note || "";
  // unit field updates via auto calc, but set immediately too
  const unitEl = document.getElementById("cUnit");
  if (unitEl) unitEl.value = item.unit ? `${item.unit.toLocaleString("ko-KR")}원/kWh` : "-";
  setEditing({ list: "charge", id });
  scrollToForm("formCharge");
}

function startEditHipass(id) {
  const item = state.hipass.find((x) => x.id === id);
  if (!item) return;
  openTab("hipass");
  const form = document.getElementById("formHipass");
  if (!form) return;
  form.date.value = item.date || todayISO();
  form.kind.value = item.kind || "충전";
  form.amount.value = item.amount ?? "";
  if (form.note) form.note.value = item.note || "";
  setEditing({ list: "hipass", id });
  scrollToForm("formHipass");
}

function startEditExpense(id) {
  const item = state.expense.find((x) => x.id === id);
  if (!item) return;
  openTab("expense");
  const form = document.getElementById("formExpense");
  if (!form) return;
  form.date.value = item.date || todayISO();
  form.category.value = item.category || "주차";
  form.cost.value = item.cost ?? "";
  if (form.note) form.note.value = item.note || "";
  setEditing({ list: "expense", id });
  scrollToForm("formExpense");
}

function deleteById(listName, id) {
  const before = state[listName].length;
  state[listName] = state[listName].filter((x) => x.id !== id);
  if (state[listName].length !== before) {
    const editing = getEditing();
    if (editing?.list === listName && editing.id === id) setEditing(null);
    saveState();
    render();
  }
}

function wireTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      buttons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelectorAll(".pane").forEach((p) => p.classList.remove("is-active"));
      const pane = document.getElementById(`pane-${tab}`);
      pane?.classList.add("is-active");
    });
  });
}

function wireForms() {
  const formCharge = document.getElementById("formCharge");
  formCharge?.addEventListener("submit", (e) => {
    e.preventDefault();
    addCharge(formCharge);
  });

  const formHipass = document.getElementById("formHipass");
  formHipass?.addEventListener("submit", (e) => {
    e.preventDefault();
    addHipass(formHipass);
  });

  const formExpense = document.getElementById("formExpense");
  formExpense?.addEventListener("submit", (e) => {
    e.preventDefault();
    addExpense(formExpense);
  });
}

function wireChargeUnitAutoCalc() {
  const kwhEl = document.getElementById("cKwh");
  const costEl = document.getElementById("cCost");
  const unitEl = document.getElementById("cUnit");
  if (!kwhEl || !costEl || !unitEl) return;

  const update = () => {
    const unit = computeUnitWonPerKwh(costEl.value, kwhEl.value);
    unitEl.value = unit ? `${unit.toLocaleString("ko-KR")}원/kWh` : "-";
  };

  ["input", "change"].forEach((evt) => {
    kwhEl.addEventListener(evt, update);
    costEl.addEventListener(evt, update);
  });
  update();
}

function wireProviderDatalist() {
  const dl = document.getElementById("providerList");
  if (!dl) return;
  dl.innerHTML = getAllProviders().map((p) => `<option value="${escapeHtml(p)}"></option>`).join("");
}

function normalizeProvider(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

function getProviderUsageCounts() {
  const counts = new Map();
  for (const r of state.charge || []) {
    const p = normalizeProvider(r.provider);
    if (!p) continue;
    const key = p.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function getAllProviders() {
  const usage = getProviderUsageCounts();
  const extras = Array.isArray(state?.ui?.providerExtras) ? state.ui.providerExtras : [];
  const merged = [...KNOWN_PROVIDERS, ...extras].map(normalizeProvider).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of merged) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort((a, b) => {
    const ca = usage.get(a.toLowerCase()) || 0;
    const cb = usage.get(b.toLowerCase()) || 0;
    if (cb !== ca) return cb - ca;
    return a.localeCompare(b, "ko-KR");
  });
  return out;
}

function rememberProvider(provider) {
  const p = normalizeProvider(provider);
  if (!p) return;
  if (!state.ui.providerExtras) state.ui.providerExtras = [];

  const knownKeys = new Set(KNOWN_PROVIDERS.map((x) => normalizeProvider(x).toLowerCase()));
  const extraKeys = new Set(state.ui.providerExtras.map((x) => normalizeProvider(x).toLowerCase()));
  const key = p.toLowerCase();

  if (knownKeys.has(key) || extraKeys.has(key)) return;
  state.ui.providerExtras.push(p);
  state.ui.providerExtras.sort((a, b) => a.localeCompare(b, "ko-KR"));
  saveState();
  wireProviderDatalist();
}

function seedProvidersFromHistory() {
  // 기존 기록에 있는 사업자들도 자동완성에 올라오도록 1회 스캔
  const set = new Set();
  for (const r of state.charge || []) {
    if (r.provider) set.add(normalizeProvider(r.provider));
  }
  for (const p of set) rememberProvider(p);
}

function wireMonthPicker() {
  const el = document.getElementById("monthPicker");
  if (!el) return;
  el.addEventListener("change", () => {
    state.ui.month = el.value || currentMonthISO();
    saveState();
    render();
  });
}

function wireListFilters() {
  const charge = document.getElementById("chargeTypeFilter");
  const hipass = document.getElementById("hipassKindFilter");

  if (charge) {
    charge.value = state.ui.chargeTypeFilter || "all";
    charge.addEventListener("change", () => {
      state.ui.chargeTypeFilter = charge.value || "all";
      saveState();
      renderChargeTable();
    });
  }

  if (hipass) {
    hipass.value = state.ui.hipassKindFilter || "all";
    hipass.addEventListener("change", () => {
      state.ui.hipassKindFilter = hipass.value || "all";
      saveState();
      renderHipassTable();
    });
  }
}

function wireTrendMetric() {
  const el = document.getElementById("trendMetric");
  if (!el) return;
  el.value = state.ui.trendMetric || "total";
  el.addEventListener("change", () => {
    state.ui.trendMetric = el.value || "total";
    saveState();
    renderTrendChart();
  });
}

function wireDeleteButtons() {
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const action = t.dataset.action;
    const id = t.dataset.id;
    if (!action || !id) return;

    if (action === "edit-charge") startEditCharge(id);
    if (action === "edit-hipass") startEditHipass(id);
    if (action === "edit-expense") startEditExpense(id);

    if (action === "del-charge") deleteById("charge", id);
    if (action === "del-hipass") deleteById("hipass", id);
    if (action === "del-expense") deleteById("expense", id);
  });
}

function wireEditCancelButtons() {
  const c = document.getElementById("btnCancelChargeEdit");
  const h = document.getElementById("btnCancelHipassEdit");
  const e = document.getElementById("btnCancelExpenseEdit");
  c?.addEventListener("click", () => setEditing(null));
  h?.addEventListener("click", () => setEditing(null));
  e?.addEventListener("click", () => setEditing(null));
}

function wireHipassNoteDefaultAndSelect() {
  const el = document.getElementById("hNote");
  if (!el) return;
  setHipassDefaultNoteIfEmpty();

  el.addEventListener("focus", () => {
    // 기본값일 때는 바로 덮어쓰기 편하게 전체 선택
    if ((el.value || "").trim() === "출퇴근") {
      // 다음 틱에 선택(포커스 직후 selection 적용 안정화)
      setTimeout(() => el.select(), 0);
    }
  });

  document.getElementById("btnHipassCommute")?.addEventListener("click", () => addHipassCommuteQuick());
}

function wireIntroOverlay() {
  const overlay = document.getElementById("introOverlay");
  const btn = document.getElementById("btnStartApp");
  if (!overlay || !btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      syncCloudBeforeApi();
      await cloudLoad();
    } catch (e) {
      setCloudStatus(String(e?.message || e));
    } finally {
      btn.disabled = false;
      overlay.classList.add("intro--hidden");
      overlay.setAttribute("aria-hidden", "true");
      setMonthPickerDefault();
      setDefaultDates();
      syncEditUi();
      render();
    }
  });
}

function wireExportImportReset() {
  const btnExport = document.getElementById("btnExport");
  btnExport?.addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJson(`차계부-백업-${stamp}.json`, state);
  });

  const importFile = document.getElementById("importFile");
  importFile?.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;

    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      const next = {
        charge: Array.isArray(parsed.charge) ? parsed.charge : [],
        hipass: Array.isArray(parsed.hipass) ? parsed.hipass : [],
        expense: Array.isArray(parsed.expense) ? parsed.expense : [],
        ui: parsed.ui && typeof parsed.ui === "object" ? parsed.ui : { month: currentMonthISO() },
      };
      state = next;
      saveState();
      setMonthPickerDefault();
      syncEditUi();
      render();
      importFile.value = "";
    } catch {
      importFile.value = "";
      alert("가져오기 실패: JSON 파일을 확인해주세요.");
    }
  });

  const btnReset = document.getElementById("btnReset");
  btnReset?.addEventListener("click", () => {
    const ok = confirm("정말 초기화할까요? (모든 기록이 삭제됩니다)");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    setMonthPickerDefault();
    setDefaultDates();
    syncEditUi();
    render();
  });
}

let state = loadState();

async function init() {
  await wireCloudButtons();
  wireIntroOverlay();
  wireTabs();
  wireForms();
  wireChargeUnitAutoCalc();
  wireProviderDatalist();
  seedProvidersFromHistory();
  wireMonthPicker();
  wireListFilters();
  wireTrendMetric();
  wireDeleteButtons();
  wireEditCancelButtons();
  wireHipassNoteDefaultAndSelect();
  wireExportImportReset();

  setMonthPickerDefault();
  setDefaultDates();
  setHipassDefaultNoteIfEmpty();
  syncEditUi();
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  void init().catch((e) => console.error("init", e));
});

function openCloudSettingsDialog(dlg) {
  if (!dlg) return;
  if (typeof dlg.showModal === "function") {
    try {
      dlg.showModal();
    } catch (e) {
      dlg.setAttribute("open", "");
    }
  } else {
    dlg.setAttribute("open", "");
  }
}

async function wireCloudButtons() {
  try {
    cloud = loadCloudConfig();
    await tryLoadEncryptedPreset({ silent: true });
    applyCloudPreset();
  } catch (e) {
    console.warn("wireCloudButtons preset", e);
  }

  const btnPull = document.getElementById("btnCloudPull");
  const btnPush = document.getElementById("btnCloudPush");
  const btnSettings = document.getElementById("btnCloudSettings");
  const dlg = document.getElementById("cloudSettingsModal");
  const close = document.getElementById("btnCloseCloudSettings");
  const autosync = document.getElementById("ghAutosync");

  btnPull?.addEventListener("click", () => cloudLoad().catch((e) => setCloudStatus(String(e.message || e))));
  btnPush?.addEventListener("click", () => cloudSave("manual").catch((e) => setCloudStatus(String(e.message || e))));

  btnSettings?.addEventListener("click", () => {
    cloud = loadCloudConfig();
    updateCloudSettingsInputs();
    setCloudStatus(cloud.lastSyncAt ? `마지막 동기화: ${new Date(cloud.lastSyncAt).toLocaleString("ko-KR")}` : "토큰·자동 저장을 설정하세요.");
    openCloudSettingsDialog(dlg);
  });
  close?.addEventListener("click", () => {
    if (dlg && typeof dlg.close === "function") dlg.close();
    else dlg?.removeAttribute("open");
  });
  dlg?.addEventListener("click", (e) => {
    const rect = dlg.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      if (typeof dlg.close === "function") dlg.close();
      else dlg.removeAttribute("open");
    }
  });

  autosync?.addEventListener("change", () => {
    syncCloudBeforeApi();
    setCloudStatus(cloud.autosync ? "자동 저장 켜짐 · 변경 후 2초 뒤 커밋" : "자동 저장 꺼짐");
  });

  const tokenEl = document.getElementById("ghToken");
  tokenEl?.addEventListener("change", () => {
    syncCloudBeforeApi();
    setCloudStatus("토큰이 저장되었습니다.");
  });

  document.getElementById("btnPresetPassApply")?.addEventListener("click", async () => {
    const pass = (document.getElementById("ghPresetPass")?.value || "").trim();
    if (!pass) {
      setCloudStatus("프리셋 비밀번호를 입력하세요.");
      return;
    }
    persistPresetPassword(pass);
    const pe = document.getElementById("ghPresetPass");
    if (pe) pe.value = "";
    await tryLoadEncryptedPreset({ silent: false });
    applyCloudPreset();
    setCloudStatus(decryptedPresetCache ? "프리셋 적용 완료" : "복호화 실패 · 비밀번호 확인");
  });
}

let cloud = loadCloudConfig();
