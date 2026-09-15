/* ============ Alt+방향키 / Backspace = 뒤로·앞으로 가기 ============
   Alt+←/→(그리고 Alt+↑/↓)는 브라우저 자체의 "뒤로/앞으로 가기"와 겹쳐서, 그냥 두면
   진짜 탐색기/바탕화면/가상 탐색기 창 어디에서 눌러도 이 페이지를 벗어나 이전/다음
   사이트로 이동해버릴 수 있다. 그래서 전역(캡처 단계)에서 항상 기본 동작을 막고,
   대신 Alt+←/→는 진짜 탐색기의 자체 뒤로/앞으로 내비게이션으로 연결한다.
   Backspace도 같은 방식의 "뒤로가기" 단축키로 취급하되, 입력 중인 텍스트를 지우는
   본래 동작과 겹치지 않도록 input/textarea/contenteditable에 포커스가 있을 때는 제외한다. */
document.addEventListener("keydown", (e) => {
  // Ctrl+A = 전체 선택 (사용자 지시: "바탕 화면 탐색기 모두에서 전체 선택으로 동작"). 입력창/텍스트
  // 영역/에디터처럼 텍스트를 고르는 게 자연스러운 곳에서는 브라우저 기본 동작(텍스트 전체 선택)을
  // 그대로 둔다. 바탕화면 아이콘층에 포커스가 있을 때는 desktop-fs.js의 dfIconLayer 전용 keydown
  // 리스너가 이미 따로 처리하므로 여기서는 건드리지 않는다(중복 처리 방지).
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
    if (isEditable) return;
    if (document.activeElement === els.dfIconLayer) return;
    e.preventDefault();
    selectAllContentPane();
    return;
  }
  // 요청 #164: Ctrl+Win(윈도우 키) = 시작 메뉴 열기/닫기(시작 버튼 클릭과 동일). 두 키 중 나중에
  // 눌리는 쪽이 실제 keydown의 e.key로 찍히므로(둘 다 순수 modifier라 각자 keydown을 낸다), Ctrl을
  // 먼저 누르고 Win을 눌렀을 때(e.key === "Meta" + e.ctrlKey)와 그 반대 순서(e.key === "Control" +
  // e.metaKey) 둘 다 확인한다. 다만 Win 키는 OS가 먼저 가로채 자체 시작 메뉴를 띄우는 경우가 많아
  // 브라우저까지 이벤트가 안 올 수도 있다 - 그런 경우는 이 페이지에서 어떻게 할 수 있는 방법이 없다.
  if ((e.key === "Meta" && e.ctrlKey) || (e.key === "Control" && e.metaKey)) {
    e.preventDefault();
    toggleStartMenu();
    return;
  }
  // 요청 #126: Ctrl+E = 루트 탐색기 열기(단, 지금 "닫혀 있을 때만" - 이미 열려 있으면 사용자가
  // 보고 있던 위치를 그대로 두고 아무 일도 하지 않는다. 실제 윈도우의 Win+E는 매번 새 탐색기를
  // 열지만, 이 앱은 통합 창이 하나뿐이라 이미 열려 있으면 굳이 루트로 되돌리지 않는 게 더 자연스럽다).
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "e") {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
    if (isEditable) return;
    e.preventDefault();
    if (els.win.classList.contains("closed")) openRealExplorerAt([]);
    return;
  }
  // 요청 #126/#127: Ctrl+W와 Alt+W 둘 다 "탐색기 창 닫기"로 취급한다. Ctrl+W는 브라우저가 "탭
  // 닫기"로 예약해둔 단축키라 여기서 preventDefault를 해도 브라우저/환경에 따라 먹지 않을 수
  // 있다(그러면 이 핸들러가 실행되기도 전에 탭이 그냥 닫혀버려서 대응할 수 없음) - 그래서 항상
  // 확실히 먹는 Alt+W를 대체 단축키로 함께 둔다. 어느 쪽으로든 여기까지 도달하면 곧바로 닫지 않고
  // 확인창을 띄운다(요청 #127 - 실수로 창을 닫는 것 방지).
  if ((((e.ctrlKey || e.metaKey) && !e.altKey) || (e.altKey && !e.ctrlKey && !e.metaKey)) && e.key.toLowerCase() === "w") {
    e.preventDefault();
    triggerCloseWindowWithConfirm();
    return;
  }
  if (e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    if (e.key === "ArrowLeft") goBack();
    else if (e.key === "ArrowRight") goForward();
    return;
  }
  if (e.key === "Backspace") {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
    if (!isEditable) { e.preventDefault(); goBack(); }
  }
  if (e.key === "F2") {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
    if (!isEditable) { e.preventDefault(); triggerF2Rename(); }
  }
  // Delete = 지금 선택된 항목 삭제. 실제 저장소 파일/폴더는 애초에 "삭제" 메뉴 자체가 없으므로
  // (읽기 전용) 자동으로 아무 일도 일어나지 않는다 - 바탕화면(가상 파일시스템) 항목에서만 동작한다.
  // 요청 #159: Shift+Delete는 실제 윈도우처럼 휴지통을 거치지 않고 곧바로 영구 삭제한다.
  if (e.key === "Delete") {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
    if (!isEditable) { e.preventDefault(); triggerDeleteSelected(e.shiftKey); }
  }
}, true);
/* F2 = 지금 선택된 항목 이름 변경(실제 윈도우 탐색기와 동일) - 바탕화면 아이콘에 포커스가 있으면
   그 아이콘을, 아니면 내용창(오른쪽)에 단일 선택된 항목을, 그것도 아니면 트리(왼쪽)에서 강조된
   파일이나 지금 선택된 폴더를 대상으로 한다. 메뉴를 직접 다시 만들지 않고 buildFileMenuItems()가
   이미 만드는 "이름 변경" 항목의 동작을 그대로 재사용한다(실제 저장소 항목처럼 메뉴 자체가 없으면
   아무 일도 일어나지 않는다). */
function triggerF2Rename() {
  if (document.activeElement === els.dfIconLayer) { dfsRenameSelectedIcon(); return; }
  // 내용창에서 2개 이상이 다중 선택된 상태면 F2로 바꿀 단일 대상이 없다(여러 항목을 한 번에 같은
  // 이름으로 바꿀 순 없으므로 이 앱은 다중 이름변경을 지원하지 않는다) - 여기서 멈추지 않으면 아래
  // 끝의 "선택된 게 하나도 없을 때 지금 보고 있는 폴더 자신을 바꾸는" 예비 동작까지 새어 들어가서,
  // 버그 리포트처럼 다중 선택 중에 엉뚱하게 지금 열어본 폴더("새 폴더" 등) 이름이 바뀌어버린다.
  if (multiSelected.size > 1) return;
  const findRenameAction = (items) => { const found = items.find(it => it.label === "이름 변경"); return found ? found.action : null; };
  const navFocused = document.activeElement === els.navPane;
  if (!navFocused && selected && multiSelected.size <= 1) {
    const it = currentItems.find(i => i.path.join("/") === selected.path.join("/"));
    if (it) { const action = findRenameAction(buildFileMenuItems(it)); if (action) action(); }
    return;
  }
  if (treeFileHighlightKey !== null) {
    const entry = flattenVisibleTree().find(en => en.key === treeFileHighlightKey);
    if (entry && entry.item) { const action = findRenameAction(buildFileMenuItems(entry.item)); if (action) action(); }
    return;
  }
  if (currentPath.length > 0) {
    const it = { name: currentPath[currentPath.length - 1], path: currentPath, type: "folder" };
    const action = findRenameAction(buildFileMenuItems(it));
    if (action) action();
  }
}
/* Delete = 지금 선택된 항목 삭제. triggerF2Rename과 거의 같은 구조로, 대상을 찾는 우선순위만
   그대로 재사용하고 찾는 메뉴 라벨만 "삭제"로 바꿨다. 단, F2(이름 변경)는 여러 개를 한 번에
   바꿀 수 없어 단일 선택일 때만 동작하는 게 맞지만, 삭제는 바탕화면 아이콘처럼 내용창(트리 통합)
   쪽에서도 드래그로 여러 개를 선택한 뒤 한 번에(확인 대화상자 하나로) 지울 수 있어야 한다
   (버그 리포트: 탐색기에서 드래그로 2개 이상 선택 후 Delete가 안 먹었음) - handleMultiDelete로 위임.
   요청 #159: permanent(Shift+Delete)이면 휴지통을 거치지 않고 곧바로 영구 삭제한다(실제 윈도우와 동일). */
function triggerDeleteSelected(permanent) {
  if (document.activeElement === els.dfIconLayer) { dfsDeleteSelectedIcons(permanent); return; }
  // 휴지통 안 항목은 buildFileMenuItems가 "삭제" 대신 "영구 삭제"를 내놓으므로(요청 #113) 둘 다 인식한다.
  const findDeleteAction = (items) => { const found = items.find(it => it.label === "삭제" || it.label === "영구 삭제"); return found ? found.action : null; };
  const navFocused = document.activeElement === els.navPane;
  if (!navFocused && multiSelected.size > 1) {
    handleMultiDelete(itemsFromKeys([...multiSelected]), permanent);
    return;
  }
  if (!navFocused && selected && multiSelected.size <= 1) {
    const it = currentItems.find(i => i.path.join("/") === selected.path.join("/"));
    if (it) triggerSingleDelete(it, permanent, findDeleteAction);
    return;
  }
  if (treeFileHighlightKey !== null) {
    const entry = flattenVisibleTree().find(en => en.key === treeFileHighlightKey);
    if (entry && entry.item) triggerSingleDelete(entry.item, permanent, findDeleteAction);
  }
}
// 요청 #159: buildFileMenuItems가 만드는 "삭제" 액션은 항상 dfsDelete(휴지통 이동)만 호출하므로
// (컨텍스트 메뉴 클릭에는 Shift 여부가 없어 굳이 permanent 인자를 받게 바꾸지 않았다), Shift+Delete로
// 영구 삭제가 필요할 때는 그 액션을 그대로 쓰지 않고 dfsDesktopFolderMenuItems/dfsDesktopFileMenuItems가
// 쓰는 것과 같은 방식으로 노드를 직접 찾아 dfsDelete(node, true)를 호출한다. 이미 휴지통 안에 있는
// 항목은 원래도 "영구 삭제"뿐이므로(요청 #113) Shift 여부와 무관하게 기존 메뉴 액션을 그대로 쓴다.
async function triggerSingleDelete(it, permanent, findDeleteAction) {
  if (!permanent || isRecycleBinPath(it.path)) {
    const action = findDeleteAction(buildFileMenuItems(it));
    if (action) action();
    return;
  }
  let node = null;
  if (it.type === "folder") {
    if (!isDesktopPath(it.path)) return; // 실제 저장소 폴더는 삭제 메뉴 자체가 없다(읽기 전용)
    const folderId = await dfsDesktopResolveFolderId(it);
    node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
  } else if (it.dfsNode) {
    node = it.dfsNode;
  } else {
    return; // 실제 저장소 파일 - 삭제 메뉴 자체가 없다
  }
  if (!node) return;
  const ok = await showConfirmDialog(`"${node.name}"을(를) 완전히 삭제할까요? (휴지통을 거치지 않고 바로 삭제되며 되돌릴 수 없습니다)`);
  if (!ok) return;
  await dfsDelete(node, true);
  await dfsBroadcastChange();
}

/* 요청 #126/#127: Ctrl+W/Alt+W로 탐색기 창을 닫기 전에 확인창을 띄운다 - 실제 닫기 동작
   자체는 window-chrome.js의 btnClose.onclick이 이미 갖고 있는 로직(작업표시줄 비활성화, 해시/
   마지막 경로 초기화 등)을 그대로 재사용한다(중복 구현 방지).
   요청 #160: 환경설정에서 "확인창 없이 바로 닫기"를 켜뒀으면 이 확인창 자체를 건너뛴다(기본은 꺼짐 -
   원래 취지인 실수 방지를 유지). */
async function triggerCloseWindowWithConfirm() {
  if (els.win.classList.contains("closed")) return; // 이미 닫혀 있으면 할 일 없음
  if (settings.closeWindowWithoutConfirm) { els.btnClose.onclick(); return; }
  const ok = await showConfirmDialog("탐색기 창을 닫을까요?");
  if (ok) els.btnClose.onclick();
}

/* 새로고침: 페이지 새로고침이 아니라 "이 폴더" 캐시만 비우고 다시 읽기 + GitHub API로 일치 여부
   확인. 요청 #129: 위쪽 툴바의 새로고침 버튼과 저장소 탐색기 빈 영역 우클릭 메뉴의 "새로고침" 둘
   다 이 함수 하나를 그대로 호출하게 해서, 어느 쪽으로 실행하든 하단 좌측 토스트 문구가 완전히
   똑같이 나오게 한다(로직 중복 방지 + 결과 일관성). */
async function refreshCurrentFolder() {
  const path = currentPath;
  // 바탕화면(가상 파일시스템) 경로는 애초에 GitHub 저장소와 무관한 로컬(dexie) 데이터이므로,
  // 실제 저장소용 "GitHub과 비교" 로직을 돌릴 이유가 없다 - 돌리면 owner/repo가 없거나
  // 엉뚱한 API 호출을 시도해 오류만 난다. 캐시만 비우고 다시 그린다.
  if (isDfsPath(path)) {
    const treeName = path[0];
    for (const k of [...dirCache.keys()]) {
      if (k === treeName || k.startsWith(treeName + "/")) dirCache.delete(k);
    }
    await revealPath(path).catch(() => {});
    await renderContentPane();
    renderNavPane();
    return;
  }
  clearCache(path);
  clearTagCache(path); // #hashtag.json도 새로고침 때 다시 읽어오게 한다(외부에서 직접 고쳤을 수 있으므로)
  const [, ghResult] = await Promise.allSettled([
    renderContentPane(),
    fetchGithubListing(path)
  ]);
  renderNavPane();
  if (ghResult.status === "fulfilled") {
    compareWithIndex(path, ghResult.value);
  } else {
    showToast("GitHub 확인 실패: " + ghResult.reason.message, { kind: "warn", sound: "error_generic" });
  }
}
els.btnRefresh.onclick = refreshCurrentFolder;

// 요청 #129: "경로 복사" - 라벨은 경로 복사지만 실제로는 지금 보고 있는 페이지의 URL을 그대로
// 클립보드에 복사한다(이 앱은 해시 라우팅이라 window.location.href 자체가 지금 경로를 포함함).
// editor.js의 dfCopyText(클립보드 API + execCommand 폴백)를 그대로 재사용한다.
// 경로/트리 이름에 한글 등이 있으면 encodeURIComponent 때문에 URL이 과도하게 길어지므로,
// 복사 직전에 해시의 path·tree 부분을 URL Decode해서 짧고 읽기 쉬운 형태로 만든다.
// (다시 열 때 hashToPath/hashToExpandedSet이 decodeURIComponent를 한 번 더 호출해도
// 이미 디코드된 문자열에는 영향이 없고, 특수문자가 없는 일반 경로에서는 문제 없다.)
function copyCurrentUrlToClipboard() {
  let url = window.location.href;
  try {
    const hashIdx = url.indexOf("#");
    if (hashIdx >= 0) {
      const base = url.slice(0, hashIdx + 1);
      const hash = url.slice(hashIdx + 1);
      const parts = hash.split("|");
      const decodedParts = parts.map(part => {
        if (part.startsWith("tree=")) {
          const vals = part.slice(5).split(",").map(s => {
            try { return decodeURIComponent(s); } catch (e) { return s; }
          });
          return "tree=" + vals.join(",");
        }
        if (part.startsWith("nav=")) return part;
        // path part: 각 세그먼트 디코드
        return part.split("/").map(s => {
          try { return decodeURIComponent(s); } catch (e) { return s; }
        }).join("/");
      });
      url = base + decodedParts.join("|");
    }
  } catch (e) { /* 디코드 실패 시 원본 그대로 */ }
  dfCopyText(url, () => showToast("주소를 복사했습니다.", { sound: "copy_to_clipboard" }));
}

async function fetchGithubListing(pathArr) {
  const { owner, repo } = getOwnerRepo();
  if (!owner || !repo) throw new Error("owner/repo를 알 수 없습니다.");
  const apiPath = pathArr.map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}`;
  const res = await fetch(url, { headers: { "Accept": "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const names = Array.isArray(data) ? data.map(it => it.name) : [];
  return filterNames(names, pathArr);
}
function compareWithIndex(pathArr, ghNames) {
  const entry = dirCache.get(pathArr.join("/")) || { folders: [], files: [] };
  const indexNames = [...entry.folders, ...entry.files.map(f => f.name)];
  const ghSet = new Set(ghNames);
  const idxSet = new Set(indexNames);
  const missing = ghNames.filter(n => !idxSet.has(n));   // GitHub엔 있는데 색인엔 없음
  const stale = indexNames.filter(n => !ghSet.has(n));   // 색인엔 있는데 GitHub엔 없음
  if (missing.length === 0 && stale.length === 0) {
    showToast("GitHub과 일치합니다.", { sound: "notify_success" });
    return;
  }
  const lines = [];
  if (missing.length) lines.push(`색인에 없는 항목(GitHub엔 있음): ${missing.join(", ")}`);
  if (stale.length) lines.push(`색인에만 있는 항목(GitHub엔 없음): ${stale.join(", ")}`);
  showToast(lines.join("\n"), { kind: "warn", sticky: true, sound: "error_generic" });
}

/* 폴더 열기 / md는 항상 에디터로 / 그 외(html 포함)는 환경설정의 더블클릭 동작 4가지 중 하나를
   따른다(사용자 지시로 재설계됨 - 기본값은 "새 탭에서 열기"). md는(설명 문서라 바로 읽기 좋은
   형태가 자연스러우므로) 더블클릭하면 항상 내장 에디터로 연다. */
async function activate(it) {
  // 요청 #113: 휴지통 안의 파일은 실제 윈도우처럼 더블클릭으로 바로 열 수 없다(폴더는 그냥
  // navigate로 안까지 들어가지므로 여기 안 걸린다 - type==="folder"에는 dfsNode가 없음).
  // 복원해야 연다고 안내하고, 확인하면 복원까지 대신 해준다.
  if (it.dfsNode && isRecycleBinPath(it.path)) {
    const ok = await showConfirmDialog(`휴지통에 있는 파일은 복원해야 열 수 있습니다.\n"${it.name}"을(를) 지금 복원할까요?`);
    if (ok) { await dfsRestoreFromRecycleBin(it.dfsNode); await dfsBroadcastChange(); }
    return;
  }
  // 바탕화면(가상 파일시스템) 파일/바로가기는 진짜 저장소 파일이 아니므로 dfs 전용 활성화
  // 로직(에디터 새 탭으로 열기 / 바로가기 따라가기)을 그대로 재사용한다.
  if (it.dfsNode) { dfsActivate(it.dfsNode); return; }
  const { path, type } = it;
  // 검색 결과 화면(currentOpts.flat)에서 점프해 들어가는 경우도 포함해서, navigate()가 실시간으로
  // 트리를 그 경로까지 펼쳐서 드러낸다(reveal).
  const isSearchJump = currentOpts.flat === true;
  if (type === "folder") {
    els.searchInput.value = "";
    await navigate(path);
    return;
  }
  // 검색 결과에서 파일을 여는 경우 - 실제로 그 폴더로 들어가진 않지만, 트리에서 그 파일의
  // 위치는 펼쳐서 보여준다("트리 안의 파일이 열리면 이전 트리 열기" - 실제 윈도우 동작).
  if (isSearchJump && path.length > 1) {
    revealPath(path.slice(0, -1)).then(renderNavPane);
  }
  if (type === "md") {
    dfsOpenRepoFileInEditor(it);
    return;
  }
  // 요청 #141: 저장소에 올라간 .sc 바로가기 파일 - 더블클릭하면 파일 자체가 아니라 그 안에 적힌
  // 주소로 곧장 이동한다(바탕화면에서 다운로드해 저장소에 올린 바로가기를 그대로 재사용).
  if (type === "sc") {
    activateScShortcut(it);
    return;
  }
  // 일반 파일(html 포함): 요청 #143 - 먼저 extension_run_set.json에 이 확장자만의 개별 설정이
  // 있는지 확인하고, 있으면 전역 설정보다 그걸 우선한다(예: html은 항상 새 탭, txt는 항상 에디터
  // 처럼). 없으면 기존처럼 환경설정에서 고른 더블클릭 동작 중 하나를 따른다(요청 #142: 기본값이
  // "helper"(로컬 열기)로 바뀌고, 깃허브 메뉴("저장소에서 보기")도 선택지에 추가됐다).
  runDoubleClickAction(extensionRunActionFor(it.name) || settings.doubleClickAction, it);
}
//   helper   -> 로컬 헬퍼로 열기(예전 "open" 동작, localHelperOpen) - 전역 기본값
//   newtab   -> 이 사이트 자체의 배포된 주소로 새 탭에서 열기(viewAsHostedPage)
//   editor   -> 요청 #143: 내장 에디터로 열기(dfsOpenRepoFileInEditor) - 지금까지 md 파일에만
//               하드코딩돼 있던 동작을 확장자별 개별 설정에서 고를 수 있는 선택지로 꺼냈다(전역
//               더블클릭 기본값 목록에는 넣지 않는다 - state.js의 EXTENSION_RUN_ACTIONS 주석 참고).
//   text     -> 텍스트로 열기(우클릭의 "브라우저에서 보기"와 동일, viewOnPages)
//   textviewer -> 텍스트 뷰어로 열기(앱 내 읽기 전용 창, editor.js의 dfsOpenRepoFileInTextViewer)
//               사진/음악 뷰어와 같은 방식. 우클릭 메뉴에는 없음(사용자 지시).
//   download -> 헬퍼의 다운로드 기능(localHelperDownload)
//   repo     -> 저장소에서 보기(GitHub의 blob 화면, openInRepo) - GitHub 바로가기 표시가 꺼져
//               있으면(settings.githubLinksEnabled=false) 우클릭 메뉴에서도 안 보이는 기능이므로
//               새 탭에서 열기로 대신 동작한다.
//   hls      -> HLS 재생기로 열기(hls-player.js의 dfsOpenRepoFileInHlsPlayer) - 어떤 확장자를
//               이 동작에 연결할지는 하드코딩돼 있지 않고, 항상 메뉴 메이커의 확장자 탭에서
//               사용자가 직접 고른다(전역 더블클릭 기본값 목록에는 넣지 않는다 - editor와 같은
//               이유, state.js의 EXTENSION_RUN_ACTIONS 주석 참고).
function runDoubleClickAction(action, it) {
  switch (action) {
    case "text": viewOnPages(it); break;
    case "download": localHelperDownload(it); break;
    case "repo": settings.githubLinksEnabled ? openInRepo(it) : viewAsHostedPage(it); break;
    case "newtab": viewAsHostedPage(it); break;
    // 요청: 확장자 탭의 "새 탭에서 열기(newtab)"와 짝을 맞춘 "팝업으로 열기(popup)" - 같은 주소를
    // 작은 별도 창으로 연다.
    case "popup": viewAsHostedPage(it, true); break;
    case "editor": dfsOpenRepoFileInEditor(it); break;
    case "hls": dfsOpenRepoFileInMediaViewer(it, "video"); break;
    // 요청: hls 재생기 창을 음악/사진 모드로 돌려쓴다 - mp3/png는 raw 주소를 그대로 물리면
    // 재생/로드되므로 창 이름/아이콘만 다르게 열면 된다(hls-player.js의
    // dfsOpenMediaViewerWindow 참고).
    case "music": dfsOpenRepoFileInMediaViewer(it, "music"); break;
    case "photo": dfsOpenRepoFileInMediaViewer(it, "photo"); break;
    case "pdf": dfsOpenRepoFileInMediaViewer(it, "pdf"); break;
    // 사용자 지시: 텍스트 뷰어(사진/음악 뷰어와 같은 앱 내 창). 우클릭 메뉴에는 없음.
    case "textviewer": dfsOpenRepoFileInTextViewer(it); break;
    case "helper":
    default: localHelperOpen(it); break;
  }
}
// 이 사이트 자체의 배포된 주소("호스팅된 페이지")로 새 탭에서 연다 - html의 index.html은 폴더
// 주소로(GitHub Pages가 자동으로 index.html을 서빙하는 것과 동일하게), 그 외에는 파일 경로
// 그대로. 예전엔 html 전용이었지만(viewHtmlAsHostedPage), 더블클릭 기본 동작이 됨에 따라
// 모든 파일 형식에 쓸 수 있도록 일반화됐다(사용자 지시). 요청: popup이 참이면 새 탭 대신
// openShortcutUrl과 같은 크기의 작은 별도 창으로 연다(우클릭/확장자 탭의 팝업 옵션이 쓴다).
function viewAsHostedPage(it, popup) {
  const path = it.path;
  const isHtmlIndex = it.type === "html" && path[path.length - 1].toLowerCase() === "index.html";
  let url;
  if (isHtmlIndex) {
    const dirPath = path.slice(0, -1);
    url = dirPath.length ? dirPath.map(encodeURIComponent).join("/") + "/" : "./";
  } else {
    url = path.map(encodeURIComponent).join("/");
  }
  if (popup) dfOpenNewTab(url, "_blank", "width=1000,height=700,resizable=yes,scrollbars=yes,noopener");
  else dfOpenNewTab(url, "_blank", "noopener,noreferrer");
}
// 요청 #141: 저장소에 올라간 .sc 파일의 실제 내용(JSON 텍스트)을 읽어서 그 안의 주소로 이동한다 -
// 이 사이트 자체와 같은 오리진(GitHub Pages)이므로 CORS 걱정 없이 상대경로로 그냥 fetch할 수
// 있다(githubRawUrl처럼 API를 거칠 필요 없음). dfsDownloadShortcutFile이 만든 형식이 아니거나
// (수동으로 잘못 만든 .sc, 혹은 우연히 확장자만 같은 파일) JSON 파싱이 실패하면, 바로가기로
// 취급하지 않고 평범한 파일처럼 새 탭에서 열어 보여준다(사용자가 직접 내용을 확인할 수 있게).
async function activateScShortcut(it) {
  const url = it.path.map(encodeURIComponent).join("/");
  let data;
  try {
    const res = await fetchWithTimeout(url, 5000);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (e) {
    showToast(`바로가기 파일을 읽지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
    return;
  }
  if (!data || typeof data.url !== "string" || !data.url) {
    showToast("이 .sc 파일은 이 앱이 만든 바로가기 형식이 아닌 것 같아 그냥 파일로 엽니다.", { kind: "warn", sound: "error_generic" });
    viewAsHostedPage(it);
    return;
  }
  openShortcutUrl(data.url, !!data.popup);
}
function flashStatus(msg) {
  clearTimeout(statusFlashTimer);
  els.statusText.textContent = msg;
  statusFlashTimer = setTimeout(updateStatus, 1800);
}

