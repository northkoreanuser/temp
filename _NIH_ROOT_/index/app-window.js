/* ============================================================================
   범용 "앱 내 창" (요청 #135/#136)
   ----------------------------------------------------------------------------
   예전에는 에디터/메뉴 메이커가 완전히 별개의 브라우저 새 탭(about:blank + document.write)으로
   열렸다. 사용자 지시로 이제 이 앱 자기 자신의 문서 안에 "진짜 창처럼" 뜨는 패널로 바꾼다.
   탐색기 창(#win, window-chrome.js)이 이미 쓰고 있는 .window/.titlebar/.tb-btn/.rz-* CSS
   클래스를 그대로 재사용하므로(8개 스킨 style.css 전부가 이 클래스들을 기준으로 스타일을 입힘),
   새 창 종류를 추가해도 스킨별 CSS를 하나도 새로 만들 필요가 없다.

   #win과 다른 점: 이 창들은 "작업표시줄에 아이콘이 있는 메인 앱"이 아니라 도구 창이므로
   최소화/작업표시줄 통합이 없고, 최대화도 없다(요청 범위 밖) - 대신 이동(드래그)과 크기조절
   (리사이즈), 닫기만 제공한다. #win과 달리 여러 개가 동시에 뜰 수 있어야 하므로(에디터로 파일을
   여러 개 열 수 있음) 고정 DOM 하나가 아니라, 열 때마다 새 .window 엘리먼트를 만들어 문서에
   붙인다(dfCreateAppWindow). 메뉴 메이커처럼 한 번에 하나만 떠야 하는 창은 호출하는 쪽(menu-maker.js)
   에서 기존 핸들을 기억해뒀다가 재사용/포커스하는 식으로 싱글턴을 스스로 지킨다.
================================================================================= */

// #win의 z-index(2)보다 항상 위에 오도록 10부터 시작 - 새 창을 열거나 클릭(포커스)할 때마다 +1
// 해서 맨 위로 올린다(실제 윈도우처럼 마지막에 만진 창이 위로 옴).
let dfAppWinZTop = 10;
let dfAppWinOpenCount = 0;
function dfAppWinBringToFront(win) {
  dfAppWinZTop++;
  win.style.zIndex = String(dfAppWinZTop);
}

// 여러 창(에디터 여러 개 + 메뉴 메이커)에 걸쳐 "저장 안 한 내용이 있는지"를 한 곳에 모아두고,
// 페이지 전체의 beforeunload에서 한 번만 확인한다 - 예전에는 각 탭이 자기 자신의 window에
// beforeunload를 따로 걸었지만, 이제 전부 같은 문서 안에 있으므로 그렇게 하면 안 걸린 창의 닫기까지
// 전부 걸려버린다(전역이라).
const dfAppWinRegistry = new Set();
window.addEventListener("beforeunload", (e) => {
  for (const h of dfAppWinRegistry) {
    try { if (h.isDirty && h.isDirty()) { e.preventDefault(); e.returnValue = ""; return; } } catch (err) { /* 무시 */ }
  }
});

// CSS를 여러 창이 공유해서 딱 한 번만 <head>에 넣어야 하는 경우(에디터/메뉴 메이커 각각 자기
// 스타일을 처음 열 때 한 번만 주입) 쓰는 작은 헬퍼. 같은 id로 다시 부르면 조용히 아무 것도 안 한다.
function dfInjectStyleOnce(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/* ============ 창 이동(드래그) - #win의 setupWindowDrag(window-chrome.js)와 같은 동작이지만,
   고정된 els.win이 아니라 인자로 받은 임의의 창 엘리먼트에 대해 동작하도록 일반화했다. 이 창들은
   최대화가 없으므로 그 분기만 뺐다. ============ */
function dfSetupAppWindowDrag(win, titlebar) {
  let dragging = false, startX = 0, startY = 0, winStartLeft = 0, winStartTop = 0;
  titlebar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".tb-btn")) return; // 닫기 버튼 클릭은 드래그가 아님
    dragging = true;
    const rect = win.getBoundingClientRect();
    winStartLeft = rect.left;
    winStartTop = rect.top;
    win.style.left = winStartLeft + "px";
    win.style.top = winStartTop + "px";
    startX = e.clientX;
    startY = e.clientY;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = win.getBoundingClientRect();
    const minVisible = 80;
    let newLeft = winStartLeft + dx;
    let newTop = winStartTop + dy;
    newLeft = Math.max(-(rect.width - minVisible), Math.min(newLeft, window.innerWidth - minVisible));
    const TASKBAR_H = 48, TITLEBAR_H = 40;
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - TASKBAR_H - TITLEBAR_H));
    win.style.left = newLeft + "px";
    win.style.top = newTop + "px";
  });
  window.addEventListener("mouseup", () => { dragging = false; });
}

/* ============ 창 크기 조절(리사이즈) - window-chrome.js의 setupWindowResize와 같은 동작을
   임의의 창 엘리먼트에 대해 일반화했다(최대화 관련 분기만 없음). ============ */
function dfSetupAppWindowResize(win) {
  const MIN_W = 420, MIN_H = 280;
  const TASKBAR_H = 48;
  [
    ["rz-n", "n"], ["rz-s", "s"], ["rz-e", "e"], ["rz-w", "w"],
    ["rz-ne", "ne"], ["rz-nw", "nw"], ["rz-se", "se"], ["rz-sw", "sw"],
  ].forEach(([cls, dir]) => {
    const handle = win.querySelector("." + cls);
    if (!handle) return;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = win.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const startW = rect.width, startH = rect.height, startLeft = rect.left, startTop = rect.top;
      win.classList.add("resizing");
      win.style.left = startLeft + "px";
      win.style.top = startTop + "px";
      const maxW = window.innerWidth;
      const maxH = window.innerHeight - TASKBAR_H;
      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;
        if (dir.includes("e")) newW = Math.max(MIN_W, Math.min(startW + dx, maxW));
        if (dir.includes("s")) newH = Math.max(MIN_H, Math.min(startH + dy, maxH));
        if (dir.includes("w")) { newW = Math.max(MIN_W, Math.min(startW - dx, maxW)); newLeft = startLeft + (startW - newW); }
        if (dir.includes("n")) { newH = Math.max(MIN_H, Math.min(startH - dy, maxH)); newTop = startTop + (startH - newH); }
        win.style.width = newW + "px";
        win.style.height = newH + "px";
        win.style.left = newLeft + "px";
        win.style.top = newTop + "px";
      }
      function onUp() {
        win.classList.remove("resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  });
}

/* ============ 창 만들기 ============
   opts:
     - title: 타이틀바 문구
     - icon: 타이틀바 아이콘(이모지, 기본 🛠)
     - width/height: 초기 크기(px)
     - bodyHtml: 본문에 넣을 HTML 문자열
     - isDirty(): 저장 안 한 내용이 있는지(있으면 true) - beforeunload/닫기 확인에 쓰임
     - confirmClose(): 닫기(✕) 버튼을 눌렀을 때 실제로 닫아도 되는지 - Promise<boolean> 또는
       boolean을 반환. 생략하면 항상 즉시 닫힘.
     - onClose(): 닫힌 뒤(DOM에서 제거된 뒤) 호출되는 정리 콜백(선택)
   반환값: { el, bodyEl, close(), focus() } */
function dfCreateAppWindow(opts) {
  const win = document.createElement("div");
  win.className = "window app-win";
  const width = opts.width || 900, height = opts.height || 640;
  win.style.width = width + "px";
  win.style.height = height + "px";
  win.innerHTML =
    '<div class="rz rz-n"></div><div class="rz rz-s"></div><div class="rz rz-e"></div><div class="rz rz-w"></div>' +
    '<div class="rz rz-ne"></div><div class="rz rz-nw"></div><div class="rz rz-se"></div><div class="rz rz-sw"></div>' +
    '<div class="titlebar app-win-titlebar">' +
      '<div class="tb-icon"></div>' +
      '<div class="tb-title"></div>' +
      '<div class="tb-controls"><button class="tb-btn tb-close" title="닫기">&#x2715;</button></div>' +
    '</div>' +
    '<div class="app-win-body"></div>';
  // 요청: opts.icon이 이모지뿐 아니라 커스텀 아이콘의 <img> HTML도 올 수 있으므로(resolveSettingsIconHtml
  // 등) textContent 대신 innerHTML로 넣는다 - textContent였을 때는 HTML 태그가 그대로 화면에 글자로
  // 찍혀버렸다(이스케이프됨). 호출부에서 넘기는 값은 전부 고정 이모지이거나 escapeHtml을 거친 안전한
  // HTML(customImgIcon)뿐이라 innerHTML로 바꿔도 안전하다.
  win.querySelector(".tb-icon").innerHTML = opts.icon || "\u{1F6E0}️";
  win.querySelector(".tb-title").textContent = opts.title || "";
  const bodyEl = win.querySelector(".app-win-body");
  // .titlebar가 flex:0 0 40px로 고정폭이므로, 본문이 나머지 공간을 다 채우게 하는 이 규칙은
  // 스킨마다 다를 이유가 없는 순수 레이아웃이다 - 8개 테마 style.css를 건드리지 않고 인라인으로 준다.
  bodyEl.style.cssText = "flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;";
  if (opts.bodyHtml) bodyEl.innerHTML = opts.bodyHtml;

  // 처음부터 고정 좌표로 띄운다(#win과 달리 desktop의 flex 중앙정렬에 얹혀 있다가 나중에
  // positioned로 바뀌는 게 아니라, 매번 새로 만드는 창이라 처음부터 화면 중앙 근처에 놓는다).
  // 여러 개를 겹쳐 열어도 전부 한 자리에 완전히 겹치지 않도록 열 때마다 살짝 어긋나게 배치한다.
  win.classList.add("positioned");
  const TASKBAR_H = 48;
  const offset = (dfAppWinOpenCount++ % 6) * 28;
  win.style.left = Math.max(16, (window.innerWidth - width) / 2 + offset) + "px";
  // 요청 #136에서 발견: 창(특히 메뉴 메이커처럼 키가 큰 창)의 세로 크기가 "화면 높이 - 작업표시줄"보다
  // 크거나, 여러 창이 열려 offset이 누적되면 처음 뜨는 위치 자체가 작업표시줄과 겹칠 수 있다 -
  // 작업표시줄(z-index 10)보다 창(z-index 11+)이 항상 위라서 겹치면 트레이 아이콘 클릭이 막힌다.
  // 그래서 위쪽 여백(16px)보다 "작업표시줄을 절대 덮지 않는 것"을 우선한다(마지막에 maxTop으로
  // 다시 한번 눌러서, 창이 너무 커서 maxTop이 16보다 작아지는 경우에도 작업표시줄 겹침을 막는다).
  const maxTop = window.innerHeight - TASKBAR_H - height;
  let top = Math.max(16, maxTop / 2 + offset);
  top = Math.min(top, maxTop);
  win.style.top = top + "px";

  document.body.appendChild(win);
  dfAppWinBringToFront(win);
  win.addEventListener("mousedown", () => dfAppWinBringToFront(win));

  const handle = { el: win, bodyEl, isDirty: opts.isDirty || (() => false) };
  dfAppWinRegistry.add(handle);
  function close() {
    dfAppWinRegistry.delete(handle);
    win.remove();
    if (opts.onClose) { try { opts.onClose(); } catch (e) { /* 무시 */ } }
  }
  win.querySelector(".tb-close").onclick = async () => {
    if (opts.confirmClose) {
      let ok;
      try { ok = await opts.confirmClose(); } catch (e) { ok = true; }
      if (!ok) return;
    }
    close();
  };
  handle.close = close;
  handle.focus = () => dfAppWinBringToFront(win);

  dfSetupAppWindowDrag(win, win.querySelector(".app-win-titlebar"));
  dfSetupAppWindowResize(win);

  return handle;
}
