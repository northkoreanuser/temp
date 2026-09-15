/* ============================================================================
   폴더별 태그(#hashtag.json) - 사용자 지시
   ----------------------------------------------------------------------------
   레포 탐색기(실제 저장소, 바탕화면/휴지통 제외)의 빈 곳을 우클릭하면 그 폴더 안의 파일/폴더
   리스트에 태그를 붙일 수 있다. 태그는 그 폴더 자신에 "#hashtag.json"이라는 이름으로 저장되고
   (같은 폴더 안에 있어야 함 - pages.json처럼 폴더별로 하나씩). 실제 저장소 파일이라 브라우저가
   직접 쓸 수는 없으므로:

   태그 json 저장 규칙 (사용자 지시):
   - 웹훅(로컬 헬퍼)이 켜져 있으면 웹훅으로만 저장 (폴더 선택 취소해도 브라우저로 안 넘어감)
   - 헬퍼가 아예 없을 때만 브라우저 다운로드로 고정

   로컬 헬퍼가 있으면 진짜 디스크의 같은 폴더 위치에 바로 저장한다.
   헬퍼가 없을 때만 브라우저로 #hashtag.json을 다운로드해서 사용자가 직접 넣도록 한다.

   #hashtag.json 형식: { "파일이름": ["태그1", "태그2"], "폴더이름": ["태그3"] }

   탐색기 검색(search-and-status.js)에서 이름뿐 아니라 태그와도 매치되도록 crawlAll이 폴더마다
   이 파일도 같이 읽어서 각 항목에 tags를 붙인다. pages.json 폴더 목록과 마찬가지로, 한 번 읽은
   #hashtag.json은 로컬 스토리지에도 저장해둬서(loadDir의 readCache/writeCache와 같은 패턴) 다음
   검색부터는 네트워크 요청 없이 바로 쓸 수 있다.
================================================================================= */

/* ---------------- 캐시(메모리 + 로컬 스토리지) ---------------- */
const tagDirCache = new Map(); // pathKey -> {파일/폴더이름: [태그, ...]}
function tagCacheKey(pathArr) { return `idx:${repoName}:tags:${pathArr.join("/")}`; }
function readTagCache(pathArr) {
  try {
    const raw = localStorage.getItem(tagCacheKey(pathArr));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function writeTagCache(pathArr, data) {
  try { localStorage.setItem(tagCacheKey(pathArr), JSON.stringify(data)); } catch (e) { /* 용량 초과 등은 무시 */ }
}
function clearTagCache(pathArr) {
  try { localStorage.removeItem(tagCacheKey(pathArr)); } catch (e) {}
  tagDirCache.delete(pathArr.join("/"));
}
// 폴더 하나의 #hashtag.json을 읽어온다 - 없으면(404 등) 빈 객체로 취급한다(에러가 아니라 "아직
// 태그가 없는 폴더"인 정상 상태). 바탕화면/휴지통(가상 파일시스템)은 태그 대상이 아니다.
async function loadFolderTags(pathArr) {
  if (isDfsPath(pathArr)) return {};
  const key = pathArr.join("/");
  if (tagDirCache.has(key)) return tagDirCache.get(key);
  const cached = readTagCache(pathArr);
  if (cached) { tagDirCache.set(key, cached); return cached; }
  const prefix = pathArr.map(encodeURIComponent).join("/");
  const url = (prefix ? prefix + "/" : "") + "#hashtag.json";
  let data = {};
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const parsed = await res.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
    }
  } catch (e) { /* 파일이 없거나 네트워크 오류 - 태그 없음으로 취급 */ }
  tagDirCache.set(key, data);
  writeTagCache(pathArr, data);
  return data;
}

/* ---------------- 로컬 헬퍼로 실제 디스크에 저장 ---------------- */
// 이 리포의 로컬 클론이 디스크 어디 있는지(base)를 한 번 물어보고 기억해둔다(다음 저장부터는
// 다시 묻지 않음) - #hashtag.json은 항상 "그 폴더 자신 위치"에 있어야 하므로, base + 폴더
// 경로(rel)를 그대로 이어붙이면 실제 저장소 폴더 구조와 정확히 같은 자리를 가리키게 된다.
function tagBaseRootKey() { return `idx:${repoName}:tagBaseRoot`; }
function getRememberedTagBaseRoot() {
  try { return localStorage.getItem(tagBaseRootKey()) || ""; } catch (e) { return ""; }
}
function setRememberedTagBaseRoot(v) {
  try {
    if (v) localStorage.setItem(tagBaseRootKey(), v);
    else localStorage.removeItem(tagBaseRootKey());
  } catch (e) {}
}
// 사용자가 "저장 위치 변경"을 누르면 다음 저장 때 다시 물어보게 한다.
function resetTagBaseRoot() {
  setRememberedTagBaseRoot("");
  showToast("태그 저장 위치를 다음 저장 때 다시 물어봅니다.");
}
async function ensureTagBaseRoot(port) {
  let base = getRememberedTagBaseRoot();
  if (base) return base;
  const res = await fetch(`http://127.0.0.1:${port}/pickfolder`);
  base = (await res.text()).trim();
  if (!base || base === "CANCELLED") return null;
  setRememberedTagBaseRoot(base);
  return base;
}
// pathArr 폴더의 #hashtag.json을 저장한다.
// 사용자 지시: 웹훅(로컬 헬퍼)이 켜져 있으면 웹훅으로만, 없으면 브라우저 다운로드로 고정.
// - 헬퍼가 있으면: 폴더 선택(한 번 기억) → /savecontentto로 저장. 폴더 선택 취소나 저장 실패 시
//   브라우저로 떨어지지 않고 그냥 취소/실패 처리.
// - 헬퍼가 아예 없을 때만: 브라우저로 #hashtag.json 다운로드.
// 호출하는 쪽은 이미 브라우저 캐시(tagDirCache/localStorage)를 먼저 갱신해두므로,
// 이 함수가 실패해도 지금 이 브라우저에서의 검색/표시는 정상 동작한다.
function downloadTagJsonInBrowser(pathArr, data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "#hashtag.json";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
  const where = pathArr.length ? pathArr.join("/") : "루트";
  showToast(`"#hashtag.json"을(를) 다운로드했습니다. 저장소의 "${where}" 폴더에 넣어 주세요.`, { sound: "download_complete" });
}
async function saveFolderTagsViaHelper(pathArr, data) {
  // 사용자 지시: 웹훅(헬퍼)이 켜져 있으면 웹훅으로만, 없으면 브라우저 다운로드로 고정.
  // 폴더 선택 창을 취소해도 브라우저로 넘어가지 않는다. (취소 = 그냥 저장 취소)
  const port = await ensureHelperPort();
  if (port === null) {
    // 헬퍼가 아예 없을 때만 브라우저 다운로드
    downloadTagJsonInBrowser(pathArr, data);
    return false;
  }

  const base = await ensureTagBaseRoot(port);
  if (!base) {
    // 폴더 선택 취소 → 저장 자체를 취소 (브라우저로 떨어지지 않음)
    showToast("저장 위치 선택이 취소되었습니다.", { sound: "download_cancel" });
    return false;
  }

  const rel = (pathArr.length ? pathArr.join("/") + "/" : "") + "#hashtag.json";
  try {
    const body = JSON.stringify(data, null, 2);
    const res = await fetch(`http://127.0.0.1:${port}/savecontentto?base=${encodeURIComponent(base)}&rel=${encodeURIComponent(rel)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body
    });
    if (!res.ok) throw new Error(String(res.status));
    showToast(`"#hashtag.json"을(를) 저장했습니다. (${pathArr.join("/") || "루트"})`, { sound: "download_complete" });
    return true;
  } catch (e) {
    // 헬퍼는 살아 있는데 저장만 실패한 경우 → 브라우저로 대체하지 않고 실패만 알림
    showToast(`헬퍼 저장 실패 (${e.message}).`, { kind: "warn", sound: "download_error" });
    return false;
  }
}

/* ---------------- 태그 문자열 <-> 배열 ---------------- */
// 쉼표/공백 아무 걸로나 구분해서 입력할 수 있게 하고, 앞의 "#"는 있어도 없어도 되게 떼어낸다.
function parseTagsInput(text) {
  return Array.from(new Set(
    (text || "").split(/[,\s]+/).map(s => s.trim().replace(/^#+/, "")).filter(Boolean)
  ));
}

/* ---------------- 태그 편집 대화상자 ---------------- */
// 레포 탐색기 빈 곳 우클릭 -> "태그 편집"에서 호출된다. 지금 폴더 안의 파일/폴더 전부를 한 화면에
// 나열하고, 각 항목 옆의 입력창에 태그를 쉼표/공백으로 구분해 적을 수 있다. 저장하면 브라우저
// 캐시부터 즉시 갱신(그래야 저장 직후 검색에도 바로 반영)한 뒤, 로컬 헬퍼로 실제 파일 저장을
// 시도한다.
async function openTagEditorForFolder(pathArr) {
  let entry;
  try {
    entry = await loadDir(pathArr);
  } catch (e) {
    showToast(`폴더를 불러오지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
    return;
  }
  const items = [
    ...entry.folders.map(name => ({ name, type: "folder" })),
    ...entry.files.map(f => ({ name: f.name, type: "file" }))
  ];
  const existing = await loadFolderTags(pathArr);
  if (!items.length) { showToast("태그를 붙일 파일/폴더가 없습니다."); return; }

  const previouslyFocused = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-panel" style="width:min(560px, 90vw);">
      <div class="confirm-message">태그 편집 - ${escapeHtml(pathArr.length ? pathArr.join("/") : (repoName || "루트"))}</div>
      <div class="tag-editor-rows" style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin:4px 0;"></div>
      <div style="font-size:11.5px;opacity:.7;">쉼표 또는 공백으로 여러 태그를 구분해서 적으세요. (예: 웹, html, js)</div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="settings-button settings-button-neutral tag-editor-reset-root" style="font-size:11.5px;">태그 저장 위치 변경</button>
      </div>
      <div class="confirm-buttons">
        <button class="settings-button settings-button-neutral confirm-cancel">취소</button>
        <button class="settings-button confirm-ok">저장</button>
      </div>
    </div>`;
  const rowsEl = overlay.querySelector(".tag-editor-rows");
  const rowInputs = new Map(); // name -> input
  items.forEach(it => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;";
    const icon = it.type === "folder" ? resolveFolderIcon([...pathArr, it.name], 18, false) : resolveFileIcon(it.name, 18, [...pathArr, it.name]);
    row.innerHTML = `
      <span style="flex:0 0 auto;display:inline-flex;">${icon}</span>
      <span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
      <input type="text" class="confirm-input tag-editor-input" style="flex:0 0 55%;" placeholder="태그 없음" spellcheck="false">`;
    const input = row.querySelector(".tag-editor-input");
    input.value = (existing[it.name] || []).join(", ");
    input.addEventListener("keydown", (e) => e.stopPropagation());
    rowInputs.set(it.name, input);
    rowsEl.appendChild(row);
  });
  document.body.appendChild(overlay);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (previouslyFocused && document.body.contains(previouslyFocused) && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  };
  overlay.querySelector(".confirm-cancel").onclick = cleanup;
  overlay.querySelector(".tag-editor-reset-root").onclick = () => resetTagBaseRoot();
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cleanup(); });
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cleanup(); } }
  document.addEventListener("keydown", onKey, true);
  overlay.querySelector(".confirm-ok").onclick = async () => {
    const data = {};
    for (const [name, input] of rowInputs) {
      const tags = parseTagsInput(input.value);
      if (tags.length) data[name] = tags;
    }
    // 브라우저 쪽 캐시부터 즉시 반영 - 헬퍼 저장이 실패해도 이번 세션의 검색은 바로 새 태그를 쓴다.
    tagDirCache.set(pathArr.join("/"), data);
    writeTagCache(pathArr, data);
    indexPromiseCache.clear(); // 검색 인덱스(crawlAll 결과)도 새로 반영되도록 캐시를 비운다
    cleanup();
    await saveFolderTagsViaHelper(pathArr, data);
  };
  requestAnimationFrame(() => {
    const first = rowsEl.querySelector(".tag-editor-input");
    if (first) first.focus();
  });
}
