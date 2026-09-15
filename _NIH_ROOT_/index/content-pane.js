/* ============ 내용창(오른쪽) ============ */
async function renderContentPane() {
  currentHeading = null;
  els.contentPane.innerHTML = '<div class="status-msg">불러오는 중...</div>';
  let entry;
  try {
    entry = await loadDir(currentPath);
  } catch (err) {
    currentItems = [];
    els.contentPane.innerHTML = `<div class="empty-msg">폴더를 열지 못했습니다: ${escapeHtml(err.message)}</div>`;
    updateStatus();
    return;
  }
  currentItems = [
    ...entry.folders.map(name => ({ name, path: [...currentPath, name], type: "folder", dfsFolderId: entry.folderNodes ? entry.folderNodes.get(name)?.id : undefined })),
    ...entry.files.map(f => ({ name: f.name, size: f.size, crc32: f.crc32, path: [...currentPath, f.name], type: fileTypeFor(f.name), dfsNode: f.dfsNode }))
  ];
  currentOpts = { emptyText: "이 폴더는 비어 있습니다." };
  paintContentPane();
  updateStatus();
}

/* 검색 결과 위치 표시용: fromArr 기준 toArr의 상대 경로 ("../"를 포함할 수 있음) */
function relativePathBetween(fromArr, toArr) {
  let i = 0;
  while (i < fromArr.length && i < toArr.length && fromArr[i] === toArr[i]) i++;
  const ups = fromArr.length - i;
  const rest = toArr.slice(i);
  const parts = [];
  for (let k = 0; k < ups; k++) parts.push("..");
  const joined = parts.concat(rest).join("/");
  return joined || ".";
}
function dirLabelFor(it, opts) {
  const dirParts = it.path.slice(0, -1);
  if (opts.relativeTo) {
    const rel = relativePathBetween(opts.relativeTo, dirParts);
    return rel === "." ? "(현재 폴더)" : rel;
  }
  return dirParts.join("/") || repoName;
}
// ---------------- 실제 저장소 파일을 진짜 OS 바탕화면/탐색기로 끌어내기 ----------------
// 사용자 지시: "레포 안에 있는 파일을 밖으로 끌어내면 그게 텍스트 형식의 파일(확장자 무관)인
// 경우 바로 바탕화면으로 꺼내버려(js fetch로 파일 형식 빠르게 판단해서 한다)" - 크롬 계열
// 브라우저는 드래그의 dataTransfer에 "DownloadURL" 항목을 채워두면 놓인 곳이 진짜 OS 바탕화면/
// 탐색기일 때 브라우저가 그 URL을 직접 받아서 파일로 저장해준다(우리가 내용을 미리 다 들고
// 있을 필요가 없음) - 다만 "텍스트 파일일 때만" 허용해야 하므로, 드래그가 실제로 시작되기 전에
// (폴더가 그려지는 시점에 백그라운드로) 앞부분만 fetch해서 dfLooksLikeText로 판별해 캐시해둔다.
// dragstart는 동기적으로 dataTransfer를 채워야 해서 그 자리에서 fetch를 기다릴 수 없으므로,
// 아직 판별이 안 끝난 상태(드문 경우 - 폴더를 열자마자 바로 끄는 경우)에서 드래그를 시작하면
// 그냥 아무 일도 없는 것으로 취급한다(강제로 기다리게 하면 네이티브 드래그 자체가 끊긴다).
const dfRepoTextSniffCache = new Map(); // key: path.join("/") -> true(텍스트)/false(아님)
async function dfSniffRepoFileIsText(it) {
  const key = it.path.join("/");
  if (dfRepoTextSniffCache.has(key)) return dfRepoTextSniffCache.get(key);
  try {
    const url = absoluteFileUrl(it.path);
    // 큰 파일을 통째로 내려받지 않도록 앞부분만 Range로 요청해본다(서버가 Range를 무시하고
    // 전체를 돌려줘도 어차피 아래에서 8000자만 잘라 쓰므로 판별 결과는 똑같다).
    const res = await fetch(url, { headers: { Range: "bytes=0-8000" } });
    if (!res.ok && res.status !== 206) throw new Error(String(res.status));
    const text = await res.text();
    const isText = dfLooksLikeText(text.slice(0, 8000));
    dfRepoTextSniffCache.set(key, isText);
    return isText;
  } catch (e) {
    return false; // 네트워크 오류 등 - 캐시에 남기지 않아 다음에 다시 시도할 수 있게 한다
  }
}
function attachRepoFileDragOut(cell, it) {
  cell.draggable = true;
  dfSniffRepoFileIsText(it); // 그려지자마자 백그라운드로 미리 판별해둔다(실제 드래그 전에 끝날 확률을 높임)
  cell.addEventListener("dragstart", (e) => {
    e.stopPropagation(); // els.contentPane의 전역 dragstart 리스너(아래)가 취소해버리지 않게
    const key = it.path.join("/");
    if (dfRepoTextSniffCache.get(key) !== true) { e.preventDefault(); return; }
    const url = absoluteFileUrl(it.path);
    e.dataTransfer.setData("DownloadURL", `text/plain:${it.name}:${url}`);
    e.dataTransfer.effectAllowed = "copy";
  });
}
function buildGrid(items, opts) {
  if (items.length === 0) {
    const div = document.createElement("div");
    div.className = "empty-msg";
    div.textContent = opts.emptyText || "이 폴더는 비어 있습니다.";
    return div;
  }
  const grid = document.createElement("div");
  grid.className = "grid";
  // 바탕화면(가상 파일시스템) 폴더를 보고 있을 때만 그리드 안에서 드래그로 옮기기/OS 파일 드롭이
  // 동작한다 - 실제 저장소 폴더는 읽기 전용이라 옮길 수 없기 때문(하나로 통합된 창이라 지금
  // 보고 있는 위치가 바탕화면인지 여부로 판단한다).
  const desktopMode = !opts.flat && isDesktopPath(currentPath);
  // 요청 #113: 휴지통 안에서도 항목을 "밖으로" 끌어내 복원할 수 있어야 하므로(드래그 출발) 이
  // 모드도 필요하다 - 다만 휴지통 폴더 칸을 "그 안으로 넣는" 드롭 대상으로 삼진 않는다(그건
  // desktopMode에서만, 아래 참고).
  const recycleBinMode = !opts.flat && isRecycleBinPath(currentPath);
  items.forEach(it => {
    const key = it.path.join("/");
    const isMultiSel = multiSelected.size > 1 && multiSelected.has(key);
    const isSingleSel = multiSelected.size <= 1 && selected && selected.path.join("/") === key;
    const cell = document.createElement("div");
    cell.className = "grid-item" + (opts.flat ? " flat" : "") + ((isMultiSel || isSingleSel) ? " selected" : "");
    cell.dataset.key = key;
    const icon = it.dfsNode ? dfsIconGlyphFor(it.dfsNode, 32) : (it.type === "folder" ? resolveFolderIcon(it.path, 32, false) : resolveFileIcon(it.name, 32, it.path));
    // 요청: 검색 결과(flat)에서 태그가 있는 항목은 위치 아래에 태그도 같이 보여준다(어떤 태그로
    // 걸렸는지 바로 알 수 있게) - 태그가 없는 항목은 예전 그대로 위치만 보여준다.
    const tagsHtml = (opts.flat && it.tags && it.tags.length) ? `<div class="sub tag-sub">${it.tags.map(t => "#" + escapeHtml(t)).join(" ")}</div>` : "";
    const subHtml = opts.flat ? `<div class="sub">${escapeHtml(dirLabelFor(it, opts))}</div>${tagsHtml}` : "";
    // 요청 #141: .sc 바로가기 파일은 실제 윈도우가 .lnk 확장자를 숨기는 것처럼 목록에는 확장자를 뺀
    // 이름으로 보여준다(실제 파일명 자체는 그대로라서 다운로드/속성 등은 전혀 영향받지 않는다).
    cell.innerHTML = `<div class="icon">${icon}</div><div class="label">${escapeHtml(displayName(it.name))}</div>${subHtml}`;
    cell.onclick = () => {
      els.contentPane.focus();
      multiSelected.clear();
      selected = { path: it.path, name: it.name, type: it.type };
      paintContentPane();
      updateStatus();
    };
    cell.ondblclick = () => activate(it);
    cell.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (multiSelected.size > 1 && multiSelected.has(key)) {
        showContextMenu(e.clientX, e.clientY, buildMultiFileMenuItems([...multiSelected]));
        return;
      }
      multiSelected.clear();
      selected = { path: it.path, name: it.name, type: it.type };
      paintContentPane();
      showContextMenu(e.clientX, e.clientY, buildFileMenuItems(it));
    };
    if (desktopMode || recycleBinMode) {
      const srcId = it.type === "folder" ? it.dfsFolderId : (it.dfsNode ? it.dfsNode.id : null);
      if (srcId != null) {
        // 바탕화면 아이콘(.df-icon)을 마우스로 끌어다 이 칸 위에 놓는 것(desktop-fs.js의
        // dfsSetupIconDrag -> dfsElementUnder)도 이 dataset.id로 대상을 찾는다 - 이게 없으면
        // 바탕화면에서 탐색기 창 안의 폴더 칸으로 끌어다 놔도 대상을 못 찾아 아무 일도 안 일어난다.
        // 휴지통 안 항목도 이 dataset.id/draggable을 그대로 갖게 해서(요청 #113) 밖으로 끌어내면
        // 복원(dfsMove가 originalParentId/deletedAt을 자동으로 지움)이 되게 한다.
        cell.dataset.id = String(srcId);
        cell.draggable = true;
        cell.addEventListener("dragstart", (e) => {
          // els.contentPane에 걸려있는 전역 dragstart 리스너(밑에서 텍스트/이미지 드래그를 막으려고
          // e.preventDefault()를 부름)가 이 이벤트까지 취소해버리면 드래그 자체가 바로 끊기므로,
          // 버블링을 막아서 그 리스너에 닿지 않게 한다.
          e.stopPropagation();
          e.dataTransfer.setData("text/plain", String(srcId));
          e.dataTransfer.effectAllowed = "move";
        });
      }
      if (desktopMode && it.type === "folder" && it.dfsFolderId != null) {
        cell.addEventListener("dragover", (e) => {
          if (!e.dataTransfer) return;
          const types = Array.from(e.dataTransfer.types || []);
          if (types.indexOf("Files") === -1 && types.indexOf("text/plain") === -1 && types.indexOf("DownloadURL") === -1) return;
          e.preventDefault();
          cell.classList.add("df-drop-target");
        });
        cell.addEventListener("dragleave", () => cell.classList.remove("df-drop-target"));
        cell.addEventListener("drop", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          cell.classList.remove("df-drop-target");
          // 저장소(GitHub 리포) 화면에서 텍스트 파일을 이 폴더 칸 위로 끌어다 놓은 경우: 다운로드
          // 없이 바로 이 폴더 안에 가상 파일로 가져온다(버그 리포트: 바탕화면엔 되는데 그 안의
          // 폴더에는 안 됐던 문제 - dfDragHasRepoFile/dfHandleRepoFileDrop 참고).
          if (dfDragHasRepoFile(e)) {
            await dfHandleRepoFileDrop(e, it.dfsFolderId, () => renderContentPane());
            return;
          }
          // 진짜 컴퓨터(OS)에서 파일을 이 폴더 칸 위로 끌어다 놓은 경우: 텍스트 파일이면 그
          // 폴더 안으로 즉시 가져온다.
          if (e.dataTransfer.files && e.dataTransfer.files.length) {
            await dfsImportOsFileList(it.dfsFolderId, e.dataTransfer.files, () => renderContentPane());
            return;
          }
          const draggedId = Number(e.dataTransfer.getData("text/plain"));
          if (!draggedId || draggedId === it.dfsFolderId) return;
          const srcNode = await dfsDb.nodes.get(draggedId);
          if (!srcNode) return;
          const ok = await dfsMove(srcNode, it.dfsFolderId);
          if (ok) showToast(`"${srcNode.name}"을(를) "${it.name}" 폴더로 옮겼습니다.`, { sound: "move_or_copy" });
          await dfsBroadcastChange();
        });
      }
    } else if (it.type !== "folder") {
      // 진짜 저장소 파일(바탕화면/휴지통이 아닌 읽기 전용 영역, 검색 결과의 flat 목록 포함) -
      // 옮기거나 지울 순 없지만, 진짜 OS 바탕화면으로 "꺼내는" 드래그는 가능하다(텍스트 파일일
      // 때만, attachRepoFileDragOut 참고). 폴더 항목은 대상이 아니므로 제외한다.
      attachRepoFileDragOut(cell, it);
    }
    grid.appendChild(cell);
  });
  return grid;
}
// Ctrl+A = 내용창(오른쪽) 항목 전체 선택 (keyboard-and-activate.js의 전역 keydown 리스너에서 호출됨).
// 항목이 1개뿐이면 굳이 다중선택 취급하지 않고 그냥 그 하나를 단일 선택한다(러버밴드 마우스업과
// 동일한 규칙 - buildGrid의 isMultiSel/isSingleSel 판정이 multiSelected.size > 1을 기준으로 하므로,
// 1개짜리를 multiSelected에 넣으면 오히려 선택 표시가 하나도 안 붙는 모순이 생긴다).
function selectAllContentPane() {
  if (!currentItems.length) return;
  if (currentItems.length === 1) {
    const it = currentItems[0];
    multiSelected.clear();
    selected = { path: it.path, name: it.name, type: it.type };
  } else {
    multiSelected = new Set(currentItems.map(it => it.path.join("/")));
    selected = null;
  }
  paintContentPane();
  updateStatus();
}
function paintContentPane() {
  els.contentPane.innerHTML = "";
  if (currentHeading) {
    const h = document.createElement("div");
    h.className = "search-heading";
    h.textContent = currentHeading;
    els.contentPane.appendChild(h);
  }
  els.contentPane.appendChild(buildGrid(currentItems, currentOpts));
}

/* ============ 내용창 드래그(러버밴드) 다중 선택 ============
   빈 배경에서 마우스를 누른 채 드래그하면 사각형과 겹치는 항목들을 모두 선택한다.
   selectBox와 겹치는지는 offsetLeft/Top 기준(스크롤과 무관한 콘텐츠 좌표계)으로 계산한다. */
let dragSelectStart = null;
els.contentPane.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest(".grid-item")) return; // 아이템 위에서 시작하면 드래그 선택을 시작하지 않음
  e.preventDefault();
  els.contentPane.focus();
  const rect = els.contentPane.getBoundingClientRect();
  dragSelectStart = { x: e.clientX - rect.left + els.contentPane.scrollLeft, y: e.clientY - rect.top + els.contentPane.scrollTop };
  const box = document.createElement("div");
  box.className = "select-box";
  box.id = "dragSelectBox";
  els.contentPane.appendChild(box);
  multiSelected.clear();
  selected = null;
});
window.addEventListener("mousemove", (e) => {
  if (!dragSelectStart) return;
  const box = document.getElementById("dragSelectBox");
  if (!box) return;
  const rect = els.contentPane.getBoundingClientRect();
  const curX = e.clientX - rect.left + els.contentPane.scrollLeft;
  const curY = e.clientY - rect.top + els.contentPane.scrollTop;
  const left = Math.min(dragSelectStart.x, curX), top = Math.min(dragSelectStart.y, curY);
  const w = Math.abs(curX - dragSelectStart.x), h = Math.abs(curY - dragSelectStart.y);
  box.style.left = left + "px"; box.style.top = top + "px"; box.style.width = w + "px"; box.style.height = h + "px";

  const boxRect = { left, top, right: left + w, bottom: top + h };
  multiSelected.clear();
  els.contentPane.querySelectorAll(".grid-item").forEach(cell => {
    const cLeft = cell.offsetLeft, cTop = cell.offsetTop;
    const cRect = { left: cLeft, top: cTop, right: cLeft + cell.offsetWidth, bottom: cTop + cell.offsetHeight };
    const intersects = !(cRect.left > boxRect.right || cRect.right < boxRect.left || cRect.top > boxRect.bottom || cRect.bottom < boxRect.top);
    if (intersects) { multiSelected.add(cell.dataset.key); cell.classList.add("selected"); }
    else cell.classList.remove("selected");
  });
});
window.addEventListener("mouseup", () => {
  if (!dragSelectStart) return;
  dragSelectStart = null;
  const box = document.getElementById("dragSelectBox");
  if (box) box.remove();
  if (multiSelected.size === 1) {
    // 하나만 걸렸으면 일반 단일 선택으로 취급
    const key = [...multiSelected][0];
    const it = currentItems.find(i => i.path.join("/") === key);
    multiSelected.clear();
    if (it) selected = { path: it.path, name: it.name, type: it.type };
  }
  // 버그 리포트: "단순 빈 화면 클릭시 드래그 안 풀림. 빈 화면에 작게 드래그를 해야 풀림" - 마우스를
  // 전혀 움직이지 않은 순수 클릭이면 mousemove 리스너가 한 번도 안 불려서 화면(DOM)의 .selected
  // 클래스가 그대로 남아있었다(mousedown에서 상태(multiSelected/selected)는 이미 비웠지만 화면을
  // 다시 그리는 건 이 size===1 분기 안에서만 했었음). 항상 다시 그려서 실제 드래그가 없어도
  // 빈 화면 클릭 한 번에 확실히 선택이 풀리도록 한다.
  paintContentPane();
  updateStatus();
});
els.navPane.addEventListener("dragstart", (e) => e.preventDefault());
els.contentPane.addEventListener("dragstart", (e) => e.preventDefault());

/* ============ 내용창(바탕화면 경로일 때만): 빈 영역 우클릭 메뉴 + 진짜 컴퓨터(OS) 파일 드롭 가져오기 ============
   진짜 저장소 폴더는 읽기 전용이라 해당 없음 - 지금 보고 있는 경로(currentPath)가 바탕화면
   안일 때만 동작한다(하나로 통합된 창이라 매번 currentPath로 판단). 리스너는 렌더될 때마다
   새로 붙이지 않고 한 번만 등록한다(중복 등록 버그 방지 - 이전에 겪었던 문제). ============ */
els.contentPane.addEventListener("dragover", (e) => {
  if (!isDfsPath(currentPath)) return;
  if (e.target.closest(".grid-item")) return; // 폴더 칸 위는 그 칸 자체의 리스너가 처리
  if (!e.dataTransfer) return;
  const types = Array.from(e.dataTransfer.types || []);
  if (types.indexOf("Files") === -1 && types.indexOf("text/plain") === -1 && types.indexOf("DownloadURL") === -1) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
});
// text/plain(트리 행이나 다른 폴더의 grid-item에서 네이티브 드래그로 끌려온 가상 파일시스템 노드
// id)을 특정 폴더 칸이 아니라 이 내용창의 빈 곳/배경에 놓으면, 바탕화면 아이콘을 창 안으로 끌어다
// 놓을 때(desktop-fs.js dfsSetupIconDrag의 "지금 보고 있는 폴더로" 폴백)와 똑같이 "지금 보고 있는
// 폴더(currentPath)" 안으로 옮긴다 - 버그 리포트: "트리에서... 폴더 탐색기 안쪽으로 넣을 수도
// 있어야 함". 요청 #113: 지금 보고 있는 게 휴지통이면 "안으로 넣기"가 아니라 삭제(휴지통 이동)다.
els.contentPane.addEventListener("drop", async (e) => {
  if (!isDfsPath(currentPath)) return;
  if (e.target.closest(".grid-item")) return;
  if (!e.dataTransfer) return;
  e.preventDefault();
  if (isRecycleBinPath(currentPath)) {
    const draggedId = Number(e.dataTransfer.getData("text/plain"));
    if (!draggedId) return;
    const srcNode = await dfsDb.nodes.get(draggedId);
    if (!srcNode || srcNode.parentId === DFS_RECYCLEBIN_ROOT) return;
    await dfsDelete(srcNode);
    showToast(`"${srcNode.name}"을(를) 휴지통으로 옮겼습니다.`, { sound: "delete_to_recyclebin" });
    await dfsBroadcastChange();
    return;
  }
  // 저장소 화면에서 끌어온 텍스트 파일을 지금 보고 있는 폴더(바탕화면 안의 하위 폴더 포함)의
  // 빈 곳/배경에 놓은 경우 - dfDragHasRepoFile/dfHandleRepoFileDrop 참고.
  if (dfDragHasRepoFile(e)) {
    const folderId = await dfsResolvePathToFolderId(currentPath);
    if (folderId == null) return;
    await dfHandleRepoFileDrop(e, folderId, () => renderContentPane());
    return;
  }
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    const folderId = await dfsResolvePathToFolderId(currentPath);
    if (folderId == null) return;
    await dfsImportOsFileList(folderId, e.dataTransfer.files, () => renderContentPane());
    return;
  }
  const draggedId = Number(e.dataTransfer.getData("text/plain"));
  if (!draggedId) return;
  const folderId = await dfsResolvePathToFolderId(currentPath);
  if (folderId == null || draggedId === folderId) return;
  const srcNode = await dfsDb.nodes.get(draggedId);
  if (!srcNode || srcNode.parentId === folderId) return;
  const ok = await dfsMove(srcNode, folderId);
  if (ok) showToast(`"${srcNode.name}"을(를) 옮겼습니다.`, { sound: "move_or_copy" });
  await dfsBroadcastChange();
});
// 요청 #119/#120/#129: 마우스 우클릭 리스너와 컨텍스트 메뉴 키(선택된 항목이 없을 때의 대체 동작)
// 양쪽에서 재사용할 수 있도록 이름 있는 함수로 뺐다. 실제 저장소 폴더(읽기 전용)와 바탕화면/휴지통
// (가상 파일시스템) 모두 각자의 빈 영역 메뉴를 갖는다.
function contentPaneOpenBackgroundMenu(x, y) {
  if (!isDfsPath(currentPath)) {
    // 요청 #129: 실제 저장소 폴더는 CRUD가 없으니 "새로고침"/"경로 복사"/"속성"만 제공한다. 위
    // 툴바의 새로고침 버튼과 완전히 같은 함수(refreshCurrentFolder)를 그대로 호출하므로 결과
    // 토스트도 항상 똑같이 나온다. 요청 #140: "속성"은 지금 폴더(currentPath) 기준으로 하위
    // pages.json을 실시간으로 재귀 집계해서 파일 개수/전체 크기를 보여준다.
    showContextMenu(x, y, [
      { label: "새로고침", action: () => refreshCurrentFolder() },
      { label: "경로 복사", action: () => copyCurrentUrlToClipboard() },
      { label: "태그 편집", action: () => openTagEditorForFolder(currentPath) },
      { label: "속성", action: () => showRepoFolderProperties(currentPath, { kind: currentPath.length ? "폴더" : "저장소 루트 폴더" }) }
    ]);
    return;
  }
  // 요청 #113: 휴지통의 빈 영역 메뉴는 새 폴더 등 CRUD가 아니라 [휴지통 비우기, 속성]뿐이다.
  if (isRecycleBinPath(currentPath)) {
    showContextMenu(x, y, [
      { label: "휴지통 비우기", action: async () => { await dfsEmptyRecycleBin(); await dfsBroadcastChange(); } },
      { label: "속성", action: () => dfsShowRecycleBinProperties() }
    ]);
    return;
  }
  dfsResolvePathToFolderId(currentPath).then(folderId => {
    if (folderId == null) return;
    showContextMenu(x, y, dfsBuildEmptyAreaMenuItems(folderId, () => dfsBroadcastChange(), currentPath));
  });
}
els.contentPane.addEventListener("contextmenu", (e) => {
  if (e.target.closest(".grid-item")) return;
  e.preventDefault();
  e.stopPropagation();
  contentPaneOpenBackgroundMenu(e.clientX, e.clientY);
});

// 요청 #120: 컨텍스트 메뉴 키를 눌렀을 때 내용창(그리드)에서 메뉴를 열 기준 칸을 고른다. 이
// 내용창은 다중 선택을 러버밴드 드래그로만 만들 수 있고(Ctrl+클릭으로 하나씩 누적하는 방식은 없음
// - onclick 참고), 다중 선택은 늘 "한 번에 동시에 잡힌" 경우이므로 그때는 항상 가장 오른쪽 위
// (우측 상단) 칸을 기준으로 삼는다(desktop-fs.js의 dfsFindContextMenuKeyIcon과 같은 원리).
function findContentPaneContextMenuKeyCell() {
  const cellFor = (key) => [...els.contentPane.querySelectorAll(".grid-item")].find(c => c.dataset.key === key);
  if (multiSelected.size >= 2) {
    let best = null, bestScore = -Infinity;
    multiSelected.forEach(key => {
      const el = cellFor(key);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const score = r.right * 1000 - r.top;
      if (score > bestScore) { bestScore = score; best = el; }
    });
    return best;
  }
  if (selected) return cellFor(selected.path.join("/"));
  return null;
}

/* ============ 내용창(오른쪽) 방향키 내비게이션: 상하좌우 = 그리드 이동, 엔터 = 폴더 진입/파일 열기 시도.
   다중 선택 상태(2개 이상)에서 엔터는 "다중 열기"(위험함) 대신 순차 다운로드로 대체한다. ============ */
// 요청 #151: Shift+방향키로 실제 윈도우 탐색기처럼 범위 선택 - 앵커(범위 시작점)의 인덱스를
// 기억해뒀다가, 매번 "앵커~지금 커서" 사이 구간 전체를 새로 계산해서 선택한다(어느 방향으로
// 움직여도 항상 연속 구간이 되고, 앵커 쪽으로 되돌아가면 자연히 줄어든다). 화살표 핸들러가 아닌
// 다른 방법(마우스 클릭/드래그/Ctrl+A 등)으로 그 사이에 선택이 바뀌면 지문(fingerprint)이 달라져
// 다음 Shift+화살표에서 앵커를 새로 잡는다 - 굳이 그 모든 곳마다 리셋 코드를 넣지 않아도 된다.
let cpArrowAnchorIdx = null;
let cpArrowFocusIdx = null;
let cpArrowStateFingerprint = null;
function cpCurrentSelectionFingerprint() {
  if (multiSelected.size > 1) return "m:" + [...multiSelected].sort().join(",");
  if (selected) return "s:" + selected.path.join("/");
  return "s:";
}
els.contentPane.tabIndex = 0;
els.contentPane.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (multiSelected.size > 1) {
      handleMultiDownload(itemsFromKeys([...multiSelected]));
      return;
    }
    if (selected) {
      const it = currentItems.find(i => i.path.join("/") === selected.path.join("/"));
      if (it) activate(it);
    }
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  if (currentItems.length === 0) return;
  if (cpCurrentSelectionFingerprint() !== cpArrowStateFingerprint) {
    // 이 핸들러가 마지막으로 만들어둔 선택 상태와 지금이 다르면(다른 방법으로 선택이 바뀜) 앵커를 버린다.
    cpArrowAnchorIdx = null;
    cpArrowFocusIdx = null;
  }
  const cellW = currentOpts.flat ? 132 : 96;
  const gap = 4;
  const containerW = els.contentPane.clientWidth - 28; // padding 14px * 2
  const columns = Math.max(1, Math.floor((containerW + gap) / (cellW + gap)));
  let baseIdx;
  if (cpArrowFocusIdx != null && cpArrowFocusIdx >= 0 && cpArrowFocusIdx < currentItems.length) {
    baseIdx = cpArrowFocusIdx;
  } else {
    baseIdx = selected ? currentItems.findIndex(it => it.path.join("/") === selected.path.join("/")) : -1;
    if (baseIdx === -1) baseIdx = 0;
  }
  let idx = baseIdx;
  if (e.key === "ArrowRight") idx = Math.min(currentItems.length - 1, idx + 1);
  else if (e.key === "ArrowLeft") idx = Math.max(0, idx - 1);
  else if (e.key === "ArrowDown") idx = Math.min(currentItems.length - 1, idx + columns);
  else if (e.key === "ArrowUp") idx = Math.max(0, idx - columns);
  const it = currentItems[idx];
  if (!it) return;
  if (e.shiftKey) {
    if (cpArrowAnchorIdx == null) cpArrowAnchorIdx = baseIdx;
    cpArrowFocusIdx = idx;
    const lo = Math.min(cpArrowAnchorIdx, idx), hi = Math.max(cpArrowAnchorIdx, idx);
    if (lo === hi) {
      multiSelected.clear();
      selected = { path: it.path, name: it.name, type: it.type };
    } else {
      multiSelected = new Set(currentItems.slice(lo, hi + 1).map(x => x.path.join("/")));
      selected = null;
    }
  } else {
    cpArrowAnchorIdx = idx;
    cpArrowFocusIdx = idx;
    multiSelected.clear();
    selected = { path: it.path, name: it.name, type: it.type };
  }
  cpArrowStateFingerprint = cpCurrentSelectionFingerprint();
  paintContentPane();
  updateStatus();
  const cell = els.contentPane.querySelector(`[data-key="${CSS.escape(it.path.join("/"))}"]`);
  if (cell) cell.scrollIntoView({ block: "nearest" });
});

/* ============ 다중 선택 다운로드: 다중 "열기"는 위험하므로 대신 폴더를 한 번만 고르고
   그 폴더에 순차적으로 저장한다 (localserver.ahk의 /pickfolder + /savetofolder 사용). ============ */
function itemsFromKeys(keys) {
  return keys.map(k => currentItems.find(it => it.path.join("/") === k)).filter(Boolean);
}
function buildMultiFileMenuItems(keys) {
  const items = itemsFromKeys(keys);
  const menu = [];
  const inBin = isRecycleBinPath(currentPath);
  // 삭제는 바탕화면/휴지통(가상 파일시스템) 항목만 대상이다(실제 저장소는 읽기 전용이라 메뉴 자체가 없음).
  const deletableCount = items.filter(it => it.dfsNode || (it.type === "folder" && isDfsPath(it.path))).length;
  if (inBin) {
    // 요청 #113: 휴지통 안에서는 다운로드 대신 복원/영구 삭제 두 가지만 제공한다.
    if (deletableCount > 0) {
      menu.push({ label: `복원 (${deletableCount}개)`, action: () => handleMultiRestore(items) });
      menu.push({ label: `영구 삭제 (${deletableCount}개)`, action: () => handleMultiDelete(items) });
    }
    return menu;
  }
  // 요청 #115: 예전엔 폴더와 바탕화면(가상 파일시스템) 파일을 다중 "다운로드" 대상에서 제외했지만,
  // 이제 handleMultiDownload가 로컬 헬퍼를 통해 폴더(재귀적으로 구조 재현)와 가상 파일(내용을
  // 그대로 POST)까지 전부 처리하므로 선택한 항목 전체가 대상이 된다.
  if (items.length > 0) menu.push({ label: `다운로드 (${items.length}개)`, action: () => handleMultiDownload(items) });
  if (deletableCount > 0) menu.push({ label: `삭제 (${deletableCount}개)`, action: () => handleMultiDelete(items) });
  return menu;
}
/* 요청 #115: 다중 선택 다운로드에 폴더도 포함한다. 파일과 폴더가 섞여 있어도 저장 위치는 한
   번만 고르고, 폴더는 그 이름의 하위 폴더로 구조를 그대로 재현(비어 있는 하위 폴더까지)하며,
   실제 저장소 파일/폴더와 바탕화면(가상 파일시스템) 파일/폴더를 각각 알맞은 방식(로컬 헬퍼의
   /savetofolder·/savetopath는 URL을 다시 받아오고, /savecontentto는 이미 가진 내용을 그대로
   써넣음)으로 하나씩 처리한다. 폴더 하나만 다운로드하는 우클릭 메뉴(downloadFolderRecursive/
   dfsDownloadFolderChoice)와 뼈대는 같지만, 그 두 함수는 폴더마다 저장 위치를 새로 고르므로
   여기서는 그 중 "이미 고른 위치 아래에 폴더 구조를 재현하는" 부분만 떼어낸 함수(local-helper.js의
   downloadRealFolderIntoBase/dfsDownloadFolderIntoBase)를 재사용한다. */
async function handleMultiDownload(items) {
  if (!items.length) return;
  const port = await ensureHelperPort();
  if (port === null) { offerHelperDownload("다운로드"); return; }

  showToast("저장할 폴더를 선택하세요...", { sound: "download_start" });
  let baseRoot;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pickfolder`);
    baseRoot = (await res.text()).trim();
  } catch (e) {
    showToast(`폴더 선택 중 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
    return;
  }
  if (!baseRoot || baseRoot === "CANCELLED") { showToast("다운로드가 취소되었습니다.", { sound: "download_cancel" }); return; }

  const dlg = showCancelableProgressDialog("다운로드 준비 중...");
  let okCount = 0, failCount = 0;
  try {
    for (let i = 0; i < items.length; i++) {
      if (dlg.isCancelled()) { showToast(`다운로드가 취소되었습니다.${okCount ? ` (${okCount}개 저장됨)` : ""}`, { sound: "download_cancel" }); return; }
      const it = items[i];
      dlg.setText(`다운로드 중 (${i + 1}/${items.length}): ${it.name}`);
      try {
        if (it.type === "folder") {
          let result;
          if (isDfsPath(it.path)) {
            const folderId = await dfsDesktopResolveFolderId(it);
            const node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
            result = node ? await dfsDownloadFolderIntoBase(node, port, baseRoot, dlg) : { cancelled: false, ok: 0, fail: 1 };
          } else {
            result = await downloadRealFolderIntoBase(it, port, baseRoot, dlg);
          }
          okCount += result.ok; failCount += result.fail;
          if (result.cancelled) { showToast(`다운로드가 취소되었습니다.${okCount ? ` (${okCount}개 저장됨)` : ""}`, { sound: "download_cancel" }); return; }
        } else if (it.dfsNode) {
          const res = await fetch(`http://127.0.0.1:${port}/savecontentto?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(it.name)}`, {
            method: "POST",
            // 요청 #145: 이진 파일은 Blob 그대로 보낸다.
            body: (it.dfsNode.binary && it.dfsNode.blob) ? it.dfsNode.blob : (it.dfsNode.content || "")
          });
          if (!res.ok) throw new Error(String(res.status));
          okCount++;
        } else {
          const url = absoluteFileUrl(it.path);
          const res = await fetch(`http://127.0.0.1:${port}/savetofolder?url=${encodeURIComponent(url)}&folder=${encodeURIComponent(baseRoot)}&name=${encodeURIComponent(it.name)}${sizeQueryParam(it)}`);
          if (!res.ok) throw new Error(String(res.status));
          okCount++;
        }
      } catch (e) {
        failCount++;
      }
    }
    if (okCount > 0) dfNoteWebhookDownloadSucceeded(); // 요청 #152
    let msg = `다중 다운로드 완료: ${okCount}개`;
    if (failCount) msg += `, 실패 ${failCount}개`;
    showToast(msg, failCount ? { kind: "warn", sound: "download_error" } : { sound: "download_complete" });
  } finally {
    dlg.close();
  }
}

/* ============ 다중 선택 삭제: 바탕화면(가상 파일시스템) 항목만 지울 수 있다(실제 저장소 항목은
   애초에 "삭제" 메뉴 자체가 없는 읽기 전용). 드래그로 여러 개를 선택한 뒤 Delete 키를 누르거나
   우클릭 메뉴에서 선택하면 여기로 온다 - 확인 대화상자 하나로 한꺼번에 지운다(바탕화면 아이콘의
   다중 삭제, dfsDeleteSelectedIcons와 동일한 방식). ============ */
async function handleMultiDelete(items, permanent) {
  const inBin = isRecycleBinPath(currentPath);
  const resolved = [];
  for (const it of items) {
    if (it.type === "folder") {
      if (!isDfsPath(it.path)) continue; // 실제 저장소 폴더는 삭제 불가
      const folderId = await dfsDesktopResolveFolderId(it);
      const node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
      if (node) resolved.push(node);
    } else if (it.dfsNode) {
      resolved.push(it.dfsNode);
    }
    // 그 외(실제 저장소 파일)는 삭제 메뉴 자체가 없는 것과 동일하게 조용히 건너뛴다.
  }
  if (!resolved.length) return;
  // 요청 #113: 휴지통 안에서의 "삭제"는 영구 삭제다(다시 휴지통으로 옮길 곳이 없음) - 복구 불가 경고로 바꾼다.
  // 요청 #159: 휴지통 밖에서 Shift+Delete로 눌렀으면(permanent) 마찬가지로 영구 삭제 + 강한 경고 문구로 바꾼다.
  const msg = inBin
    ? (resolved.length === 1 ? `"${resolved[0].name}"을(를) 영구적으로 삭제할까요? (복구할 수 없습니다)` : `선택한 ${resolved.length}개 항목을 영구적으로 삭제할까요? (복구할 수 없습니다)`)
    : permanent
      ? (resolved.length === 1 ? `"${resolved[0].name}"을(를) 완전히 삭제할까요? (휴지통을 거치지 않고 바로 삭제되며 되돌릴 수 없습니다)` : `선택한 ${resolved.length}개 항목을 완전히 삭제할까요? (휴지통을 거치지 않고 바로 삭제되며 되돌릴 수 없습니다)`)
      : (resolved.length === 1 ? `"${resolved[0].name}"을(를) 삭제할까요?${resolved[0].type === "folder" ? " (안에 있는 것도 모두 삭제됩니다)" : ""}` : `선택한 ${resolved.length}개 항목을 삭제할까요? (폴더 안의 내용도 모두 삭제됩니다)`);
  const ok = await showConfirmDialog(msg);
  if (!ok) return;
  for (const node of resolved) await (inBin || permanent ? dfsPermanentlyDelete(node) : dfsDelete(node));
  multiSelected.clear();
  selected = null;
  await dfsBroadcastChange();
}
/* 휴지통 다중 복원(요청 #113) - 각 항목을 원래 있던 자리로(그 폴더가 사라졌으면 바탕화면 최상위로)
   되돌린다. dfsRestoreFromRecycleBin이 항목마다 알아서 토스트를 띄운다. */
async function handleMultiRestore(items) {
  const resolved = [];
  for (const it of items) {
    if (it.type === "folder") {
      const folderId = await dfsDesktopResolveFolderId(it);
      const node = folderId != null ? await dfsDb.nodes.get(folderId) : null;
      if (node) resolved.push(node);
    } else if (it.dfsNode) {
      resolved.push(it.dfsNode);
    }
  }
  if (!resolved.length) return;
  for (const node of resolved) await dfsRestoreFromRecycleBin(node);
  multiSelected.clear();
  selected = null;
  await dfsBroadcastChange();
}

