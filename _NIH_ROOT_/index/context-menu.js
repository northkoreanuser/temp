/* ============ 우클릭 커스텀 메뉴 (브라우저 기본 메뉴는 막는다) ============ */
let activeCtxMenu = null;
// 요청 #150: 바탕화면 우클릭 메뉴가 너무 길어져서 일부 항목을 하위 메뉴로 묶는다 - 항목에
// action 대신 items(배열)를 넣으면 자동으로 "▸" 화살표가 붙고, 마우스를 올리면 그 옆에 새
// .ctx-menu가 하나 더 뜬다(같은 클래스를 재사용하므로 테마별 CSS를 새로 추가할 필요가 없다).
// 하위 메뉴는 한 번에 하나만 열려 있을 수 있고, 최상위 메뉴를 닫으면 같이 정리된다.
let activeCtxSubmenu = null;
// 방향키 컨텍스트 메뉴 탐색: 지금 방향키 포커스가 가 있는 "레벨"(최상위 메뉴 또는 그 아래로 열린
// 하위 메뉴 하나) - 마우스만 쓸 때는 그대로 null로 남아있고(기존 동작과 완전히 동일), 방향키를
// 한 번이라도 누르는 순간부터 이 변수가 그 메뉴를 가리키며 각 행에 .ctx-focused 클래스로
// 시각 표시를 해준다(테마별 style.css에서 :hover와 같은 배경을 쓰도록 이미 맞춰뒀다).
let ctxFocusMenu = null;
function closeCtxSubmenu() {
  if (activeCtxSubmenu) { activeCtxSubmenu.remove(); activeCtxSubmenu = null; }
  // 하위 메뉴가 닫히면서 그 안에 있던 방향키 포커스도 같이 사라지므로, 포커스를 그 부모(최상위
  // 메뉴)로 되돌려준다 - 그래야 하위 메뉴를 여러 번 열었다 닫았다 해도 포커스가 미아가 되지 않는다.
  if (ctxFocusMenu && ctxFocusMenu !== activeCtxMenu) ctxFocusMenu = activeCtxMenu;
}
function closeContextMenu() {
  closeCtxSubmenu();
  if (activeCtxMenu) { activeCtxMenu.remove(); activeCtxMenu = null; }
  ctxFocusMenu = null;
}
// 방향키(위/아래)로 menu 안의 idx번째 행에 포커스를 준다 - 범위를 벗어나면 반대쪽 끝으로
// 돌아온다(실제 윈도우 메뉴와 동일한 감각).
function ctxSetRowFocus(menu, idx) {
  if (!menu || !menu._rows || !menu._rows.length) return;
  const n = menu._rows.length;
  idx = ((idx % n) + n) % n;
  if (menu._focusIndex >= 0 && menu._rows[menu._focusIndex]) menu._rows[menu._focusIndex].classList.remove("ctx-focused");
  menu._focusIndex = idx;
  const row = menu._rows[idx];
  row.classList.add("ctx-focused");
  if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
}
// 실제로 하위 메뉴를 만들어 화면에 배치한다 - 마우스 hover(dfsBuildCtxMenuEl 안)와 키보드
// 오른쪽 화살표/Enter(아래 keydown 리스너) 양쪽에서 재사용하므로 로직이 중복되지 않는다.
function ctxOpenSubmenuForRow(row, it, parentMenu) {
  const sub = dfsBuildCtxMenuEl(it.items, parentMenu, row);
  sub._forRow = row;
  document.body.appendChild(sub);
  const r = row.getBoundingClientRect();
  const w = sub.offsetWidth, h = sub.offsetHeight;
  let left = r.right - 2;
  if (left + w > window.innerWidth) left = Math.max(4, r.left - w + 2);
  let top = r.top;
  if (top + h > window.innerHeight) top = window.innerHeight - h - 4;
  sub.style.left = Math.max(4, left) + "px";
  sub.style.top = Math.max(4, top) + "px";
  activeCtxSubmenu = sub;
  return sub;
}
// parentMenu/parentRow: 이 메뉴가 하위 메뉴일 때 "누구 아래에 열렸는지" 기억해둔다 - 방향키
// 왼쪽으로 다시 닫을 때 포커스를 그 부모 항목으로 되돌리기 위해서다(최상위 메뉴는 둘 다 null).
function dfsBuildCtxMenuEl(items, parentMenu, parentRow) {
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  menu._items = items;
  menu._rows = [];
  menu._focusIndex = -1;
  menu._parentMenu = parentMenu || null;
  menu._parentRow = parentRow || null;
  items.forEach(it => {
    const row = document.createElement("div");
    row.className = "ctx-item";
    row.textContent = it.items ? it.label + "  ▸" : it.label;
    if (it.items) {
      row.onmouseenter = () => {
        if (activeCtxSubmenu && activeCtxSubmenu._forRow === row) return;
        closeCtxSubmenu();
        ctxOpenSubmenuForRow(row, it, menu);
      };
      row.onclick = (e) => { e.stopPropagation(); }; // 하위 메뉴가 있는 항목 자체는 열기만 하고 닫지 않는다
    } else {
      // 요청 #166: dfsBuildCtxMenuEl은 하위 메뉴의 항목들도 자기 자신을 재귀 호출해서 만들기
      // 때문에, 여기 있는 leaf 항목이 "지금 열려 있는 하위 메뉴 자기 자신 안"의 항목일 수도 있다
      // (menu가 곧 그 하위 메뉴 자신). 예전엔 이 구분 없이 무조건 closeCtxSubmenu()를 불러서, 하위
      // 메뉴를 연 뒤 그 안의 항목으로 마우스를 옮기는 순간 자기 자신을 즉시 닫아버리는 버그가
      // 있었다(버그 리포트: 하위 메뉴 쪽으로 가면 닫히고 돌아오면 다시 열리고를 무한 반복해서
      // 하위 메뉴를 사실상 전혀 쓸 수 없었음) - 이 항목이 속한 menu가 지금 열려있는 하위 메뉴가
      // 아닐 때(=다른 형제 최상위 항목으로 옮겨간 것)만 하위 메뉴를 닫는다.
      row.onmouseenter = () => { if (menu !== activeCtxSubmenu) closeCtxSubmenu(); };
      row.onclick = (e) => { e.stopPropagation(); closeContextMenu(); it.action(); };
    }
    menu._rows.push(row);
    menu.appendChild(row);
  });
  return menu;
}
function showContextMenu(x, y, items) {
  closeContextMenu();
  if (!items.length) return;
  const menu = dfsBuildCtxMenuEl(items, null, null);
  document.body.appendChild(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  let left = x, top = y;
  if (left + w > window.innerWidth) left = window.innerWidth - w - 4;
  if (top + h > window.innerHeight) top = window.innerHeight - h - 4;
  menu.style.left = Math.max(4, left) + "px";
  menu.style.top = Math.max(4, top) + "px";
  activeCtxMenu = menu;
}
/* ============ 방향키로 컨텍스트 메뉴 안 이동 ============
   열려 있는 우클릭 메뉴가 하나라도 있으면(activeCtxMenu) 위/아래/왼쪽/오른쪽·Enter/Space를 여기서
   가로채 메뉴 탐색으로만 쓴다 - 캡처 단계에서 stopPropagation까지 해서, 같은 방향키를 듣고 있는
   바탕화면 아이콘층/내용창/트리(desktop-fs.js·content-pane.js·tree-pane.js)의 자체 방향키 이동이
   메뉴가 떠 있는 동안 같이 움직여버리는 것을 막는다.
     - 위/아래: 지금 레벨(최상위 또는 열려 있는 하위 메뉴) 안에서 한 칸씩 이동, 끝에서는 반대쪽으로.
     - 오른쪽: 포커스가 하위 메뉴가 있는 항목 위에 있으면 그 하위 메뉴를 열고 첫 항목으로 포커스를 옮긴다.
     - 왼쪽: 지금 레벨이 하위 메뉴면 그 메뉴를 닫고 포커스를 열었던 부모 항목으로 되돌린다(최상위
       메뉴에서는 아무 동작도 하지 않는다 - 메뉴 자체를 닫아버리면 실제 윈도우 동작과 다르다).
     - Enter/Space: 포커스된 항목을 실행(하위 메뉴면 열기, leaf면 클릭과 동일). */
document.addEventListener("keydown", (e) => {
  if (!activeCtxMenu) return;
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Enter", " "].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  const menu = ctxFocusMenu || activeCtxSubmenu || activeCtxMenu;
  ctxFocusMenu = menu;
  // 아직 아무 항목도 포커스되어 있지 않으면(-1) 아래는 첫 항목, 위는 마지막 항목으로 바로
  // 이동한다 - 그냥 -1에서 1을 빼고/더해 일반 wrap 계산에 맡기면 위쪽 첫 시도가 마지막 바로
  // 앞 항목으로 어긋나 버린다(끝에서 하나 모자라게 도는 계산 오차).
  if (e.key === "ArrowDown") { ctxSetRowFocus(menu, menu._focusIndex < 0 ? 0 : menu._focusIndex + 1); return; }
  if (e.key === "ArrowUp") { ctxSetRowFocus(menu, menu._focusIndex < 0 ? menu._rows.length - 1 : menu._focusIndex - 1); return; }
  if (e.key === "ArrowRight") {
    if (menu._focusIndex < 0) { ctxSetRowFocus(menu, 0); return; }
    const it = menu._items[menu._focusIndex];
    if (!it || !it.items) return; // 하위 메뉴가 없는 항목에서는 오른쪽 화살표가 할 일이 없다
    const row = menu._rows[menu._focusIndex];
    let sub = (activeCtxSubmenu && activeCtxSubmenu._forRow === row) ? activeCtxSubmenu : null;
    if (!sub) { closeCtxSubmenu(); sub = ctxOpenSubmenuForRow(row, it, menu); }
    ctxFocusMenu = sub;
    ctxSetRowFocus(sub, 0);
    return;
  }
  if (e.key === "ArrowLeft") {
    if (!menu._parentMenu) return; // 최상위 메뉴에서는 왼쪽 화살표로 메뉴 자체를 닫지 않는다(ESC의 역할)
    const parentMenu = menu._parentMenu, parentRow = menu._parentRow;
    closeCtxSubmenu();
    ctxFocusMenu = parentMenu;
    const pIdx = parentRow && parentMenu._rows ? parentMenu._rows.indexOf(parentRow) : -1;
    ctxSetRowFocus(parentMenu, pIdx >= 0 ? pIdx : parentMenu._focusIndex);
    return;
  }
  // Enter / Space
  if (menu._focusIndex < 0) return;
  const it = menu._items[menu._focusIndex];
  if (!it) return;
  if (it.items) {
    const row = menu._rows[menu._focusIndex];
    let sub = (activeCtxSubmenu && activeCtxSubmenu._forRow === row) ? activeCtxSubmenu : null;
    if (!sub) { closeCtxSubmenu(); sub = ctxOpenSubmenuForRow(row, it, menu); }
    ctxFocusMenu = sub;
    ctxSetRowFocus(sub, 0);
  } else {
    closeContextMenu();
    it.action();
  }
}, true);
function buildFileMenuItems(it) {
  // 요청 #113: 휴지통 안의 항목(파일/폴더 모두)은 CRUD 메뉴 대신 복원/영구 삭제 두 개만 제공한다
  // (실제 윈도우 휴지통과 동일 - 이름 변경/새 폴더/복사 등은 휴지통 안에서는 의미가 없음).
  if (isRecycleBinPath(it.path)) return dfsRecycleBinItemMenuItems(it);
  if (it.type === "folder") {
    // 바탕화면(가상 파일시스템) 안의 폴더는 실제 저장소 폴더와 달리 쓰기가 가능하므로, 진짜
    // 탐색기와 하나로 통합된 지금은 여기서도 새 폴더/이름변경/삭제 등 CRUD 메뉴를 그대로 제공한다.
    if (isDesktopPath(it.path)) return dfsDesktopFolderMenuItems(it);
    // 실제 저장소 폴더는 읽기 전용이지만(CRUD 메뉴 없음), 파일처럼 다운로드/저장소에서 보기는
    // 할 수 있어야 한다(사용자 지시 - "폴더 우클릭 메뉴 다운로드, 저장소에서 보기"). "저장소에서
    // 보기"는 GitHub의 tree 주소(.../tree/브랜치/경로)로 열리므로, 더블클릭 없이도 우클릭
    // 메뉴만으로 그 폴더 안으로 들어갈 수 있도록 "열기"도 맨 앞에 넣는다(사용자 지시 - "이런
    // 주소도 가능하다, 그러므로 열기 메뉴가 필요하다").
    const items = [{ label: "열기", action: () => navigate(it.path) }, { label: "다운로드", action: () => downloadFolderRecursive(it) }];
    // 요청: 저장소 폴더도 우클릭 메뉴에서 바로 바탕 화면에 바로가기를 만들 수 있어야 한다.
    items.push({ label: "바탕 화면에 바로가기 만들기", action: () => dfsCreateDesktopShortcutFromRepoItem(it) });
    if (settings.githubLinksEnabled) items.push({ label: "저장소에서 보기", action: () => openFolderInRepo(it) });
    // 요청 #140: 하위 pages.json을 실시간으로 재귀 집계해서 파일 개수/전체 크기를 보여준다.
    items.push({ label: "속성", action: () => showRepoFolderProperties(it.path, { kind: "폴더" }) });
    // 요청 #148: 저장소 폴더는 실제 경로가 있으니, 메뉴 메이커의 "폴더별 아이콘"에서 이 경로를 바로 연다.
    dfsPushIconSettingsMenuItem(items, { type: "folder", key: it.path.join("/") });
    return items;
  }
  if (it.dfsNode) return dfsDesktopFileMenuItems(it);
  const items = [];
  // 요청 #141: 저장소에 올라간 .sc 바로가기 파일은 맨 위에 "바로가기 열기"를 따로 붙인다 - 그
  // 파일 자체(JSON 텍스트)를 여는 게 아니라 그 안에 적힌 주소로 곧장 이동해야 진짜 바로가기처럼
  // 재사용된다(activateScShortcut, keyboard-and-activate.js). 아래의 일반 파일 동작들(새 탭에서
  // 열기/에디터로 열기 등)은 원본 .sc 파일 자체를 다루고 싶을 때(내용 확인/재다운로드 등)를 위해
  // 그대로 남겨둔다.
  if (it.type === "sc") items.push({ label: "바로가기 열기", action: () => activateScShortcut(it) });
  // "새 탭에서 열기"는 더블클릭 동작 선택지 중 하나(newtab)와 짝을 맞춰 모든 파일 형식에 표시한다 -
  // 예전엔 html 전용이었다(사용자 지시로 일반화됨). 요청 #142로 더블클릭 기본값 자체는 "helper"로
  // 바뀌었지만, 이 우클릭 메뉴 항목은 기본값과 무관하게 항상 표시된다.
  items.push({ label: "새 탭에서 열기", action: () => viewAsHostedPage(it) });
  // 열기/다운로드는 이 사이트에서는 항상 로컬 프로그램(webhook)을 통해서만 가능하므로
  // 굳이 "로컬 프로그램으로"라고 설명을 덧붙이지 않는다.
  items.push({ label: "열기", action: () => localHelperOpen(it) });
  items.push({ label: "다운로드", action: () => localHelperDownload(it) });
  // 실제 저장소 파일은 원본에는 쓸 수 없지만(GitHub에 직접 못 씀), 에디터 자체는 수정 가능하다 -
  // 저장하면 이 가짜 OS의 바탕화면(가상 파일시스템)에 새 파일로 저장된다(사용자 지시).
  items.push({ label: "에디터로 열기", action: () => dfsOpenRepoFileInEditor(it) });
  // 요청: 저장소 파일도 우클릭 메뉴에서 바로 바탕 화면에 바로가기를 만들 수 있어야 한다(.sc
  // 바로가기 파일 자기 자신을 우클릭했을 때도 예외 없이 그대로 제공 - "그 .sc 파일을 가리키는
  // 또 다른 바로가기"를 만드는 것도 유효한 시나리오이기 때문).
  items.push({ label: "바탕 화면에 바로가기 만들기", action: () => dfsCreateDesktopShortcutFromRepoItem(it) });
  if (settings.githubLinksEnabled) {
    items.push({ label: "브라우저에서 보기", action: () => viewOnPages(it) });
    // 요청: "브라우저에서 보기"의 팝업 버전 - 새 탭 대신 작은 별도 창으로 연다.
    items.push({ label: "브라우저에서 보기 (팝업)", action: () => viewOnPages(it, true) });
    items.push({ label: "저장소에서 보기", action: () => openInRepo(it) });
    items.push({ label: "브라우저에서 다운로드", action: () => downloadFromGithub(it) });
  }
  // 요청 #140: 크기/체크섬(CRC32, indexer.ahk가 계산해뒀으면)/위치를 보여준다.
  items.push({ label: "속성", action: () => showRepoFileProperties(it) });
  // 요청 #148: 확장자가 있으면 메뉴 메이커의 "확장자별 아이콘"에서 그 확장자를 바로 연다(.sc
  // 바로가기 파일도 여기서는 그냥 확장자 "sc"인 평범한 파일로 취급 - "바로가기 파일엔 필요없음"은
  // 바탕화면의 진짜 바로가기(Dexie type:"shortcut") 항목 얘기이며, 이건 다르다).
  const ext = fileExtOf(it.name);
  dfsPushIconSettingsMenuItem(items, ext ? { type: "ext", key: ext } : null);
  return items;
}
// 요청 #137: 파일/폴더 우클릭 메뉴는(가상 바탕화면이든 실제 저장소든) 전부 이 한 줄로 끝에
// "아이콘 설정"을 덧붙여 메뉴 메이커의 아이콘 탭으로 바로 연결한다 - 여러 메뉴 빌더 함수에서
// 공통으로 재사용(dfsDesktopFolderMenuItems/dfsDesktopFileMenuItems/buildFileMenuItems).
// 요청 #148: focusSpec({type:"ext"|"folder", key})을 주면 아이콘 탭을 열자마자 그 확장자/폴더
// 항목까지 자동으로 선택해준다(dfsOpenMenuMakerInWindow의 opts.focusIcon으로 그대로 전달).
function dfsPushIconSettingsMenuItem(items, focusSpec) {
  if (typeof dfsOpenMenuMakerInWindow === "function") {
    items.push({ label: "아이콘 설정", action: () => dfsOpenMenuMakerInWindow(focusSpec ? { focusIcon: focusSpec } : { initialTab: "icon" }) });
  }
}
/* ---------------- 바탕화면(가상 파일시스템) 항목의 우클릭 메뉴 (통합된 진짜 탐색기 창용) ----------------
   내용창/트리 어디서 온 항목이든 재사용할 수 있도록, id를 알면(it.dfsFolderId) 그걸 바로 쓰고
   모르면(트리에서 온 폴더처럼) 경로로 다시 찾는다. dfs* CRUD 함수들은 전부 그대로 재사용한다. */
function dfsDesktopResolveFolderId(it) {
  return it.dfsFolderId != null ? Promise.resolve(it.dfsFolderId) : dfsResolvePathToFolderId(it.path);
}
function dfsDesktopFolderMenuItems(it) {
  const refresh = () => dfsBroadcastChange();
  const items = [
    { label: "열기", action: () => navigate(it.path) },
    // 요청 #157: 이 통합 탐색기 창 안(가상 폴더 하위)에서 폴더를 다운로드할 때도, 실제 바탕화면
    // 아이콘의 폴더 우클릭(dfsBuildIconMenuItems)과 똑같이 zip/헬퍼 중 방식을 물어봐야 한다 -
    // 예전엔 여기만 묻지 않고 그냥 zip으로 내려받아서 두 곳의 동작이 서로 달랐다(버그 리포트).
    { label: "다운로드", action: async () => {
      const folderId = await dfsDesktopResolveFolderId(it);
      const node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
      if (node) await dfsDownloadFolderChoice(node);
    } },
    { label: "이름 변경", action: async () => {
      const folderId = await dfsDesktopResolveFolderId(it);
      const node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
      if (node) await dfsPromptRename(node, refresh);
    } },
    { label: "복사", action: async () => {
      const folderId = await dfsDesktopResolveFolderId(it);
      if (folderId != null) { dfsClipboard = { id: folderId, mode: "copy" }; showToast(`"${it.name}"을(를) 복사했습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); }
    } },
    { label: "잘라내기", action: async () => {
      const folderId = await dfsDesktopResolveFolderId(it);
      if (folderId != null) { dfsClipboard = { id: folderId, mode: "cut" }; showToast(`"${it.name}"을(를) 잘라냈습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); }
    } },
    { label: "삭제", action: async () => {
      const folderId = await dfsDesktopResolveFolderId(it);
      const node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
      if (!node) return;
      const ok = await showConfirmDialog(`"${node.name}"을(를) 삭제할까요? (안에 있는 것도 모두 삭제됩니다)`);
      if (!ok) return;
      await dfsDelete(node);
      await refresh();
    } },
    // 요청 #140: 바탕화면(가상 파일시스템) 폴더도 dexie 하위 트리를 재귀 집계해서 속성을 보여준다.
    { label: "속성", action: async () => {
      const folderId = await dfsDesktopResolveFolderId(it);
      if (folderId != null) await dfsShowDesktopFolderProperties(folderId, it.path);
    } }
  ];
  dfsPushIconSettingsMenuItem(items);
  return items;
}
/* ---------------- 휴지통 안 항목의 우클릭 메뉴 (요청 #113) ----------------
   내용창 칸(it.dfsNode/it.dfsFolderId로 이미 노드를 앎)이든 트리 행(경로로만 앎)이든 재사용
   가능하도록 dfsDesktopResolveFolderId와 같은 방식으로 노드를 다시 찾는다. */
function dfsRecycleBinResolveNode(it) {
  if (it.dfsNode) return Promise.resolve(it.dfsNode);
  return dfsDesktopResolveFolderId(it).then(id => id != null ? dfsDb.nodes.get(id) : null);
}
function dfsRecycleBinItemMenuItems(it) {
  const refresh = () => dfsBroadcastChange();
  return [
    { label: "복원", action: async () => {
      const node = await dfsRecycleBinResolveNode(it);
      if (node) { await dfsRestoreFromRecycleBin(node); await refresh(); }
    } },
    { label: "영구 삭제", action: async () => {
      const node = await dfsRecycleBinResolveNode(it);
      if (!node) return;
      const ok = await showConfirmDialog(`"${node.name}"을(를) 영구적으로 삭제할까요? (복구할 수 없습니다)`);
      if (!ok) return;
      await dfsPermanentlyDelete(node);
      await refresh();
    } }
  ];
}
function dfsDesktopFileMenuItems(it) {
  const refresh = () => dfsBroadcastChange();
  const node = it.dfsNode;
  if (node.type === "shortcut") {
    const shortcutItems = [
      { label: "열기", action: () => dfsActivate(node) },
      { label: "이름 변경", action: async () => dfsPromptRename(node, refresh) },
    ];
    // 요청 #153: targetId 방식(기존 항목을 가리키는 바로가기)도 이제 편집/다운로드가 가능하다 -
    // dfsEditShortcut/dfsDownloadShortcutFile이 dfsShortcutTargetUrl로 지금 가리키는 위치를
    // 딥링크 주소로 즉석 변환해서 처리해준다(편집해서 저장하면 그 순간부터 url 방식으로 바뀐다).
    shortcutItems.push({ label: "편집", action: () => dfsEditShortcut(node, refresh) });
    shortcutItems.push({ label: "다운로드(.sc)", action: () => dfsDownloadShortcutFile(node) });
    shortcutItems.push(
      { label: "복사", action: () => { dfsClipboard = { id: node.id, mode: "copy" }; showToast(`"${node.name}"을(를) 복사했습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); } },
      { label: "잘라내기", action: () => { dfsClipboard = { id: node.id, mode: "cut" }; showToast(`"${node.name}"을(를) 잘라냈습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); } },
      { label: "삭제", action: async () => {
        const ok = await showConfirmDialog(`"${node.name}"을(를) 삭제할까요?`);
        if (!ok) return;
        await dfsDelete(node);
        await refresh();
      } },
      // 요청 #140: 바로가기는 재귀 집계가 필요 없으니(대상 하나뿐) 간단히 대상/이름만 보여준다.
      { label: "속성", action: () => dfsShowDesktopFileProperties(node, it.path) }
    );
    // 요청 #148: 바로가기는 "아이콘 설정"(확장자별 아이콘)이 필요 없다 - 아이콘은 이미 이 바로가기
    // 자신의 icon 필드(위 "편집")로 지정하므로, 여기서는 dfsPushIconSettingsMenuItem을 부르지 않는다.
    return shortcutItems;
  }
  // 요청 #145: 이진 파일은 에디터로 열 수 없다 - 이미지만 "미리보기(새 탭)"를 대신 넣고, 그 외
  // 이진 파일은 아래 다운로드 항목들만으로 충분하다(더블클릭도 다운로드로 동작 - dfsActivate).
  const fileItems = node.binary
    ? ((node.mime || "").indexOf("image/") === 0 ? [{ label: "미리보기(새 탭)", action: () => dfsActivate(node) }] : [])
    : [{ label: "에디터로 열기", action: () => dfsActivate(node) }];
  // 요청 #162: 바탕화면에 저장된 HTML 파일은 에디터의 미리보기(스크립트 미실행)와 별개로, 실제
  // 웹페이지처럼 스크립트도 실행되는 새 탭으로 바로 볼 수 있게 한다(blob: URL 뷰어).
  if (!node.binary && it.type === "html") {
    fileItems.push({ label: "새 탭에서 보기(뷰어)", action: () => dfsOpenHtmlAsViewerTab(node) });
  }
  fileItems.push(
    // 실제 탐색기 파일 메뉴와 순서를 맞춘다: 다운로드(웹훅으로 로컬 헬퍼가 저장) 다음
    // 브라우저에서 다운로드(강제 blob 다운로드).
    { label: "다운로드", action: () => localHelperSaveContent(node.name, node.binary ? node.blob : (node.content || "")) },
    { label: "브라우저에서 다운로드", action: () => dfsDownloadVirtualFile(node) },
    { label: "이름 변경", action: async () => dfsPromptRename(node, refresh) },
    { label: "복사", action: () => { dfsClipboard = { id: node.id, mode: "copy" }; showToast(`"${node.name}"을(를) 복사했습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); } },
    { label: "잘라내기", action: () => { dfsClipboard = { id: node.id, mode: "cut" }; showToast(`"${node.name}"을(를) 잘라냈습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); } },
    { label: "바로가기 만들기", action: async () => { await dfsCreateShortcut(node); await refresh(); } },
    { label: "삭제", action: async () => {
      const ok = await showConfirmDialog(`"${node.name}"을(를) 삭제할까요?`);
      if (!ok) return;
      await dfsDelete(node);
      await refresh();
    } },
    // 요청 #140
    { label: "속성", action: () => dfsShowDesktopFileProperties(node, it.path) }
  );
  // 요청 #148: 바탕화면 파일도 확장자별 아이콘 항목을 바로 열 수 있게.
  const dfsFileExt = fileExtOf(node.name);
  dfsPushIconSettingsMenuItem(fileItems, dfsFileExt ? { type: "ext", key: dfsFileExt } : null);
  return fileItems;
}
/* ============ 브라우저 기본 우클릭 메뉴/드래그 선택 우회 방지 (강화판) ============
   사용자 리포트: 예전 방식(contextmenu 이벤트만 막음)은 일부 우회 경로를 못 막았다 - 예를 들어
   오른쪽 버튼으로 누른 채 드래그하다 페이지 밖(또는 다른 요소) 위에서 놓으면 일부 브라우저/OS
   조합에서 contextmenu 이벤트 자체가 안 뜨고 곧장 다른 기본 동작(네이티브 텍스트 선택/드래그
   등)으로 새는 경우가 있었다. 참조 코드처럼 두 겹으로 막는다:
     1) contextmenu 이벤트는 여전히 각 요소(아이콘/트리 행/내용창 등)마다 다른 메뉴를 만들어야
        하므로(참조 코드처럼 전역 메뉴 하나로 통일 못 함), 여기서는 stopImmediatePropagation을
        쓰지 않고 preventDefault만 하는 최종 안전망으로 남겨둔다 - 각 요소의 개별 contextmenu
        핸들러(버블 단계)는 그대로 자기 메뉴를 연다.
     2) 오른쪽 버튼 mousedown 자체를 캡처 단계에서 기본 동작을 막아서, 브라우저가 "우클릭 드래그"로
        뭔가를 시작할 계기 자체를 원천 차단한다(참조 코드의 핵심 아이디어) - 이렇게 하면 설령
        contextmenu 이벤트가 새더라도 애초에 새어나갈 네이티브 동작이 없다.
     3) 텍스트/아이콘을 네이티브로 드래그해서 끌어내는 것도(=이 페이지가 진짜 웹페이지라는 티가
        나는 대표적인 우회 경로) input/textarea를 제외한 모든 곳에서 막는다.
   CSS 쪽에서도 body 전체에 user-select:none을 걸고 입력창(input/textarea)에서만 다시 풀어주는
   식으로 짝을 맞췄다(각 테마의 style.css 참고) - 드래그로 화면 텍스트가 긁히는 것 자체를
   막아야 애초에 "드래그 선택 -> 우클릭 -> 복사" 같은 우회가 성립하지 않는다. ==================== */
function blockNativeContextMenu(e) { e.preventDefault(); return false; }
window.addEventListener("contextmenu", blockNativeContextMenu, { capture: true, passive: false });
document.oncontextmenu = () => false;
window.addEventListener("mousedown", (e) => {
  if (e.button === 2) e.preventDefault();
}, { capture: true, passive: false });
document.addEventListener("dragstart", (e) => {
  const tag = (e.target && e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return; // 입력창 안에서 텍스트를 드래그로 재배치하는 건 정상 동작이므로 예외
  // 버그 리포트: 이 캡처 단계 차단기가 draggable="true"로 표시해둔 이 앱 "자신"의 요소(가상
  // 파일시스템 내용창의 칸 - content-pane.js의 cell.draggable=true)까지 막아버려서, 폴더 안에서
  // 항목을 다른 폴더 위로 끌어다 옮기는 내부 드래그 자체가 아예 시작도 못 하고 있었다. 그 칸의
  // 자체 dragstart 핸들러가 stopPropagation으로 버블링은 막아뒀지만, 이 리스너는 캡처 단계라서
  // 그보다 먼저 실행돼 preventDefault로 드래그를 끊어버린 것 - 이 앱이 의도적으로 드래그 가능하게
  // 표시해둔 요소는 예외로 둔다(막아야 할 건 브라우저가 "저절로" 드래그 가능하게 만든 이미지/텍스트
  // /링크 같은 것들뿐).
  if (e.target && e.target.closest && e.target.closest('[draggable="true"]')) return;
  e.preventDefault();
}, true);
document.addEventListener("click", closeContextMenu);
document.addEventListener("scroll", closeContextMenu, true);

// 실제 탐색기처럼 Tab이 브라우저 포커스 순환을 마구 돌리지 않게 막는다 (단순하게 그냥 전부 막음).
document.addEventListener("keydown", (e) => { if (e.key === "Tab") e.preventDefault(); }, true);

/* ============ 요청 #119/#120: ESC로 모든 우클릭 메뉴 닫기 + 키보드 "컨텍스트 메뉴 호출" 키로
   지금 선택된 항목의 메뉴 열기 ============
   실제 우클릭을 흉내내려고, 대상 DOM 요소에 실제 contextmenu 이벤트를 그 요소의 중심 좌표로 직접
   발생시킨다(dispatchEvent) - 이러면 각 요소가 이미 갖고 있는 우클릭 핸들러(선택 상태 갱신 + 메뉴
   구성)를 그대로 재사용하게 돼서 메뉴 내용이 실제 우클릭과 완전히 같아지고 로직이 중복되지 않는다.
   지금 어느 영역(바탕화면 아이콘층/통합 탐색기 내용창/왼쪽 트리)에 키보드 포커스가 있는지로 대상을
   정하고, 그 안에서 선택된 항목이 없으면 그 영역의 빈 곳 메뉴로, 그것도 없으면(예: 아무데도 포커스
   가 없음) 최종적으로 바탕화면 빈 곳 메뉴로 대체한다. */
function findContextMenuKeyTarget() {
  const active = document.activeElement;
  if (els.dfIconLayer && active === els.dfIconLayer && typeof dfsFindContextMenuKeyIcon === "function") {
    return dfsFindContextMenuKeyIcon();
  }
  if (els.contentPane && active === els.contentPane && typeof findContentPaneContextMenuKeyCell === "function") {
    return findContentPaneContextMenuKeyCell();
  }
  if (els.navPane && active === els.navPane) {
    return els.navPane.querySelector(".selected");
  }
  return null;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (activeCtxMenu) { e.preventDefault(); e.stopPropagation(); closeContextMenu(); }
    return; // ESC의 다른 동작(대화상자 취소 등)은 각자의 리스너가 그대로 처리하도록 건드리지 않음
  }
  if (e.key !== "ContextMenu") return; // 풀사이즈/오피스 키보드에만 있는 "메뉴 호출" 키
  e.preventDefault();
  const target = findContextMenuKeyTarget();
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  if (target) {
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    }));
    return;
  }
  const active = document.activeElement;
  if (els.contentPane && active === els.contentPane && typeof contentPaneOpenBackgroundMenu === "function") {
    contentPaneOpenBackgroundMenu(cx, cy);
    return;
  }
  // 그 외(트리에 포커스가 있었지만 선택된 게 없거나, 바탕화면에 포커스가 있는데 선택된 아이콘이
  // 없거나, 아무 데도 포커스가 없는 경우)는 실제 윈도우처럼 결국 바탕화면 컨텍스트로 대체한다.
  if (typeof dfsDb !== "undefined" && dfsDb && typeof dfsBuildDesktopBackgroundMenuItems === "function") {
    showContextMenu(cx, cy, dfsBuildDesktopBackgroundMenuItems());
  }
});

