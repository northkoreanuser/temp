/* ============ 창 조작 (최소화/최대화/닫기) ============
   - 최소화: 닫기처럼 창이 사라지지만, 작업표시줄 아이콘의 활성 표시는 그대로 유지된다(실제 윈도우처럼).
   - 닫기: 창이 사라지고 작업표시줄 아이콘의 활성 표시도 꺼진다.
   - 닫은 뒤에도 닫기 전 위치/트리 펼침 상태는 그대로 기억해두고 있다가, 작업표시줄 아이콘을
     클릭해 다시 열면 항상 그 상태로 이어서 연다("이전 위치 열기"가 기본이자 유일한 동작 - 예전엔
     환경설정에 끄고 켤 수 있는 별도 옵션이 있었지만 없앴다).
================================================================== */
els.btnMin.onclick = () => { els.win.classList.add("minimized"); dfsPlaySound("window_minimize"); };
// 드래그로 옮긴 위치(position:fixed의 left/top 인라인 스타일)는 최대화하면 잠깐 지워야
// (.maximized 클래스의 top:0/left:0을 인라인 스타일이 덮어써버리면 꽉 채워지지 않음) 온전히 꽉 찬다.
// 최대화를 풀면 그 위치를 되돌려서 이어서 옮긴 자리에 복귀한다(실제 창처럼).
let lastDragPos = null; // { left, top } - 최대화 직전에 드래그로 옮겨져 있었으면 그 좌표를 기억
function toggleMaximize() {
  const willMaximize = !els.win.classList.contains("maximized");
  if (willMaximize) {
    if (els.win.classList.contains("positioned")) {
      lastDragPos = { left: els.win.style.left, top: els.win.style.top };
      els.win.style.left = "";
      els.win.style.top = "";
    }
    els.win.classList.add("maximized");
  } else {
    els.win.classList.remove("maximized");
    if (lastDragPos) {
      els.win.style.left = lastDragPos.left;
      els.win.style.top = lastDragPos.top;
      lastDragPos = null;
    }
  }
  els.btnMax.innerHTML = els.win.classList.contains("maximized") ? "&#x2752;" : "&#x25A1;";
  dfsPlaySound("window_maximize_restore");
}
els.btnMax.onclick = toggleMaximize;
els.titlebar.addEventListener("dblclick", toggleMaximize);

/* ============ 창 이동(드래그) - 최대화 상태가 아닐 때만, 타이틀바를 눌러서 옮긴다 ============ */
(function setupWindowDrag() {
  let dragging = false, startX = 0, startY = 0, winStartLeft = 0, winStartTop = 0;
  els.titlebar.addEventListener("mousedown", (e) => {
    if (els.win.classList.contains("maximized")) return; // 최대화 상태에서는 이동하지 않음
    if (e.target.closest(".tb-btn")) return; // 최소화/최대화/닫기 버튼 클릭은 드래그가 아님
    dragging = true;
    const rect = els.win.getBoundingClientRect();
    if (!els.win.classList.contains("positioned")) {
      // 처음 드래그하는 순간, 지금 화면에 보이는 위치를 그대로 고정 좌표로 바꿔서 이어서 움직이게 한다
      // (그전까지는 desktop의 flex 중앙 정렬로 위치가 잡혀 있었음).
      els.win.classList.add("positioned");
    }
    winStartLeft = rect.left;
    winStartTop = rect.top;
    els.win.style.left = winStartLeft + "px";
    els.win.style.top = winStartTop + "px";
    startX = e.clientX;
    startY = e.clientY;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = els.win.getBoundingClientRect();
    const minVisible = 80; // 화면 밖으로 완전히 사라지지 않게 최소한은 보이게 남겨둔다
    let newLeft = winStartLeft + dx;
    let newTop = winStartTop + dy;
    newLeft = Math.max(-(rect.width - minVisible), Math.min(newLeft, window.innerWidth - minVisible));
    // 세로는 타이틀바(40px)가 작업표시줄(48px, 뷰포트 하단에 고정) 위로 항상 완전히 남아있게 막는다 -
    // 이전엔 window.innerHeight - 40까지 내려갈 수 있어서 타이틀바 전체가 작업표시줄 뒤로 숨어버려
    // 창을 다시 끌어올릴 수단이 없어지는(=창을 못 쓰게 되는) 문제가 있었다.
    const TASKBAR_H = 48, TITLEBAR_H = 40;
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - TASKBAR_H - TITLEBAR_H));
    els.win.style.left = newLeft + "px";
    els.win.style.top = newTop + "px";
  });
  window.addEventListener("mouseup", () => { dragging = false; });
})();

/* ============ 창 크기 조절(리사이즈) - 실제 윈도우처럼 가장자리/모서리를 끌어서 크기를 바꾼다 ============ */
(function setupWindowResize() {
  const MIN_W = 480, MIN_H = 320;
  const TASKBAR_H = 48;
  [
    ["rz-n", "n"], ["rz-s", "s"], ["rz-e", "e"], ["rz-w", "w"],
    ["rz-ne", "ne"], ["rz-nw", "nw"], ["rz-se", "se"], ["rz-sw", "sw"],
  ].forEach(([cls, dir]) => {
    const handle = els.win.querySelector("." + cls);
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      if (els.win.classList.contains("maximized")) return;
      e.preventDefault();
      e.stopPropagation(); // 타이틀바 드래그(이동)과 겹치지 않게

      const rect = els.win.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const startW = rect.width, startH = rect.height, startLeft = rect.left, startTop = rect.top;
      if (!els.win.classList.contains("positioned")) {
        // 드래그로 옮긴 적이 없어 아직 desktop의 flex 중앙 정렬로 잡혀 있던 상태라면, 지금 위치를
        // 고정 좌표로 못박아야 한쪽 가장자리를 고정한 채 반대쪽만 늘이고 줄일 수 있다.
        els.win.classList.add("positioned");
      }
      els.win.classList.add("resizing");
      els.win.style.left = startLeft + "px";
      els.win.style.top = startTop + "px";

      const maxW = window.innerWidth;
      const maxH = window.innerHeight - TASKBAR_H;

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;
        if (dir.includes("e")) newW = Math.max(MIN_W, Math.min(startW + dx, maxW));
        if (dir.includes("s")) newH = Math.max(MIN_H, Math.min(startH + dy, maxH));
        if (dir.includes("w")) {
          newW = Math.max(MIN_W, Math.min(startW - dx, maxW));
          newLeft = startLeft + (startW - newW);
        }
        if (dir.includes("n")) {
          newH = Math.max(MIN_H, Math.min(startH - dy, maxH));
          newTop = startTop + (startH - newH);
        }
        els.win.style.width = newW + "px";
        els.win.style.height = newH + "px";
        els.win.style.left = newLeft + "px";
        els.win.style.top = newTop + "px";
      }
      function onUp() {
        els.win.classList.remove("resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
})();

els.btnClose.onclick = () => {
  els.win.classList.add("closed");
  dfsPlaySound("window_close");
  els.taskbarApp.classList.remove("active");
  // 요청 #161 이전에는 창을 닫으면 "마지막 위치 기억"(lastPathKey/expandedStorageKey)까지 함께
  // 지워서 다음에 열면 항상 루트+트리 접힘으로 돌아갔다. 이제는 닫아도 그 기록을 그대로 남겨둔다 -
  // 작업표시줄 아이콘을 클릭하면(taskbarApp.onclick) 항상 그 기록으로 되살아난다.
  // 주소창 플래그먼트는 여전히 지운다 - 지금 창을 닫았다는 사실 자체는 주소로 남을 이유가 없다.
  // "창을 닫아뒀었다"는 사실도 기억해서(persistWindowOpen(false)), 다음 페이지 로드 때는 아예
  // 창을 띄우지 않는다(사용자 지시 - "진짜 윈도우 바이브").
  closeNavPane();
  clearHashFragment();
  persistWindowOpen(false);
};
// 요청 #161: 닫혀 있던 창을 다시 열 때 루트로 갈지, 닫기 전 마지막 위치(+트리 펼침 상태)로
// 돌아갈지 - bootstrap.js의 main()이 "창이 열려 있던 채로 새로고침"할 때 쓰는 것과 같은 복원
// 로직을 재사용한다(중복 구현 방지).
async function reopenExplorerAtLastLocation() {
  const hashExpanded = hashToExpandedSet(location.hash);
  expanded = (hashExpanded && hashExpanded.size) ? hashExpanded : loadExpandedFromStorage();
  await Promise.all([...expanded].map(key => loadDir(key.split("/").filter(Boolean)).catch(() => {})));
  if (dfsDb) await Promise.all([loadDir([DESKTOP_TREE_NAME]).catch(() => {}), loadDir([RECYCLEBIN_TREE_NAME]).catch(() => {})]);
  openNavPaneRespectingHash();
  let initialPath = hashToPath(location.hash);
  if (!initialPath) {
    try {
      const remembered = JSON.parse(localStorage.getItem(lastPathKey()) || "null");
      if (Array.isArray(remembered)) initialPath = remembered;
    } catch (e) { /* 무시 */ }
  }
  const resolved = await resolveInitialPath(initialPath || []);
  await navigate(resolved);
}
els.taskbarApp.onclick = () => {
  const wasClosed = els.win.classList.contains("closed");
  const wasHidden = wasClosed || els.win.classList.contains("minimized");
  els.win.classList.remove("closed", "minimized");
  els.taskbarApp.classList.add("active");
  persistWindowOpen(true);
  if (wasHidden) dfsPlaySound("window_open");
  // 요청: "작업 표시줄 탐색기 클릭시 이전 위치 열기 = 기본값(누르면 자동 동작)" - 예전엔 환경설정의
  // "이전 위치에서 시작"이 꺼져 있으면(기본값) 루트로 열렸는데, 이제 그 설정 자체를 없애고 항상
  // 닫기 전 마지막 위치(+트리 펼침 상태)에서 이어서 연다.
  if (wasClosed) reopenExplorerAtLastLocation();
};
// 요청 #130: 작업표시줄의 탐색기 아이콘을 우클릭하면 실제 윈도우처럼 최소화/최대화(또는 복원)/
// 닫기를 제공한다(소소한 디테일 흉내). "닫기"는 실제 X 버튼과 똑같이 곧바로 닫는다 - 확인창(요청 #127)은
// 실수로 눌리기 쉬운 키보드 단축키(Ctrl+W/Alt+W)에만 필요한 안전장치이고, 메뉴에서 명시적으로
// "닫기"를 고르는 것은 X 버튼 클릭과 같은 성격의 의도적인 동작이라 그대로 즉시 닫는다.
// 요청 #161: 창이 닫혀 있을 때도(예전엔 메뉴 자체를 안 띄웠음) 우클릭하면 "열기"를 고를 수 있게
// 한다. 요청: 클릭 자체가 이미 항상 "이전 위치 열기"와 같은 동작이 되면서 별도의 "이전 위치
// 열기" 메뉴 항목은 중복이라 제거했다("열기" 하나만 남는다 - 눌러도 결과는 같다).
els.taskbarApp.oncontextmenu = (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (els.win.classList.contains("closed")) {
    showContextMenu(e.clientX, e.clientY, [
      { label: "열기", action: () => els.taskbarApp.onclick() }
    ]);
    return;
  }
  const isMax = els.win.classList.contains("maximized");
  showContextMenu(e.clientX, e.clientY, [
    { label: "최소화", action: () => els.btnMin.onclick() },
    { label: isMax ? "복원" : "최대화", action: () => toggleMaximize() },
    { label: "닫기", action: () => els.btnClose.onclick() }
  ]);
};
// 요청 #167: 작업표시줄의 빈 자리(시작 버튼/탐색기 아이콘/트레이 그 어디도 아닌 곳)를 우클릭해도
// 여태 아무 메뉴가 없어서 밋밋했다는 지적 - 실제 윈도우 작업표시줄 우클릭 메뉴에서 이 앱에 실제로
// 대응되는 기능이 있는 항목만 골라 넣는다("창 계단식/세로/가로 정렬"처럼 창이 하나뿐이라 의미
// 없는 항목, "작업 표시줄 잠금"처럼 이 앱에서는 아무 효과도 없을 항목은 일부러 뺐다 - 눌러도 아무
// 일도 안 일어나는 가짜 메뉴를 넣는 것보단 낫다는 판단). "아이콘 편집기"는 사용자 지시로 별도 추가.
els.taskbar.oncontextmenu = (e) => {
  e.preventDefault();
  const items = [
    // 실제 윈도우의 "바탕 화면 보기"처럼, 다시 누르면 원래대로 되돌아오는 토글이다(창이 없으면
    // 이미 바탕화면만 보이는 상태이므로 할 일이 없다 - 항목 자체를 흐리게 하기보다 조용히 무시).
    { label: "바탕 화면 보기", action: () => {
      if (els.win.classList.contains("closed")) return;
      if (els.win.classList.contains("minimized")) els.taskbarApp.onclick();
      else els.btnMin.onclick();
    } },
  ];
  if (typeof dfsOpenMenuMakerInWindow === "function") {
    // 사용자 지시: 작업표시줄 우클릭 메뉴에 아이콘 편집기(메뉴 메이커의 아이콘 탭)도 넣기.
    items.push({ label: "아이콘 편집기", action: () => dfsOpenMenuMakerInWindow({ initialTab: "icon" }) });
    // 요청 #137과 같은 맥락(시작 메뉴/트레이 우클릭에도 있음) - 메뉴 메이커 전체로도 바로 갈 수 있게.
    items.push({ label: "메뉴 메이커", action: () => dfsOpenMenuMakerInWindow() });
  }
  if (typeof dfsOpenSettingsWindow === "function") {
    items.push({ label: "작업 표시줄 설정", action: () => dfsOpenSettingsWindow() });
  }
  showContextMenu(e.clientX, e.clientY, items);
};
/* 바탕화면(가상 파일시스템)에서 폴더를 열 때도 더는 별도의 팝업 창이 아니라 이 "진짜" 탐색기
   창(#win) 하나로 통합해서 보여준다(탐색기 통합 - 사용자 지시). 창이 닫혀있었으면 taskbarApp을
   누른 것과 똑같이 다시 열어준다. */
function openRealExplorerAt(path) {
  const wasClosed = els.win.classList.contains("closed");
  const wasHidden = wasClosed || els.win.classList.contains("minimized");
  els.win.classList.remove("closed", "minimized");
  els.taskbarApp.classList.add("active");
  persistWindowOpen(true);
  if (wasHidden) dfsPlaySound("window_open");
  if (wasClosed) expanded.clear();
  navigate(path);
  openNavPaneRespectingHash();
}
els.btnNavToggle.onclick = () => { if (isNavPaneOpen()) closeNavPane(); else openNavPane(); };

/* ============ 로컬 스토리지 (폴더 캐시 + 마지막 경로 기억) ============
   - 폴더 하나를 읽을 때마다 로컬 스토리지에 계속 쌓인다 (무한 누적).
   - 새로고침 버튼을 누르면 "그 폴더"만 캐시를 비우고 다시 읽는다.
================================================================== */
function cacheKey(pathArr) { return `idx:${repoName}:dir:${pathArr.join("/")}`; }
function lastPathKey() { return `idx:${repoName}:lastpath`; }
/* 탐색기 창을 "켠 채로" 뒀는지(=닫지 않고 새로고침/재방문했는지) 기억한다(사용자 지시). 진짜
   윈도우처럼 최초 방문이나 명시적으로 닫은 뒤에는 창을 자동으로 띄우지 않고, 켜둔 채로 새로고침한
   경우에만 편의상 열린 상태 그대로(+ 위치/트리 펼침) 복원한다. */
function windowOpenKey() { return `idx:${repoName}:winopen`; }
function persistWindowOpen(isOpen) {
  try {
    if (isOpen) localStorage.setItem(windowOpenKey(), "1");
    else localStorage.removeItem(windowOpenKey());
  } catch (e) {}
}
function wasWindowOpenLastTime() {
  try { return localStorage.getItem(windowOpenKey()) === "1"; } catch (e) { return false; }
}
function readCache(pathArr) {
  try {
    const raw = localStorage.getItem(cacheKey(pathArr));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function writeCache(pathArr, entry) {
  try { localStorage.setItem(cacheKey(pathArr), JSON.stringify(entry)); } catch (e) { /* 용량 초과 등은 무시 */ }
}
function clearCache(pathArr) {
  try { localStorage.removeItem(cacheKey(pathArr)); } catch (e) {}
  dirCache.delete(pathArr.join("/"));
}

