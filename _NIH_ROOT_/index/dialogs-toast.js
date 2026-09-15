/* ============ 커스텀 확인/입력 대화상자 (브라우저 기본 alert/confirm/prompt 대신) ============
   사용자 지시: 파일 삭제 등의 확인창은 브라우저 자체 알림이 아니라 이 앱의 다른 창들처럼
   CSS로 만든 대화상자로 띄운다. showConfirmDialog는 Promise<boolean>, showPromptDialog는
   Promise<string|null>을 반환한다(취소/배경 클릭/Esc = false 또는 null). ============ */
function showConfirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    // 대화상자를 열기 전 포커스가 있던 요소(탐색기 내용창/트리/바탕화면 등)를 기억해뒀다가,
    // 닫힐 때(확인/취소/Esc/배경 클릭 어느 경로든) 그대로 돌려준다. 이걸 안 하면 대화상자가
    // overlay.remove()로 사라진 뒤 포커스가 document.body로 떨어져서, 예를 들어 F2로 이름
    // 변경하다 Esc로 취소했을 때 창에 포커스가 안 돌아와 방향키가 먹통이 되는 버그가 생긴다.
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-panel">
        <div class="confirm-message"></div>
        <div class="confirm-buttons">
          <button class="settings-button settings-button-neutral confirm-cancel"></button>
          <button class="settings-button confirm-ok"></button>
        </div>
      </div>`;
    overlay.querySelector(".confirm-message").textContent = message;
    overlay.querySelector(".confirm-cancel").textContent = opts.cancelLabel || "취소";
    overlay.querySelector(".confirm-ok").textContent = opts.okLabel || "확인";
    document.body.appendChild(overlay);
    let done = false;
    const cleanup = (result) => {
      if (done) return;
      done = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      if (previouslyFocused && document.body.contains(previouslyFocused) && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };
    overlay.querySelector(".confirm-cancel").onclick = () => cleanup(false);
    overlay.querySelector(".confirm-ok").onclick = () => cleanup(true);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cleanup(false); });
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cleanup(false); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cleanup(true); }
    }
    document.addEventListener("keydown", onKey, true);
    overlay.querySelector(".confirm-ok").focus();
  });
}
function showPromptDialog(message, defaultValue = "") {
  return new Promise(resolve => {
    // showConfirmDialog와 동일한 이유로, 열기 전 포커스를 기억해뒀다가 닫힐 때 돌려준다
    // (F2 이름 변경 -> Esc 취소 후 방향키가 안 먹는 버그의 원인이었다).
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-panel">
        <div class="confirm-message"></div>
        <input type="text" class="confirm-input" spellcheck="false">
        <div class="confirm-buttons">
          <button class="settings-button settings-button-neutral confirm-cancel">취소</button>
          <button class="settings-button confirm-ok">확인</button>
        </div>
      </div>`;
    overlay.querySelector(".confirm-message").textContent = message;
    const input = overlay.querySelector(".confirm-input");
    input.value = defaultValue;
    document.body.appendChild(overlay);
    let done = false;
    const cleanup = (result) => {
      if (done) return;
      done = true;
      overlay.remove();
      if (previouslyFocused && document.body.contains(previouslyFocused) && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };
    overlay.querySelector(".confirm-cancel").onclick = () => cleanup(null);
    overlay.querySelector(".confirm-ok").onclick = () => cleanup(input.value);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cleanup(null); });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // 전역 백스페이스=뒤로가기 핸들러 등이 이 입력창의 타이핑을 가로채지 않게 함
      if (e.key === "Enter") { e.preventDefault(); cleanup(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
    });
    requestAnimationFrame(() => {
      input.focus();
      // 실제 윈도우 탐색기의 이름 변경처럼, 확장자가 있으면 확장자는 빼고 파일명(기본 이름)
      // 부분만 선택된 채로 시작한다(사용자 지시) - 폴더처럼 확장자가 없으면 전체를 선택한다.
      const { base, ext } = dfsSplitExt(defaultValue);
      if (ext) input.setSelectionRange(0, base.length);
      else input.select();
    });
  });
}

/* ============ 바로가기 생성 대화상자 (요청 #133) ============
   바탕화면/탐색기(가상 폴더)의 빈 곳에서 "바로가기 생성"을 고르면, 기존 항목을 가리키는 게
   아니라 사용자가 직접 이름/주소(URL)/아이콘을 입력해서 완전히 새로운 바로가기를 만든다(메뉴
   메이커의 항목 편집 패널과 같은 개념이지만, 여기서는 바탕화면에 아이콘으로 놓인다). 아이콘은
   URL 텍스트를 입력하거나, 이미지를 클립보드에서 붙여넣거나(Ctrl+V) 파일로 선택하면 base64
   data URL로 바로 들어간다(menu-maker.js의 buildIconEditorField와 같은 방식). 기존 CSS 클래스
   (confirm-overlay/confirm-panel/confirm-input/settings-button 등)만 재사용해서 테마 8종의
   style.css를 전부 건드리지 않고, 레이아웃은 인라인 스타일로만 처리한다.
   반환: 확인 -> {name, url, icon}, 취소(배경 클릭/취소 버튼/Esc) -> null. */
function showShortcutDialog(defaults = {}, opts = {}) {
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    // 요청 #141: dfsEditShortcut(desktop-fs.js)이 편집 모드에서 title/okLabel을 넘겨주지만,
    // 예전엔 이 함수가 그 두 번째 인자(opts) 자체를 받지 않아서 항상 "바로가기 생성"/"만들기"로만
    // 떠 있었다 - 편집할 때도 그렇게 보여서 혼란스럽다는 지적에 맞춰 이제 실제로 반영한다.
    const titleText = opts.title || "바로가기 생성";
    const okLabelText = opts.okLabel || "만들기";
    overlay.innerHTML = `
      <div class="confirm-panel">
        <div class="confirm-message">${escapeHtml(titleText)}</div>
        <input type="text" class="confirm-input sc-name-input" placeholder="이름" spellcheck="false">
        <input type="text" class="confirm-input sc-url-input" placeholder="주소(URL, 예: https://...)" spellcheck="false">
        <div style="display:flex;gap:8px;align-items:center;">
          <div class="sc-icon-preview" style="width:32px;height:32px;flex:0 0 auto;border:1px solid #d5d5d5;border-radius:6px;background-color:#fff;background-size:contain;background-position:center;background-repeat:no-repeat;"></div>
          <input type="text" class="confirm-input sc-icon-input" placeholder="아이콘 URL 또는 붙여넣기(Ctrl+V)로 이미지 삽입" style="flex:1;">
        </div>
        <div style="display:flex;gap:8px;">
          <button class="settings-button settings-button-neutral sc-icon-file-btn">이미지 파일 선택</button>
          <button class="settings-button settings-button-neutral sc-icon-repo-btn" type="button" title="이 저장소의 기본 아이콘 폴더 경로를 채웁니다 - 뒤에 파일명만 이어 적으세요">저장소 아이콘 폴더</button>
        </div>
        <input type="file" accept="image/*" class="sc-icon-file-input" style="display:none">
        <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;cursor:pointer;">
          <input type="checkbox" class="sc-popup-input">
          <span>새 탭 대신 작은 팝업 창으로 열기</span>
        </label>
        <div class="confirm-buttons">
          <button class="settings-button settings-button-neutral confirm-cancel">취소</button>
          <button class="settings-button confirm-ok">${escapeHtml(okLabelText)}</button>
        </div>
      </div>`;
    const nameInput = overlay.querySelector(".sc-name-input");
    const urlInput = overlay.querySelector(".sc-url-input");
    const iconInput = overlay.querySelector(".sc-icon-input");
    const iconPreview = overlay.querySelector(".sc-icon-preview");
    const fileInput = overlay.querySelector(".sc-icon-file-input");
    const popupInput = overlay.querySelector(".sc-popup-input");
    nameInput.value = defaults.name || "";
    urlInput.value = defaults.url || "";
    popupInput.checked = !!defaults.popup;
    let currentIcon = defaults.icon || "";
    function refreshPreview() { iconPreview.style.backgroundImage = currentIcon ? `url("${currentIcon}")` : "none"; }
    function setIcon(v) { currentIcon = v; iconInput.value = v; refreshPreview(); }
    setIcon(currentIcon);
    document.body.appendChild(overlay);
    let done = false;
    const cleanup = (result) => {
      if (done) return;
      done = true;
      overlay.remove();
      if (previouslyFocused && document.body.contains(previouslyFocused) && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };
    function submit() {
      const url = urlInput.value.trim();
      if (!url) { showToast("주소(URL)를 입력하세요.", { kind: "warn", sound: "error_generic" }); urlInput.focus(); return; }
      const name = nameInput.value.trim() || "새 바로가기";
      cleanup({ name, url, icon: currentIcon, popup: popupInput.checked });
    }
    overlay.querySelector(".confirm-cancel").onclick = () => cleanup(null);
    overlay.querySelector(".confirm-ok").onclick = submit;
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cleanup(null); });
    [nameInput, urlInput, iconInput].forEach((input) => {
      input.addEventListener("keydown", (e) => {
        e.stopPropagation(); // 전역 백스페이스=뒤로가기 등이 타이핑을 가로채지 않게 함(showPromptDialog와 동일)
        if (e.key === "Enter") { e.preventDefault(); submit(); }
        else if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
      });
    });
    iconInput.oninput = () => setIcon(iconInput.value);
    iconInput.onpaste = (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image/") === 0) {
          const file = items[i].getAsFile();
          if (!file) continue;
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = () => setIcon(reader.result);
          reader.readAsDataURL(file);
          return;
        }
      }
    };
    overlay.querySelector(".sc-icon-file-btn").onclick = () => fileInput.click();
    // 요청: "모든 아이콘 채우는 곳에 /{repo}/_NIH_ROOT_/index/ui/icon/ 주소를 채우는 기능을
    // 만든다(바로가기, 파일 메이커 등등)" - menu-maker.js의 buildIconEditorField와 같은 버튼.
    overlay.querySelector(".sc-icon-repo-btn").onclick = () => setIcon(dfRepoIconFolderPath());
    fileInput.onchange = () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setIcon(reader.result);
      reader.readAsDataURL(file);
    };
    requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
  });
}

/* ============ 여러 개 중 하나를 고르는 대화상자(예: 폴더 다운로드 zip/헬퍼 선택) ============
   showConfirmDialog와 같은 모양이지만 버튼이 확인/취소 둘이 아니라 choices 배열 순서대로
   임의 개수 생긴다 + 맨 끝에 취소 버튼이 항상 하나 더 붙는다. choices: [{label, value}, ...].
   선택한 항목의 value로 resolve되고, 취소(배경 클릭/Esc/취소 버튼)는 null로 resolve된다. */
function showChoiceDialog(message, choices) {
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-panel">
        <div class="confirm-message"></div>
        <div class="confirm-buttons"></div>
      </div>`;
    overlay.querySelector(".confirm-message").textContent = message;
    const btnRow = overlay.querySelector(".confirm-buttons");
    document.body.appendChild(overlay);
    let done = false;
    const cleanup = (result) => {
      if (done) return;
      done = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      if (previouslyFocused && document.body.contains(previouslyFocused) && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    };
    choices.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "settings-button";
      btn.textContent = c.label;
      btn.onclick = () => cleanup(c.value);
      btnRow.appendChild(btn);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "settings-button settings-button-neutral";
    cancelBtn.textContent = "취소";
    cancelBtn.onclick = () => cleanup(null);
    btnRow.appendChild(cancelBtn);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cleanup(null); });
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cleanup(null); }
    }
    document.addEventListener("keydown", onKey, true);
    btnRow.querySelector("button").focus();
  });
}

/* ============ 안내 전용 대화상자(버튼 하나) ============
   요청 #113 - 휴지통 "속성" 등, 확인/취소 구분 없이 그냥 내용을 보여주고 닫기만 하면 되는 경우. */
function showInfoDialog(message, okLabel) {
  return new Promise(resolve => {
    const previouslyFocused = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-panel">
        <div class="confirm-message"></div>
        <div class="confirm-buttons">
          <button class="settings-button confirm-ok"></button>
        </div>
      </div>`;
    overlay.querySelector(".confirm-message").textContent = message;
    overlay.querySelector(".confirm-ok").textContent = okLabel || "닫기";
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
      resolve();
    };
    overlay.querySelector(".confirm-ok").onclick = cleanup;
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) cleanup(); });
    function onKey(e) {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); cleanup(); }
    }
    document.addEventListener("keydown", onKey, true);
    overlay.querySelector(".confirm-ok").focus();
  });
}

/* ============ 취소 가능한 진행 상황 대화상자(폴더 통째로 다운로드용) ============
   showConfirmDialog와 비슷한 모양이지만 버튼이 "취소" 하나뿐이고, 확인을 기다리지 않고 즉시
   반환한다 - 호출한 쪽이 setText로 진행 상황을 계속 갱신하고, isCancelled()를 반복문 중간중간
   확인해서 사용자가 취소를 눌렀으면 그 자리에서 중단한다. */
function showCancelableProgressDialog(initialMessage) {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-panel">
      <div class="confirm-message"></div>
      <div class="confirm-buttons">
        <button class="settings-button settings-button-neutral progress-cancel">취소</button>
      </div>
    </div>`;
  const msgEl = overlay.querySelector(".confirm-message");
  msgEl.textContent = initialMessage;
  document.body.appendChild(overlay);
  let cancelled = false;
  const cancelBtn = overlay.querySelector(".progress-cancel");
  cancelBtn.onclick = () => { cancelled = true; cancelBtn.disabled = true; cancelBtn.textContent = "취소하는 중..."; };
  return {
    setText(msg) { msgEl.textContent = msg; },
    isCancelled() { return cancelled; },
    close() { overlay.remove(); }
  };
}

/* ============ 토스트(알림) ============ */
function showToast(message, opts = {}) {
  clearTimeout(toastTimer);
  els.toast.innerHTML = "";
  const msgEl = document.createElement("div");
  msgEl.className = "toast-msg";
  msgEl.textContent = message;
  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => els.toast.classList.remove("show");
  els.toast.appendChild(msgEl);
  els.toast.appendChild(closeBtn);
  els.toast.className = "toast show" + (opts.kind === "warn" ? " warn" : "");
  // 중요한 알림(opts.sticky)도 화면에 영원히 남지는 않게 한다 - 그냥 읽을 시간을 더 준다(6초).
  // 더 일찍 닫고 싶으면 닫기(✕) 버튼으로 언제든 닫을 수 있다.
  const duration = opts.sticky ? 6000 : 2500;
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), duration);
  // 요청 #122: opts.sound로 상황(sound_set.json의 시나리오 키)을 넘긴 호출부에서만 알림음을
  // 재생한다 - 토스트가 뜨는 모든 곳에 소리를 강제로 붙이지 않고, 사운드 메이커에서 그 상황에
  // 실제로 소리를 지정했을 때만(dfsPlaySound 참고) 조용하지 않게 동작한다.
  if (opts.sound) dfsPlaySound(opts.sound);
}

