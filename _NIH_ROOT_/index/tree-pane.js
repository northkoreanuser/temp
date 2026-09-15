/* ============ 탐색창(왼쪽) — 폴더만 표시, 펼칠 때마다 그 폴더의 pages.json을 읽음 ============
   - 폴더로 들어가는 것(클릭/더블클릭)과 트리를 펼치는 것(화살표)은 서로 다른 동작이다 - 폴더에
     들어간다고 트리가 자동으로 펴지지 않는다(실제 윈도우 탐색기와 동일). 화살표를 눌러야 펴진다.
   - 트리 영역을 클릭하면 방향키 포커스가 왼쪽 창으로 넘어와서 상하좌우로 조작할 수 있다.
================================================================== */
els.navPane.tabIndex = 0;
function renderNavPane() {
  els.navPane.innerHTML = "";
  const rootRow = document.createElement("div");
  rootRow.className = "nav-root" + (!treeFileHighlightKey && currentPath.length === 0 ? " selected" : "") + (treeFocusKey === "" ? " kbd-focus" : "");
  rootRow.innerHTML = `${resolveRepoRootIcon(16)}<span>${escapeHtml(repoName || "루트")}</span>`;
  rootRow.onclick = () => { els.navPane.focus(); navigate([]); closeNavPaneIfNarrow(); };
  rootRow.ondblclick = () => navigate([]);
  els.navPane.appendChild(rootRow);
  // 저장소 루트는 실제 GitHub 저장소라 읽기 전용이므로(옮겨 넣을 수 없음) 드롭 대상으로 삼지 않는다 -
  // 바탕화면 루트(dtRow, 바로 아래)와 가상 폴더 행들만 attachTreeDropTarget으로 드롭을 받는다.

  const rootEntry = dirCache.get("");
  if (rootEntry) els.navPane.appendChild(buildTreeDom(rootEntry, []));

  // 바탕화면(가상 파일시스템) - 루트 색인에는 나타나지 않지만, 트리에는 저장소 루트와 나란히
  // 별도의 최상위 항목으로 추가된다(기존 탐색기와 바탕화면 탐색기를 하나로 통합 - 사용자 지시).
  // 요청 #139(ps2) - 트리 순서는 레포, 바탕 화면, 휴지통 순이어야 한다(예전엔 레포, 휴지통,
  // 바탕화면 순으로 잘못돼 있었음) - 그래서 이 블록이 휴지통보다 먼저 온다.
  if (dfsDb) {
    const dtKey = DESKTOP_TREE_NAME;
    const dtRow = document.createElement("div");
    dtRow.className = "nav-root" + (!treeFileHighlightKey && currentPath.join("/") === dtKey ? " selected" : "") + (treeFocusKey === dtKey ? " kbd-focus" : "");
    dtRow.innerHTML = `${resolveDesktopIcon(16, true)}<span>${escapeHtml(DESKTOP_TREE_NAME)}</span>`;
    dtRow.onclick = () => { els.navPane.focus(); navigate([DESKTOP_TREE_NAME]); closeNavPaneIfNarrow(); };
    dtRow.ondblclick = () => navigate([DESKTOP_TREE_NAME]);
    attachTreeDropTarget(dtRow, [DESKTOP_TREE_NAME]);
    els.navPane.appendChild(dtRow);
    const dtEntry = dirCache.get(dtKey);
    if (dtEntry) els.navPane.appendChild(buildTreeDom(dtEntry, [DESKTOP_TREE_NAME]));
  }

  // 휴지통 - 저장소 루트와 나란한 별도의 최상위 항목(사용자 지시: "바탕 화면에 휴지통 추가
  // 트리에도 추가 아이콘은 동일 사용"). 요청 #113 - 별도의 오버레이 패널이 아니라 저장소
  // 루트/바탕화면과 똑같이 통합 탐색기 창(navigate)으로 들어간다(진짜 탐색기 휴지통처럼).
  if (dfsDb) {
    const rbKey = RECYCLEBIN_TREE_NAME;
    const rbRow = document.createElement("div");
    rbRow.className = "nav-root" + (!treeFileHighlightKey && currentPath.join("/") === rbKey ? " selected" : "") + (treeFocusKey === rbKey ? " kbd-focus" : "");
    // 요청 #167: renderNavPane()은 동기 함수라 여기서 dexie를 다시 조회하지 못하므로,
    // dfsRenderDesktop()이 가장 최근에 계산해둔 dfsRecycleBinHasItems 캐시를 그대로 쓴다.
    rbRow.innerHTML = `${resolveRecycleBinIcon(16, !dfsRecycleBinHasItems)}<span>${escapeHtml(RECYCLEBIN_TREE_NAME)}</span>`;
    rbRow.onclick = () => { els.navPane.focus(); navigate([RECYCLEBIN_TREE_NAME]); closeNavPaneIfNarrow(); };
    rbRow.ondblclick = () => navigate([RECYCLEBIN_TREE_NAME]);
    rbRow.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        { label: "열기", action: () => navigate([RECYCLEBIN_TREE_NAME]) },
        { label: "휴지통 비우기", action: async () => { await dfsEmptyRecycleBin(); await dfsBroadcastChange(); } },
        { label: "속성", action: () => dfsShowRecycleBinProperties() }
      ]);
    };
    attachRecycleBinTreeDropTarget(rbRow);
    els.navPane.appendChild(rbRow);
    const rbEntry = dirCache.get(rbKey);
    if (rbEntry) els.navPane.appendChild(buildTreeDom(rbEntry, [RECYCLEBIN_TREE_NAME]));
  }
}
/* 트리에서 "파일" 행을 클릭해 선택(파란 포커스)한다 - 폴더처럼 내용창으로 진입하진 않는다. */
function selectTreeFile(it) {
  treeFileHighlightKey = it.path.join("/");
  treeFocusKey = null; // 선택이 새로 확정됐으니, 다음 방향키는 이 새 위치부터 다시 포커스를 잡는다
  renderNavPane();
}
/* ============ 트리(왼쪽)에서의 드래그앤드롭 ============
   버그 리포트: "폴더에서 이전 트리로 드래그 해도 뺄 수 있어야 함, 바탕 화면에서 폴더 탐색기
   안쪽으로 드래그 해서 넣을 수도 있어야 함(폴더 창에서 트리로 혹은 바탕 화면으로)" - 내용창
   (content-pane.js)/바탕화면 아이콘층(desktop-fs.js)과 마찬가지로 트리도 드래그의 출발점이자
   도착점이 될 수 있어야 한다. 실제 저장소 폴더/파일은 읽기 전용이라 옮길 수 없으므로, 드래그
   출발(draggable)과 드롭 수신 둘 다 "바탕화면(가상 파일시스템) 경로"인 행에만 붙인다
   (isDesktopPath - pathArr[0]이 DESKTOP_TREE_NAME인 경우). */
// 드롭 수신: 내용창의 폴더 칸(content-pane.js buildGrid)과 완전히 같은 방식 - text/plain(드래그된
// 노드의 dexie id) 또는 Files(진짜 OS 파일)를 받아 dfsResolvePathToFolderId(pathArr)로 알아낸
// 이 트리 행의 실제 폴더로 옮긴다. 바탕화면 아이콘의 마우스 기반 드래그(dfsSetupIconDrag)는 네이티브
// HTML5 드래그가 아니라서 이 리스너로는 못 받는다 - 그쪽은 desktop-fs.js의 dfsElementUnder가
// .tree-row/.nav-root도 찾도록 확장하고, dataset.dropFolderKey를 직접 읽어 처리한다(아래 참고).
function attachTreeDropTarget(row, pathArr) {
  if (!isDesktopPath(pathArr)) return;
  row.dataset.dropFolderKey = pathArr.join("/");
  row.addEventListener("dragover", (e) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types || []);
    if (types.indexOf("Files") === -1 && types.indexOf("text/plain") === -1 && types.indexOf("DownloadURL") === -1) return;
    e.preventDefault();
    row.classList.add("df-drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("df-drop-target"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("df-drop-target");
    const targetFolderId = await dfsResolvePathToFolderId(pathArr);
    if (targetFolderId == null) return;
    // 저장소 화면에서 끌어온 텍스트 파일을 트리의 바탕화면(하위 폴더 포함) 행 위에 놓은 경우.
    if (dfDragHasRepoFile(e)) {
      await dfHandleRepoFileDrop(e, targetFolderId, () => { renderNavPane(); if (isDesktopPath(currentPath)) renderContentPane(); });
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      await dfsImportOsFileList(targetFolderId, e.dataTransfer.files, () => { renderNavPane(); if (isDesktopPath(currentPath)) renderContentPane(); });
      return;
    }
    const draggedId = Number(e.dataTransfer.getData("text/plain"));
    if (!draggedId || draggedId === targetFolderId) return;
    const srcNode = await dfsDb.nodes.get(draggedId);
    if (!srcNode) return;
    const ok = await dfsMove(srcNode, targetFolderId);
    if (ok) showToast(`"${srcNode.name}"을(를) "${pathArr[pathArr.length - 1]}" 폴더로 옮겼습니다.`, { sound: "move_or_copy" });
    await dfsBroadcastChange();
  });
}
// 휴지통 트리 행(최상위 "휴지통" 자체)에 드롭 - 다른 드롭 대상과 달리 "그 폴더 안으로 옮기기"가
// 아니라 삭제(휴지통 이동)다. 바탕화면 아이콘층의 dfsIsRecycleBinIcon 드롭 처리와 동일한 동작.
function attachRecycleBinTreeDropTarget(row) {
  // desktop-fs.js의 dfsIsRecycleBinIcon이 마우스 기반 드래그(dfsSetupIconDrag)에서도 이 행을
  // "삭제 대상"으로 인식할 수 있도록 표식을 남긴다(그 드래그는 네이티브 HTML5 드래그가 아니라서
  // 이 dragover/drop 리스너로는 못 받고, dfsElementUnder + 이 dataset을 직접 읽는다).
  row.dataset.recycleBinRoot = "1";
  row.addEventListener("dragover", (e) => {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types || []);
    if (types.indexOf("text/plain") === -1) return;
    e.preventDefault();
    row.classList.add("df-drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("df-drop-target"));
  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    row.classList.remove("df-drop-target");
    const draggedId = Number(e.dataTransfer.getData("text/plain"));
    if (!draggedId) return;
    const srcNode = await dfsDb.nodes.get(draggedId);
    if (!srcNode || srcNode.parentId === DFS_RECYCLEBIN_ROOT) return;
    await dfsDelete(srcNode);
    showToast(`"${srcNode.name}"을(를) 휴지통으로 옮겼습니다.`, { sound: "delete_to_recyclebin" });
    await dfsBroadcastChange();
  });
}
// 드래그 출발: 이 트리 행 자체가 가상 파일시스템 항목(폴더/파일)일 때, 다른 트리 폴더/내용창 칸/
// 바탕화면으로 끌어다 놓을 수 있게 한다. dfsId는 buildTreeDom이 entry.folderNodes(폴더)나
// f.dfsNode(파일)에서 미리 찾아 넘겨준다.
function attachTreeDragSource(row, dfsId) {
  if (dfsId == null) return;
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", String(dfsId));
    e.dataTransfer.effectAllowed = "move";
  });
}
function buildTreeDom(entry, pathArr) {
  const wrap = document.createElement("div");
  const folderNames = (entry && entry.folders) || [];
  const files = (entry && entry.files) || [];
  folderNames.forEach(name => {
    const childPath = [...pathArr, name];
    const key = childPath.join("/");
    const isOpen = expanded.has(key);
    const cached = dirCache.get(key);

    const row = document.createElement("div");
    row.className = "tree-row" + (!treeFileHighlightKey && currentPath.join("/") === key ? " selected" : "") + (treeFocusKey === key ? " kbd-focus" : "");
    row.style.paddingLeft = (6 + pathArr.length * 16) + "px";

    const arrow = document.createElement("span");
    arrow.className = "tree-arrow";
    arrow.textContent = isOpen ? "▾" : "▸";
    arrow.onclick = async (e) => {
      e.stopPropagation();
      els.navPane.focus();
      if (isOpen) {
        expanded.delete(key);
        persistExpanded();
        renderNavPane();
        return;
      }
      expanded.add(key);
      persistExpanded();
      renderNavPane();
      try { await loadDir(childPath); } catch (err) { /* 접힌 상태로 둔다 */ }
      renderNavPane();
    };
    row.appendChild(arrow);
    row.insertAdjacentHTML("beforeend", resolveFolderIcon(childPath, 15, false));
    const label = document.createElement("span");
    label.textContent = name;
    row.appendChild(label);
    row.onclick = () => { els.navPane.focus(); navigate(childPath); closeNavPaneIfNarrow(); };
    row.ondblclick = () => navigate(childPath);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 실제 저장소 폴더는 읽기 전용이라 buildFileMenuItems가 빈 메뉴([])를 돌려준다 - 바탕화면
      // 폴더일 때만 새로 만들기/이름 변경/삭제 등 메뉴가 뜬다(트리에서도 우클릭 삭제 가능하게).
      showContextMenu(e.clientX, e.clientY, buildFileMenuItems({ name, path: childPath, type: "folder" }));
    };
    attachTreeDropTarget(row, childPath);
    attachTreeDragSource(row, entry && entry.folderNodes ? entry.folderNodes.get(name)?.id : undefined);
    wrap.appendChild(row);

    if (isOpen) {
      if (cached) {
        wrap.appendChild(buildTreeDom(cached, childPath));
      } else {
        const loading = document.createElement("div");
        loading.className = "tree-row tree-loading";
        loading.style.paddingLeft = (6 + (pathArr.length + 1) * 16) + "px";
        loading.textContent = "불러오는 중...";
        wrap.appendChild(loading);
      }
    }
  });

  // 파일도 트리에 표시한다(실제 윈도우 탐색기처럼 폴더를 펼치면 그 안의 파일도 보인다).
  // 파일은 하위로 펼쳐지지 않으므로 화살표 자리는 정렬만 맞추고 비워둔다.
  files.forEach(f => {
    const childPath = [...pathArr, f.name];
    const key = childPath.join("/");
    const it = { name: f.name, size: f.size, path: childPath, type: fileTypeFor(f.name), dfsNode: f.dfsNode };

    const row = document.createElement("div");
    row.className = "tree-row tree-file-row" + (treeFileHighlightKey === key ? " selected" : "") + (treeFocusKey === key ? " kbd-focus" : "");
    row.dataset.fileKey = key;
    row.style.paddingLeft = (6 + pathArr.length * 16) + "px";

    const spacer = document.createElement("span");
    spacer.className = "tree-arrow empty";
    row.appendChild(spacer);
    row.insertAdjacentHTML("beforeend", it.dfsNode ? dfsIconGlyphFor(it.dfsNode, 15) : resolveFileIcon(f.name, 15, childPath));
    const label = document.createElement("span");
    label.textContent = displayName(f.name); // 요청 #141: .sc는 트리에서도 확장자를 숨긴다
    row.appendChild(label);
    row.onclick = () => { els.navPane.focus(); selectTreeFile(it); };
    row.ondblclick = () => activate(it);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectTreeFile(it);
      showContextMenu(e.clientX, e.clientY, buildFileMenuItems(it));
    };
    attachTreeDragSource(row, it.dfsNode ? it.dfsNode.id : undefined);
    wrap.appendChild(row);
  });

  return wrap;
}
/* 현재 화면에 보이는(펼쳐진 상태 기준) 트리 행들을 위에서 아래 순서로 나열한다(루트는 pathArr:[]).
   폴더뿐 아니라 파일도 포함한다(방향키로 폴더만 되고 파일은 마우스로만 선택되던 것을 통일) -
   buildTreeDom과 완전히 같은 순서(각 폴더 다음 그 하위, 그 다음 그 폴더 레벨의 파일들)로 만든다. */
function flattenVisibleTree() {
  const list = [{ key: "", type: "folder", pathArr: [] }];
  function walk(entry, pathArr) {
    const folderNames = (entry && entry.folders) || [];
    const files = (entry && entry.files) || [];
    folderNames.forEach(name => {
      const childPath = [...pathArr, name];
      const key = childPath.join("/");
      list.push({ key, type: "folder", pathArr: childPath });
      if (expanded.has(key)) {
        const cached = dirCache.get(key);
        if (cached) walk(cached, childPath);
      }
    });
    files.forEach(f => {
      const childPath = [...pathArr, f.name];
      const key = childPath.join("/");
      const it = { name: f.name, size: f.size, path: childPath, type: fileTypeFor(f.name), dfsNode: f.dfsNode };
      list.push({ key, type: "file", pathArr: childPath, item: it });
    });
  }
  const rootEntry = dirCache.get("");
  if (rootEntry) walk(rootEntry, []);

  // 바탕화면도 저장소 루트와 나란한 별도의 최상위 항목이므로, 방향키 탐색 목록에도 이어서 추가한다.
  // 저장소 루트와 똑같이, 바탕화면 루트 "자신"의 바로 아래 자식들은 화살표로 펼치지 않아도 항상
  // 보이므로(renderNavPane 참고 - buildTreeDom(dtEntry, ...)를 조건 없이 붙임) 여기서도
  // expanded 여부와 무관하게 walk한다 - 안 그러면 F2/방향키 등이 실제 화면과 어긋난다.
  if (dfsDb) {
    const dtKey = DESKTOP_TREE_NAME;
    list.push({ key: dtKey, type: "folder", pathArr: [DESKTOP_TREE_NAME] });
    const dtEntry = dirCache.get(dtKey);
    if (dtEntry) walk(dtEntry, [DESKTOP_TREE_NAME]);

    // 휴지통도 저장소 루트/바탕화면과 나란한 별도의 최상위 항목이므로 방향키 탐색 목록에 이어 추가.
    const rbKey = RECYCLEBIN_TREE_NAME;
    list.push({ key: rbKey, type: "folder", pathArr: [RECYCLEBIN_TREE_NAME] });
    const rbEntry = dirCache.get(rbKey);
    if (rbEntry) walk(rbEntry, [RECYCLEBIN_TREE_NAME]);
  }
  return list;
}
/* 트리에서 "지금 선택된 것"의 키 - 파일이 강조돼 있으면 그 파일, 아니면 현재 폴더(currentPath).
   선택 박스는 항상 하나뿐이므로 이 값 하나로 트리 전체의 파란 강조 위치가 정해진다. */
function getTreeSelectionKey() {
  return treeFileHighlightKey !== null ? treeFileHighlightKey : currentPath.join("/");
}
/* flattenVisibleTree()가 만든 항목 하나를 "선택"한다 - 폴더면 그 폴더로 이동(내용창도 갱신),
   파일이면 내용창은 그대로 두고 트리에서만 파란 포커스를 옮긴다. */
function selectTreeEntry(entry) {
  if (entry.type === "file") selectTreeFile(entry.item);
  else navigate(entry.pathArr);
}
/* 왼쪽 트리 방향키 내비게이션 - 실제 윈도우 탐색기와 동일하게, 방향키는 "포커스"(점선 테두리)만
   옮길 뿐 그 자체로 선택/이동을 확정하지 않는다. 포커스가 있는 항목을 실제로 선택(파란 박스로
   확정 - 폴더면 그 폴더로 이동, 파일이면 트리에서 강조)하려면 엔터를 눌러야 한다.
   상하=포커스 이동(폴더·파일 구분 없이 보이는 순서대로), 좌=펼쳐져 있으면 접기·아니면 그 상위
   항목으로 포커스 이동(파일이면 그 파일이 든 폴더로), 우=접혀있으면 펼치기(포커스는 그대로)·이미
   펼쳐져 있으면 바로 아래(첫 하위 항목)로 포커스 이동(파일이면 펼칠 게 없으므로 무시). */
els.navPane.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const list = flattenVisibleTree();
    const key = (treeFocusKey !== null && list.some(en => en.key === treeFocusKey)) ? treeFocusKey : getTreeSelectionKey();
    const entry = list.find(en => en.key === key);
    if (entry) {
      e.preventDefault();
      selectTreeEntry(entry); // 폴더면 navigate(), 파일이면 selectTreeFile() - 둘 다 내부에서 treeFocusKey를 비운다
    }
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  const list = flattenVisibleTree();
  // 포커스가 아직 없거나(방향키를 처음 누름) 이전 포커스가 지금은 화면에 없으면(트리가 접힘 등),
  // 지금 "선택"돼 있는 위치부터 포커스를 새로 시작한다.
  if (treeFocusKey === null || !list.some(en => en.key === treeFocusKey)) treeFocusKey = getTreeSelectionKey();
  let idx = list.findIndex(en => en.key === treeFocusKey);
  if (idx === -1) idx = 0;
  const cur = list[idx];

  if (e.key === "ArrowUp") {
    if (idx > 0) { treeFocusKey = list[idx - 1].key; renderNavPane(); }
    return;
  }
  if (e.key === "ArrowDown") {
    if (idx < list.length - 1) { treeFocusKey = list[idx + 1].key; renderNavPane(); }
    return;
  }
  if (e.key === "ArrowLeft") {
    if (cur.type === "file") {
      // 파일은 펼칠 하위 항목이 없으니 왼쪽 화살표는 포커스를 그 파일이 들어있는 폴더로 옮긴다
      treeFocusKey = cur.pathArr.slice(0, -1).join("/");
      renderNavPane();
      return;
    }
    const curEntryData = cur.key ? dirCache.get(cur.key) : null;
    const curHasSubfolders = !!(curEntryData && curEntryData.folders && curEntryData.folders.length > 0);
    if (cur.key && expanded.has(cur.key) && curHasSubfolders) {
      expanded.delete(cur.key);
      persistExpanded();
      renderNavPane();
    } else if (cur.pathArr.length > 0) {
      treeFocusKey = cur.pathArr.slice(0, -1).join("/");
      renderNavPane();
    }
    return;
  }
  if (e.key === "ArrowRight") {
    if (cur.type === "file") return; // 파일은 펼칠 하위 항목이 없음
    if (cur.pathArr.length === 0 || cur.key === DESKTOP_TREE_NAME || cur.key === RECYCLEBIN_TREE_NAME) {
      // 저장소 루트/바탕화면 루트/휴지통 루트는 모두 화살표 없이 항상 펼쳐진 상태로 취급한다(하위
      // 항목이 이미 보임) - 바로 다음 항목으로 포커스만 이동
      const idxNow = list.findIndex(en => en.key === cur.key);
      if (idxNow !== -1 && idxNow < list.length - 1) { treeFocusKey = list[idxNow + 1].key; renderNavPane(); }
      return;
    }
    if (!expanded.has(cur.key)) {
      expanded.add(cur.key);
      persistExpanded();
      renderNavPane();
      try { await loadDir(cur.pathArr); } catch (err) { /* 무시 */ }
      renderNavPane();
    } else {
      const newList = flattenVisibleTree();
      const newIdx = newList.findIndex(en => en.key === cur.key);
      if (newIdx !== -1 && newIdx < newList.length - 1) { treeFocusKey = newList[newIdx + 1].key; renderNavPane(); }
    }
    return;
  }
});

