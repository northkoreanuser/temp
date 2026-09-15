/* ============================================================================
   바탕화면 가상 파일시스템(desktop virtual filesystem) - dexie(IndexedDB)에 저장
   ============================================================================
   - .desktop 배경에 아이콘으로 폴더/파일이 놓인다. 더블클릭하면 폴더는 새 탐색기 창으로,
     파일은 그 창 안에서 화면 전환으로(옵시디언 스타일) 내장 에디터가 뜬다.
   - "진짜" 탐색기(GitHub 리포 브라우저, #win)는 하나만 존재하지만, 이 가상 폴더들은
     설정에서 정한 개수까지 동시에 여러 창으로 열 수 있다(실제 윈도우 탐색기와 동일 - #win 자체는
     중복 실행 불가능하고 이 가상 폴더 창들만 여러 개 가능).
   - 업로드받은 옵시디언 스타일 마크다운/HTML 에디터의 핵심 기능(마크다운 렌더링, HTML 샌드박스
     미리보기, 코드블록 복사, 굵게/기울임/링크 단축키, 단어수 상태줄, M/H/T 모드, 테마)을 그대로
     가져와 쓰되, 주소창(#) 압축저장/공유 기능만은 뺐다 - 이 페이지가 이미 #을 경로/트리 상태
     저장용으로 쓰고 있어서 중복 구현이 불가능하기 때문(사용자 요청사항).
================================================================================= */

const DFS_DESKTOP_ROOT = "desktop";
// 휴지통(완전한 기능 - 사용자 지시): 바탕화면 항목을 "삭제"하면 진짜로 지우지 않고 parentId를
// 이 특수 값으로 바꿔서 옮겨둔다(원래 있던 위치는 originalParentId에 기억) - 그래서 복원할 수
// 있고, 이동/붙여넣기 덮어쓰기 확인(dfsMove/dfsCopyInto)에서 지워지는 것도 여기로 가므로 덮어써서
// 자료가 통째로 사라지는 문제(버그 리포트 #2)도 같이 완화된다. "휴지통 비우기"를 실행할 때만
// dfsDeleteDeep으로 영구 삭제한다.
const DFS_RECYCLEBIN_ROOT = "recyclebin";
let dfsDb = null;

function dfsInitDb() {
  // dexie.min.js는 외부 CDN에서 불러오므로, 네트워크 차단/오프라인 등으로 못 불러왔을 수도 있다.
  // 그런 경우에도 "진짜" 저장소 탐색기(메인 기능)는 전혀 영향받지 않고 정상 동작해야 하므로,
  // 바탕화면 가상 파일시스템 기능만 조용히 비활성화한다(dfsDb=null → 각 함수가 방어적으로 처리).
  if (typeof Dexie === "undefined") {
    console.warn("Dexie를 불러오지 못해 바탕화면 가상 파일시스템 기능을 사용할 수 없습니다.");
    dfsDb = null;
    return;
  }
  try {
    const { repo } = getOwnerRepo();
    const label = repo || "default";
    dfsDb = new Dexie(`idx-desktopfs-${label}`);
    dfsDb.version(1).stores({ nodes: "++id, parentId, name" });
  } catch (e) {
    console.warn("바탕화면 가상 파일시스템 초기화 실패:", e);
    dfsDb = null;
  }
}

/* ---------------- 이름 규칙: 윈도우 금지 문자/예약어 + 충돌 시 번호 붙이기 ---------------- */
const DFS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);
function dfsValidateName(raw) {
  const name = (raw || "").trim();
  if (!name) return "이름을 입력하세요.";
  if (/[\\/:*?"<>|]/.test(name)) return '\\ / : * ? " < > | 문자는 이름에 쓸 수 없습니다.';
  if (/[ .]$/.test(name)) return "이름 끝에 공백이나 마침표를 쓸 수 없습니다.";
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  if (DFS_RESERVED_NAMES.has(name.toUpperCase()) || DFS_RESERVED_NAMES.has(base.toUpperCase())) {
    return `"${name}"은(는) 시스템에서 예약된 이름이라 쓸 수 없습니다.`;
  }
  return null;
}
function dfsSplitExt(name) {
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0 && dot < name.length - 1;
  return hasExt ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: "" };
}
// "새 폴더 (2)"처럼 이미 "(숫자)" 접미사가 붙어있는 이름이면 그 접미사를 떼어낸 진짜 기본 이름을
// 돌려준다("새 폴더"). 그래야 그 이름이 또 충돌났을 때 "새 폴더 (2) (2)"처럼 접미사가 중첩되지
// 않고 "새 폴더 (3)"처럼 이어서 번호가 붙는다(버그 리포트: 복사/붙여넣기로 "새 폴더 (2)"가 이미
// 있는 상태에서 같은 이름이 또 필요해지면 "(2) (2)"가 되던 문제 - 정규식으로 접미사부터 벗겨낸다).
function dfsStripCounterSuffix(base) {
  const m = /^(.*) \((\d+)\)$/.exec(base);
  return m ? m[1] : base;
}
async function dfsUniqueName(parentId, desiredName) {
  const siblings = await dfsDb.nodes.where("parentId").equals(parentId).toArray();
  const taken = new Set(siblings.map(s => s.name.toLowerCase()));
  if (!taken.has(desiredName.toLowerCase())) return desiredName;
  const { base, ext } = dfsSplitExt(desiredName);
  const trueBase = dfsStripCounterSuffix(base);
  let n = 2;
  while (true) {
    const candidate = `${trueBase} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    n++;
  }
}
function dfsSuffixedName(name, suffix) {
  const { base, ext } = dfsSplitExt(name);
  return `${base} - ${suffix}${ext}`;
}
// 이동/붙여넣기처럼 "원래 이름 그대로 넣으려는" 경우에 이름이 이미 충돌하는 대상이 있는지
// 찾아준다(자기 자신은 제외). dfsUniqueName처럼 조용히 새 번호를 붙이는 대신, 이 결과가 있으면
// 호출한 쪽에서 "덮어쓸까요?" 확인창을 띄운다(버그 리포트: 폴더를 드래그해서 넣었는데 이미 같은
// 이름이 있어도 덮어쓰기 확인 없이 그냥 조용히 처리되던 문제).
async function dfsFindNameConflict(parentId, name, excludeId) {
  const siblings = await dfsDb.nodes.where("parentId").equals(parentId).toArray();
  return siblings.find(s => s.id !== excludeId && s.name.toLowerCase() === name.toLowerCase()) || null;
}

// 요청 #145: "드래그&드롭 바탕화면 업로드가 텍스트 파일만 지원 - 다른 파일도 지원해줘" - 파일
// 노드가 이제 텍스트(content, 기존 방식)와 이진(binary:true + blob, 신규) 두 가지일 수 있어서,
// 크기 계산도 두 갈래를 다 처리하는 이 함수 하나로 통일한다(속성/폴더 집계/목록 크기열 전부 재사용).
function dfsFileByteSize(node) {
  if (node && node.binary && node.blob) return node.blob.size;
  return new Blob([(node && node.content) || ""]).size;
}

/* ---------------- CRUD ---------------- */
async function dfsChildren(parentId) {
  const rows = await dfsDb.nodes.where("parentId").equals(parentId).toArray();
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : (b.type === "folder" ? 1 : 0);
    return a.name.localeCompare(b.name, "ko");
  });
  return rows;
}
// 요청 #111 - 사용자 지시: "좌에서 우측이 아니라 좌에서 아래로 배치되야 한다 점점 오른쪽으로
// (실제 윈도우처럼)". 실제 윈도우 바탕화면은 한 열을 위에서 아래로 다 채운 뒤에야 다음 열
// (오른쪽)로 넘어간다 - 예전엔 반대로(왼쪽→오른쪽을 다 채우고 다음 줄로 내려감, 즉 행 우선)
// 배치했었다. 한 열에 들어가는 최대 개수(=몇 개면 다음 열로 넘어가는지)는 화면 높이에 따라
// 달라지므로, 고정 6개가 아니라 실제 바탕화면 아이콘 레이어의 clientHeight를 기준으로 매번
// 다시 계산한다(창을 늘리거나 줄여도 다음에 새로 만드는 아이콘부터는 새 높이를 반영한다).
function dfsMaxGridRows() {
  const h = (els.dfIconLayer && els.dfIconLayer.clientHeight) || 600;
  return Math.max(1, Math.floor((h - 24) / 100));
}
async function dfsNextIconPos(parentId) {
  // 이미 있는 아이콘 개수를 보고 격자 형태로 다음 좌표를 대충 잡아준다(겹쳐서 쌓이는 것 방지).
  // 바탕화면 최상위(DFS_DESKTOP_ROOT)는 저장소 루트/휴지통 특수 아이콘 2개가 항상 맨 앞(첫 번째
  // 열의 위쪽 두 자리)에 고정으로 그려지므로(dfsRenderDesktop 참고), 실제 사용자 아이콘은 그만큼
  // 밀어서 배치한다.
  const siblings = await dfsDb.nodes.where("parentId").equals(parentId).toArray();
  const idx = siblings.length + (parentId === DFS_DESKTOP_ROOT ? 2 : 0);
  const maxRows = dfsMaxGridRows();
  const col = Math.floor(idx / maxRows), row = idx % maxRows;
  return { x: 24 + col * 96, y: 24 + row * 100 };
}

/* ---------------- 바탕화면 배치 모드: 자유모드(기본) / 격자모드 (요청 #110) ----------------
   실제 윈도우 바탕화면의 "아이콘을 격자에 맞춤"과 비슷하게, 두 가지 모드를 오갈 수 있다.
     - 자유모드(기본, 지금까지의 동작): 원하는 어떤 픽셀 위치로든 자유롭게 끌어다 놓을 수 있다.
     - 격자모드: 아이콘을 놓을 때마다 가장 가까운 격자 칸(dfsNextIconPos와 같은 칸 크기 96x100,
       원점 24,24)으로 스냅되고, 그 칸에 이미 다른 아이콘이 있으면 서로 자리를 맞바꾼다(겹치지
       않게) - 격자모드로 막 전환한 순간에는 지금까지 자유롭게 놓여있던 모든 아이콘을 한 번에
       가장 가까운 빈 칸으로 정렬한다.
   모드는 저장소별로 다른 UI 상태(트리 펼침, 특수 아이콘 위치 등)와 같은 방식으로 localStorage에
   기억한다. */
const DFS_GRID_CELL_W = 96, DFS_GRID_CELL_H = 100, DFS_GRID_ORIGIN_X = 24, DFS_GRID_ORIGIN_Y = 24;
function dfsArrangeModeKey() { return `idx:${repoName}:desktopArrangeMode`; }
function dfsLoadArrangeMode() {
  try {
    const v = localStorage.getItem(dfsArrangeModeKey());
    if (v === "grid" || v === "free") return v;
  } catch (e) { /* 무시 - 실패해도 기본값(격자모드)으로 동작하면 됨 */ }
  // 요청 #139(ps): 아이콘 배치 기본값은 자유모드가 아니라 격자모드다(실제 윈도우 바탕화면의
  // 기본 "아이콘을 격자에 맞춤" 설정과 동일).
  return "grid";
}
function dfsSaveArrangeMode(mode) {
  try { localStorage.setItem(dfsArrangeModeKey(), mode); } catch (e) { /* 용량 초과 등은 무시 */ }
}
let dfsArrangeMode = dfsLoadArrangeMode();
// 픽셀 좌표를 가장 가까운 격자 칸(열,행)으로 변환한다 - 화면 밖(왼쪽/작업표시줄 아래)으로 나가지
// 않도록 열은 0 이상, 행은 0~(그 순간의 최대 행 수-1) 사이로 자른다.
function dfsPixelToCell(x, y) {
  const col = Math.max(0, Math.round((x - DFS_GRID_ORIGIN_X) / DFS_GRID_CELL_W));
  const maxRows = dfsMaxGridRows();
  const row = Math.max(0, Math.min(maxRows - 1, Math.round((y - DFS_GRID_ORIGIN_Y) / DFS_GRID_CELL_H)));
  return { col, row };
}
function dfsCellToPixel(col, row) {
  return { x: DFS_GRID_ORIGIN_X + col * DFS_GRID_CELL_W, y: DFS_GRID_ORIGIN_Y + row * DFS_GRID_CELL_H };
}
// 목표 칸이 이미 차 있으면(occupied 집합에 있으면) 그 칸을 중심으로 점점 넓혀가며(열은 오른쪽으로
// 무한히 늘어날 수 있으므로 열 방향은 제한 없음, 행은 maxRows로 제한) 가장 가까운 빈 칸을 찾는다.
function dfsNearestFreeCell(occupied, col, row, maxRows) {
  const key = (c, r) => `${c},${r}`;
  if (col >= 0 && !occupied.has(key(col, row))) return { col, row };
  for (let radius = 1; radius < 2000; radius++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const c = col + dc;
      if (c < 0) continue;
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue; // 이 반경의 "테두리"만(안쪽은 이전 반경에서 이미 검사함)
        const r = row + dr;
        if (r < 0 || r >= maxRows) continue;
        if (!occupied.has(key(c, r))) return { col: c, row: r };
      }
    }
  }
  return { col: col + 2000, row: 0 }; // 사실상 도달하지 않는 극단적 예비값
}
// 지금 바탕화면에 있는 모든 아이콘(진짜 dexie 노드 + 저장소 루트/휴지통 특수 아이콘 2개)의 현재
// 픽셀 위치를 한 목록으로 모은다 - 격자 스냅/충돌 판정에서 두 종류를 똑같이 다루기 위함.
async function dfsAllDesktopIconPositions() {
  const nodes = await dfsChildren(DFS_DESKTOP_ROOT);
  const specialPos = dfsLoadSpecialIconPos();
  const list = nodes.map(n => ({ id: n.id, isSpecial: false, x: n.x ?? 24, y: n.y ?? 24 }));
  const repoRootPos = specialPos[DFS_REPOROOT_ICON_ID] || { x: 24, y: 24 };
  const recycleBinPos = specialPos[DFS_RECYCLEBIN_ICON_ID] || { x: 24, y: 124 };
  list.push({ id: DFS_REPOROOT_ICON_ID, isSpecial: true, x: repoRootPos.x, y: repoRootPos.y });
  list.push({ id: DFS_RECYCLEBIN_ICON_ID, isSpecial: true, x: recycleBinPos.x, y: recycleBinPos.y });
  return list;
}
function dfsSaveIconPosition(id, isSpecial, x, y) {
  if (isSpecial) return dfsSaveSpecialIconPos(id, x, y);
  return dfsDb.nodes.update(id, { x, y });
}
// 아이콘을 하나 드래그해서 놓았을 때(격자모드) 호출한다 - 놓은 자리에서 가장 가까운 격자 칸으로
// 스냅하고, 그 칸에 이미 다른 아이콘이 있으면 서로의 자리를 맞바꾼다(밀어내거나 겹치지 않게).
// 옮긴 아이콘(과 자리를 바꿨다면 상대방도) 즉시 dexie/localStorage에 반영한 뒤, 옮긴 아이콘의
// 최종 픽셀 좌표를 돌려준다.
async function dfsGridSnapDrop(draggedId, draggedIsSpecial, droppedX, droppedY, origX, origY) {
  const target = dfsPixelToCell(droppedX, droppedY);
  const all = await dfsAllDesktopIconPositions();
  const isDragged = (it) => it.isSpecial === draggedIsSpecial && it.id === draggedId;
  const occupant = all.find(it => !isDragged(it) && dfsPixelToCell(it.x, it.y).col === target.col && dfsPixelToCell(it.x, it.y).row === target.row);
  const finalPos = dfsCellToPixel(target.col, target.row);
  if (occupant) {
    // 원래 있던 자리(드래그 시작 전 위치)를 격자 칸으로 스냅한 곳으로 상대방을 보낸다.
    const origCell = dfsPixelToCell(origX, origY);
    const swapPos = dfsCellToPixel(origCell.col, origCell.row);
    await dfsSaveIconPosition(occupant.id, occupant.isSpecial, swapPos.x, swapPos.y);
  }
  await dfsSaveIconPosition(draggedId, draggedIsSpecial, finalPos.x, finalPos.y);
  return finalPos;
}
// 격자모드로 막 전환했을 때: 그동안 자유롭게 흩어져 있던 모든 아이콘을 각자 가장 가까운 빈 격자
// 칸으로 한 번에 정렬한다(실제 윈도우에서 "격자에 맞춤"을 막 켰을 때와 같은 느낌).
async function dfsSnapAllIconsToGrid() {
  const all = await dfsAllDesktopIconPositions();
  const maxRows = dfsMaxGridRows();
  const occupied = new Set();
  // 화면에 보이는 순서(위→아래, 왼쪽→오른쪽)로 처리해야 시각적으로 크게 안 튀고 자연스럽게 정렬된다.
  const ordered = [...all].sort((a, b) => {
    const ca = dfsPixelToCell(a.x, a.y), cb = dfsPixelToCell(b.x, b.y);
    return ca.col - cb.col || ca.row - cb.row;
  });
  for (const it of ordered) {
    const wanted = dfsPixelToCell(it.x, it.y);
    const cell = dfsNearestFreeCell(occupied, wanted.col, wanted.row, maxRows);
    occupied.add(`${cell.col},${cell.row}`);
    const pos = dfsCellToPixel(cell.col, cell.row);
    await dfsSaveIconPosition(it.id, it.isSpecial, pos.x, pos.y);
  }
}
async function dfsCreateFolder(parentId) {
  const name = await dfsUniqueName(parentId, "새 폴더");
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  const id = await dfsDb.nodes.add({ parentId, type: "folder", name, x: pos.x, y: pos.y, createdAt: now, updatedAt: now });
  return dfsDb.nodes.get(id);
}
const DFS_FILE_DEFAULTS = {
  txt: { label: "새 텍스트 문서.txt", fileType: "txt" },
  md: { label: "새 Markdown 문서.md", fileType: "md" },
  html: { label: "새 HTML 문서.html", fileType: "html" }
};
async function dfsCreateFile(parentId, kind) {
  const d = DFS_FILE_DEFAULTS[kind] || DFS_FILE_DEFAULTS.txt;
  const name = await dfsUniqueName(parentId, d.label);
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  const id = await dfsDb.nodes.add({ parentId, type: "file", name, content: "", fileType: d.fileType, x: pos.x, y: pos.y, createdAt: now, updatedAt: now });
  return dfsDb.nodes.get(id);
}
// ---------------- OS(진짜 컴퓨터)에서 파일을 드래그해서 떨어뜨렸을 때 즉시 가져오기 ----------------
// 요청 #145: "텍스트 파일만 지원하던 것을 다른 파일 형식도 지원하게" - 이 앱의 가상 파일시스템은
// 원래 텍스트만 저장했지만(에디터로 열어 수정 가능해야 하므로), 이제 텍스트로 보이지 않는 파일은
// 내용을 억지로 텍스트로 바꾸지 않고 File 객체(Blob) 그대로 dexie에 저장한다(IndexedDB는 Blob을
// 직접 저장할 수 있어 base64로 부풀릴 필요가 없다) - 노드에 binary:true + blob(파일 그대로) +
// mime(file.type)을 추가로 들고, 기존 content 필드는 비워둔다. 이런 파일은 에디터로 열 수
// 없으므로(dfsActivate가 binary를 먼저 확인해 분기), 더블클릭하면 이미지는 새 탭 미리보기,
// 그 외에는 그냥 다운로드된다(dfsActivateBinaryFile 참고) - 다른 모든 기능(이름변경/복사/이동/
// 삭제/속성/폴더 다운로드 등)은 dfsFileByteSize 등을 통해 문자열 content든 Blob이든 구분 없이
// 그대로 동작한다.
// ---------------- 저장소(GitHub 리포) 파일을 이 앱 "안"의 가짜 바탕화면/폴더로 드롭해서 가져오기 ----------------
// 버그 리포트: "바탕화면에 드래그&드롭하면 저장되는데, 탐색기(바탕화면 안의) 폴더 안에 드롭하면
// 로컬 저장소(IndexedDB)에 안 들어감" - 원인은 attachRepoFileDragOut(content-pane.js)이 dragstart에서
// "DownloadURL" 데이터만 채워뒀을 뿐, 이 앱 자신의 드롭 대상(desktop-fs.js .desktop / content-pane.js
// 폴더 칸·내용창 배경 / tree-pane.js 트리 행)들은 전부 "Files"(진짜 OS 파일)나 "text/plain"(내부
// 가상 파일시스템 이동)만 받아들이고 "DownloadURL"은 아예 검사하지 않았던 것 - 그래서 브라우저
// 밖(진짜 OS 바탕화면/탐색기)으로 끌어낼 때만 되고, 페이지 "안"의 어디에 놓든(바탕화면이든 그
// 안의 폴더든 전부 마찬가지로) 전혀 반응이 없었다. 새로 만든 폴더만 안 되는 게 아니라 사실 바탕화면
// 자체도 안 됐던 것인데, 바탕화면 아이콘 위(예: 다른 텍스트 파일 위)에 놓았을 때만 우연히 그 파일의
// text/plain 이동 조건과 헷갈렸을 뿐이다. 고침: "DownloadURL"도 각 드롭 대상이 인식하는 타입에
// 추가하고, 드롭 시 이 함수로 실제 내용을 fetch해서 텍스트 그대로 새 가상 파일로 만든다(다운로드
// 없이 바로 IndexedDB에 저장 - 사용자 지시대로 OS로 실제로 다운로드하지 않는다).
function dfParseDownloadUrlData(raw) {
  // "mime-type:filename:url" 형식(우리가 만든 값 - content-pane.js의 attachRepoFileDragOut 참고).
  // filename/url 자체엔 콜론이 없다고 가정할 수 없으므로(특히 url은 http://...라서 반드시 있음),
  // 첫 번째 콜론까지를 mime, 그 다음 콜론까지를 filename, 나머지 전부를 url로 자른다.
  if (!raw) return null;
  const i1 = raw.indexOf(":");
  if (i1 === -1) return null;
  const i2 = raw.indexOf(":", i1 + 1);
  if (i2 === -1) return null;
  const name = raw.slice(i1 + 1, i2);
  const url = raw.slice(i2 + 1);
  if (!name || !url) return null;
  return { name, url };
}
async function dfsImportRepoFileFromDownloadUrlData(parentId, raw) {
  const parsed = dfParseDownloadUrlData(raw);
  if (!parsed) return null;
  let text;
  try {
    const res = await fetch(parsed.url);
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch (e) {
    showToast(`"${parsed.name}"을(를) 가져오지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
    return null;
  }
  // 드래그가 시작될 때 이미 텍스트 형식만 걸러서 draggable로 만들었지만(attachRepoFileDragOut),
  // 혹시 모를 예외(캐시가 낡았거나 등)에 대비해 실제로 받은 내용으로 한 번 더 확인한다.
  if (!dfLooksLikeText(text.slice(0, 8000))) {
    showToast(`"${parsed.name}"은(는) 텍스트 형식이 아니라서 가져올 수 없습니다.`, { kind: "warn", sound: "error_generic" });
    return null;
  }
  const desiredName = parsed.name || "새 파일.txt";
  const conflict = await dfsFindNameConflict(parentId, desiredName, null);
  if (conflict) {
    const ok = await showConfirmDialog(`이 위치에 이미 "${desiredName}" 항목이 있습니다. 덮어쓸까요?`);
    if (!ok) return null;
    await dfsDelete(conflict);
  }
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  const id = await dfsDb.nodes.add({
    parentId, type: "file", name: desiredName, content: text, fileType: dfDetectFileType(desiredName),
    x: pos.x, y: pos.y, createdAt: now, updatedAt: now
  });
  return dfsDb.nodes.get(id);
}
// dragover/drop 리스너가 공통으로 쓰는 판별/처리 헬퍼 - "DownloadURL" 타입이 있으면 저장소 파일
// 드래그이므로 이 경로로, 아니면(기존처럼) 호출한 쪽이 Files/text-plain 분기를 계속 처리한다.
function dfDragHasRepoFile(e) {
  if (!e.dataTransfer) return false;
  const types = Array.from(e.dataTransfer.types || []);
  return types.indexOf("DownloadURL") !== -1;
}
async function dfHandleRepoFileDrop(e, parentId, refresh) {
  const raw = e.dataTransfer.getData("DownloadURL");
  const result = await dfsImportRepoFileFromDownloadUrlData(parentId, raw);
  if (result) {
    showToast(`"${result.name}"을(를) 가져왔습니다.`);
    if (refresh) await refresh();
    await dfsBroadcastChange();
  }
}
async function dfsImportOsFile(parentId, file) {
  // 요청 #154: 저장소 등에서 .sc로 받아둔 바로가기 파일을 데스크탑으로 다시 끌어다 놓으면, 그냥
  // 텍스트 파일로 가져가지 말고 진짜 바로가기(type:"shortcut")로 되살려야 한다는 지시 - 다른 곳의
  // activateScShortcut(keyboard-and-activate.js)과 똑같은 기준(JSON을 파싱해서 url 필드가 있는지)
  // 으로 판단한다. 이 앱이 만든 형식이 아니면(false 반환) 그냥 아래 일반 텍스트 파일 가져오기로
  // 자연스럽게 이어진다.
  if (isSc(file.name)) {
    const result = await dfsImportScFile(parentId, file);
    if (result !== false) return result; // 진짜 바로가기 형식이었다면 성공/취소 어느 쪽이든 여기서 끝(일반 파일로 안 떨어짐)
  }
  // 파일 전체를 텍스트로 읽기 전에, 앞부분만 살짝 떼어 읽어서 텍스트인지 먼저 가늠한다(큰
  // 이진 파일 전체를 문자열로 디코딩하는 낭비/깨짐을 피한다).
  let sample = "";
  try {
    sample = await file.slice(0, 8000).text();
  } catch (e) {
    sample = ""; // 못 읽으면 이진으로 취급
  }
  const looksText = dfLooksLikeText(sample);
  const desiredName = file.name || (looksText ? "새 파일.txt" : "새 파일");
  // 실제 컴퓨터에서 드롭한 파일이 이미 있는 이름과 겹치면 조용히 번호를 붙이는 대신 덮어쓸지
  // 물어본다(버그 리포트: 확인창 없이 그냥 처리되던 문제 - dfsMove/dfsCopyInto와 같은 방식).
  const conflict = await dfsFindNameConflict(parentId, desiredName, null);
  if (conflict) {
    const ok = await showConfirmDialog(`이 위치에 이미 "${desiredName}" 항목이 있습니다. 덮어쓸까요?`);
    if (!ok) return null;
    await dfsDelete(conflict);
  }
  const name = desiredName;
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  const base = { parentId, type: "file", name, x: pos.x, y: pos.y, createdAt: now, updatedAt: now };
  let record;
  if (looksText) {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      showToast(`"${file.name}"을(를) 읽지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
      return null;
    }
    record = { ...base, content: text, fileType: dfDetectFileType(name) };
  } else {
    // 이진 파일 - 4MB(로컬 헬퍼의 /savecontent 상한과 맞춤)보다 크면 dexie/IndexedDB 저장 자체는
    // 되지만 나중에 헬퍼로 다시 내려받을 때 서버 쪽 상한에 걸릴 수 있어 미리 안내만 해준다(막지는
    // 않음 - 브라우저 자체 다운로드(dfsDownloadVirtualFile)는 크기 제한이 없으므로).
    if (file.size > 4 * 1024 * 1024) {
      showToast(`"${file.name}"은(는) 4MB보다 커서, 나중에 "다운로드"(로컬 헬퍼)로 저장할 때 실패할 수 있습니다. "브라우저에서 다운로드"는 그대로 됩니다.`, { kind: "warn", sound: "error_generic" });
    }
    record = { ...base, content: "", binary: true, blob: file, mime: file.type || "", fileType: dfDetectFileType(name) };
  }
  const id = await dfsDb.nodes.add(record);
  return dfsDb.nodes.get(id);
}
// dfsImportOsFile에서 분리 - .sc로 드롭된 파일이 이 앱이 만든 바로가기 형식(JSON + url 필드)인지
// 확인해서, 맞으면 확장자를 뗀 이름의 type:"shortcut" 노드로 만든다. 반환값 3가지:
//  - false: 이 앱이 만든 .sc 형식이 아니다(JSON이 아니거나 url이 없음) -> 호출한 쪽이 일반
//    텍스트 파일 가져오기로 계속 진행해야 한다.
//  - null: 형식은 맞지만 같은 이름 항목이 있어 덮어쓸지 물었는데 사용자가 취소함 -> 아무것도
//    만들지 않고 그대로 끝(일반 파일로도 안 떨어짐 - 취소는 취소니까).
//  - 그 외: 새로 만든 바로가기 노드.
async function dfsImportScFile(parentId, file) {
  let text;
  try {
    text = await file.text();
  } catch (e) {
    return false;
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return false;
  }
  if (!data || typeof data.url !== "string" || !data.url) return false;
  // 요청 #141과 같은 규칙: 실제 윈도우가 .lnk 확장자를 숨기는 것처럼, 데스크탑에 만들어질
  // 바로가기의 이름에서도 .sc를 뗀다(displayName과 같은 방식 - 어차피 여기 새로 만드는 노드는
  // "실제 파일명"이라는 개념이 없어 그대로 이름으로 쓴다).
  const desiredName = displayName(file.name || "") || "새 바로가기";
  const conflict = await dfsFindNameConflict(parentId, desiredName, null);
  if (conflict) {
    const ok = await showConfirmDialog(`이 위치에 이미 "${desiredName}" 항목이 있습니다. 덮어쓸까요?`);
    if (!ok) return null;
    await dfsDelete(conflict);
  }
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  const id = await dfsDb.nodes.add({
    parentId, type: "shortcut", name: desiredName,
    url: data.url, icon: (typeof data.icon === "string" && data.icon) || "", popup: !!data.popup,
    x: pos.x, y: pos.y, createdAt: now, updatedAt: now
  });
  return dfsDb.nodes.get(id);
}
async function dfsImportOsFileList(parentId, fileList, refresh) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let ok = 0;
  for (const f of files) {
    if (await dfsImportOsFile(parentId, f)) ok++;
  }
  if (ok > 0) {
    showToast(`${ok}개 파일을 가져왔습니다.`);
    if (refresh) await refresh();
    await dfsBroadcastChange();
  }
}
async function dfsDeepCopyChildren(fromId, toId) {
  const kids = await dfsDb.nodes.where("parentId").equals(fromId).toArray();
  for (const kid of kids) {
    const now = Date.now();
    const copy = { parentId: toId, type: kid.type, name: kid.name, createdAt: now, updatedAt: now };
    if (kid.type === "file") {
      copy.content = kid.content; copy.fileType = kid.fileType;
      // 요청 #145: 이진 파일 복사 시 blob/mime도 같이 옮겨야 사본도 정상적으로 열린다/받아진다.
      if (kid.binary) { copy.binary = true; copy.blob = kid.blob; copy.mime = kid.mime; }
    }
    // 요청 #133: targetId가 있으면(기존 방식) 내부 항목을 가리키는 바로가기, 없고 url이 있으면
    // 사용자가 직접 주소/아이콘을 입력해 만든 바로가기 - 둘 다 복사 시 그대로 유지해야 한다.
    if (kid.type === "shortcut") { copy.targetId = kid.targetId; copy.url = kid.url; copy.icon = kid.icon; }
    const newId = await dfsDb.nodes.add(copy);
    if (kid.type === "folder") await dfsDeepCopyChildren(kid.id, newId);
  }
}
async function dfsCopyInto(node, parentId, desiredName) {
  let name;
  if (desiredName) {
    // 호출한 쪽이 이름을 정해서 넘겼다(예: dfsDuplicate의 "- 복사본" 접미사) - 그대로 조용히
    // 고유화만 한다. 충돌 확인/덮어쓰기 질문은 필요 없음(애초에 다른 이름이라 겹칠 일이 드묾).
    name = await dfsUniqueName(parentId, desiredName);
  } else if (node.parentId === parentId) {
    // 같은 폴더 안에 "붙여넣기"한 경우는 자기 자신과 이름이 겹치는 게 당연하다(사본을 만드는
    // 것뿐) - 덮어쓰기가 아니라 그냥 번호를 이어 붙인다("새 폴더 (2)" 안에서 붙여넣으면
    // "새 폴더 (3)"이 되는 식).
    name = await dfsUniqueName(parentId, node.name);
  } else {
    // 다른 폴더로 "붙여넣기"했는데 그 폴더에 이미 같은 이름이 있으면 진짜 충돌이므로 조용히
    // 번호를 붙이는 대신 덮어쓸지 물어본다(버그 리포트: 확인창 없이 그냥 처리되던 문제).
    const conflict = await dfsFindNameConflict(parentId, node.name, null);
    if (conflict) {
      if (node.type === "folder" && conflict.type === "folder") {
        // 버그 리포트: "새 폴더 (2)를 새 폴더에 넣을때 새 폴더 (2)를 덮을지에 대해서는 묻고
        // 하위의 하위의 하위 파일 검증은 안해서 이전 자료가 덮어져 소실됨" - 폴더끼리 이름이
        // 겹치면 기존 폴더를 통째로 지우고 교체하는 대신, 안의 내용을 이름별로 재귀적으로
        // 맞춰보며 병합한다(실제로 파일이 겹치는 지점에서만 개별적으로 덮어쓸지 물어본다).
        const ok = await showConfirmDialog(`이 위치에 이미 "${node.name}" 폴더가 있습니다. 안의 내용을 병합할까요?\n(겹치는 파일만 개별적으로 덮어쓸지 물어봅니다)`);
        if (!ok) return null;
        await dfsMergeFolderInto(node, conflict.id, "copy");
        return dfsDb.nodes.get(conflict.id); // 복사는 원본이 그대로 남으므로, 병합된 기존 폴더를 결과로 돌려준다
      }
      const ok = await showConfirmDialog(`이 위치에 이미 "${node.name}" 항목이 있습니다. 덮어쓸까요?`);
      if (!ok) return null;
      await dfsDelete(conflict);
    }
    name = node.name;
  }
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  const copy = { parentId, type: node.type, name, x: pos.x, y: pos.y, createdAt: now, updatedAt: now };
  if (node.type === "file") {
    copy.content = node.content; copy.fileType = node.fileType;
    if (node.binary) { copy.binary = true; copy.blob = node.blob; copy.mime = node.mime; } // 요청 #145
  }
  if (node.type === "shortcut") { copy.targetId = node.targetId; copy.url = node.url; copy.icon = node.icon; } // 요청 #133
  const id = await dfsDb.nodes.add(copy);
  if (node.type === "folder") await dfsDeepCopyChildren(node.id, id);
  return dfsDb.nodes.get(id);
}
async function dfsDuplicate(node) {
  return dfsCopyInto(node, node.parentId, dfsSuffixedName(node.name, "복사본"));
}
async function dfsCreateShortcut(node) {
  const name = await dfsUniqueName(node.parentId, dfsSuffixedName(node.name, "바로가기"));
  const now = Date.now();
  const pos = await dfsNextIconPos(node.parentId);
  const id = await dfsDb.nodes.add({ parentId: node.parentId, type: "shortcut", name, targetId: node.id, x: pos.x, y: pos.y, createdAt: now, updatedAt: now });
  return dfsDb.nodes.get(id);
}
// 요청 #133: 바탕화면/탐색기(가상 폴더) 빈 곳에서 "바로가기 생성"을 고르면 기존 항목을 가리키는
// 게 아니라, 사용자가 직접 입력한 이름/주소(URL)/아이콘으로 완전히 새로운 바로가기를 만든다
// (dfsCreateShortcut의 targetId 방식과 달리 url/icon 필드를 쓴다 - dfsActivate/dfsIconGlyphFor
// 양쪽에서 이 둘을 구분해서 처리한다). icon은 비어 있으면 기본 파일 아이콘으로 그려진다.
async function dfsCreateUrlShortcut(parentId, info) {
  const name = await dfsUniqueName(parentId, info.name || "새 바로가기");
  const now = Date.now();
  const pos = await dfsNextIconPos(parentId);
  // 요청 #141: popup - 활성화(더블클릭/열기)할 때 새 탭 대신 작은 팝업 창으로 열지 여부.
  const id = await dfsDb.nodes.add({ parentId, type: "shortcut", name, url: info.url, icon: info.icon || "", popup: !!info.popup, x: pos.x, y: pos.y, createdAt: now, updatedAt: now });
  return dfsDb.nodes.get(id);
}
// 요청: 저장소(진짜 파일/폴더) 우클릭 메뉴에서도 바탕 화면에 바로가기를 바로 만들 수 있어야 한다는
// 지시 - 저장소 항목은 dexie 안에 있는 게 아니라서(targetId 방식이 불가능) 이 앱 자신의 해시 기반
// 딥링크(pathToHash, data-and-hash.js)를 주소로 쓰는 url 방식 바로가기로 만든다. 이렇게 만든 바로
// 가기는 dfsDownloadShortcutFile로 .sc 파일로 받아 저장소에 다시 올려도(activateScShortcut) 같은
// 위치가 그대로 다시 열리므로, 바탕화면과 저장소 양쪽에서 재사용 가능한 진짜 바로가기가 된다.
async function dfsCreateDesktopShortcutFromRepoItem(it) {
  const url = location.origin + location.pathname + "#" + pathToHash(it.path);
  await dfsCreateUrlShortcut(DFS_DESKTOP_ROOT, { name: it.name, url, icon: "", popup: false });
  await dfsBroadcastChange();
  showToast(`"${it.name}" 바로가기를 바탕 화면에 만들었습니다.`, { sound: "move_or_copy" });
}
// 요청: targetId 방식(기존 바탕화면 항목을 가리키는) 바로가기도 편집/다운로드(.sc)가 가능해야
// 한다는 지시 - dfsCreateDesktopShortcutFromRepoItem이 저장소 항목을 가리킬 때 쓰는 것과 같은
// 방법(pathToHash 딥링크)으로, targetId가 가리키는 dexie 노드의 현재 경로를 거슬러 올라가며
// 구해서 그 자리에서 즉석으로 url을 만들어준다. 대상이 삭제됐거나(휴지통 포함) 찾을 수 없으면
// null을 반환한다.
async function dfsPathForNodeId(id) {
  if (!dfsDb) return null;
  let node = await dfsDb.nodes.get(id);
  if (!node) return null;
  const names = [node.name];
  let cur = node.parentId;
  while (cur !== DFS_DESKTOP_ROOT && cur !== DFS_RECYCLEBIN_ROOT) {
    const parent = await dfsDb.nodes.get(cur);
    if (!parent) return null;
    names.unshift(parent.name);
    cur = parent.parentId;
  }
  names.unshift(cur === DFS_RECYCLEBIN_ROOT ? RECYCLEBIN_TREE_NAME : DESKTOP_TREE_NAME);
  return names;
}
// 바로가기가 실제로 가리키는 주소를 구한다 - url 방식은 그대로, targetId 방식은 위 함수로 경로를
// 구해 이 앱의 딥링크로 즉석 변환한다(노드 자체를 바꾸지는 않는다 - 편집/다운로드 쪽에서 필요할
// 때만 호출해서 쓰는 "조회용" 함수).
async function dfsShortcutTargetUrl(node) {
  if (node.url) return node.url;
  if (!node.targetId) return null;
  const path = await dfsPathForNodeId(node.targetId);
  if (!path) return null;
  return location.origin + location.pathname + "#" + pathToHash(path);
}
/* ---------------- 요청 #141/#153: 바로가기 편집 ----------------
   showShortcutDialog를 "편집" 모드(defaults에 지금 값을 채우고 title/okLabel만 바꿈)로 다시 띄워서
   이름/주소/아이콘/팝업옵션을 한꺼번에 고친다. targetId 방식(기존 항목을 가리키는 바로가기)도
   이제 편집할 수 있다 - dfsShortcutTargetUrl로 지금 가리키는 위치를 딥링크 주소로 즉석 변환해서
   주소 칸에 미리 채워주고, 저장하면 그 주소를 진짜 url로 저장하며 targetId는 지운다(그 순간부터는
   "주소가 있는" 보통 바로가기가 되어 다음부터는 편집/다운로드 모두 이 함수 하나로 동작한다 - 대상
   항목이 이름 바뀌거나 이동해도 더는 자동으로 따라가지 않는 대신, 저장소에 올리거나 다른 곳에서도
   재사용할 수 있게 된다). 이름이 바뀌면 dfsRename과 같은 중복 검사를 거친다(다른 이름을 쓰던
   항목과 새 이름이 겹칠 수 있으므로) - 아니면 그냥 자기 자신과 "겹치는" 걸로 오판해서 항상 거부될
   수 있기 때문이다. */
async function dfsEditShortcut(node, refresh) {
  const currentUrl = await dfsShortcutTargetUrl(node);
  if (node.targetId && !currentUrl) {
    showToast("바로가기가 가리키던 대상을 찾을 수 없어(삭제되었거나 이동됨) 주소를 만들 수 없습니다.", { kind: "warn", sound: "error_generic" });
    return;
  }
  const info = await showShortcutDialog(
    { name: node.name, url: currentUrl || "", icon: node.icon || "", popup: !!node.popup },
    { title: "바로가기 편집", okLabel: "저장" }
  );
  if (!info) return;
  const patch = { url: info.url, icon: info.icon || "", popup: !!info.popup, targetId: null, updatedAt: Date.now() };
  const newName = info.name.trim() || "새 바로가기";
  if (newName !== node.name) {
    const err = dfsValidateName(newName);
    if (err) { showToast(err, { kind: "warn", sound: "error_generic" }); return; }
    const clash = await dfsFindNameConflict(node.parentId, newName, node.id);
    if (clash) { showToast(`"${newName}" 이름이 이미 있습니다.`, { kind: "warn", sound: "error_generic" }); return; }
    patch.name = newName;
  }
  await dfsDb.nodes.update(node.id, patch);
  showToast(`"${patch.name || node.name}"을(를) 저장했습니다.`, { sound: "move_or_copy" });
  await refresh();
}
/* ---------------- 요청 #141/#153: 바로가기를 실제 파일(.sc)로 다운로드 ----------------
   이 앱만 이해하는 아주 단순한 JSON 텍스트 형식이다 - 이걸 저장소(GitHub)에 올려두면, 다음에
   저장소 탐색기(진짜 리포 파일 목록)에서 그 .sc 파일을 다시 만났을 때도 activateScShortcut
   (keyboard-and-activate.js)이 그대로 읽어서 "바로가기"처럼 동작시킨다(재사용 목적 - 사용자
   지시). targetId 방식(기존 항목을 가리키는 바로가기)도 dfsShortcutTargetUrl로 지금 위치를
   딥링크 주소로 즉석 변환해서 담아 내보낸다(노드 자체는 targetId 방식 그대로 유지 - 다운로드는
   그냥 "지금 이 순간 가리키는 곳"의 스냅샷 파일 한 장을 만드는 것뿐이다). */
async function dfsDownloadShortcutFile(node) {
  const url = await dfsShortcutTargetUrl(node);
  if (!url) {
    showToast("바로가기가 가리키는 대상을 찾을 수 없어(삭제되었거나 이동됨) 파일로 받을 수 없습니다.", { kind: "warn", sound: "error_generic" });
    return;
  }
  const payload = JSON.stringify({ nihShortcut: 1, name: node.name, url, icon: node.icon || "", popup: !!node.popup }, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${node.name}.sc`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`"${node.name}.sc"로 받았습니다. 저장소에 올려두면 그 파일에서도 바로가기로 동작합니다.`, { sound: "download_complete" });
}
async function dfsRename(node, newNameRaw) {
  const err = dfsValidateName(newNameRaw);
  if (err) { showToast(err, { kind: "warn", sound: "error_generic" }); return false; }
  const newName = newNameRaw.trim();
  const siblings = await dfsDb.nodes.where("parentId").equals(node.parentId).toArray();
  const clash = siblings.some(s => s.id !== node.id && s.name.toLowerCase() === newName.toLowerCase());
  if (clash) { showToast(`"${newName}" 이름이 이미 있습니다.`, { kind: "warn", sound: "error_generic" }); return false; }
  await dfsDb.nodes.update(node.id, { name: newName, updatedAt: Date.now() });
  return true;
}
async function dfsDeleteDeep(id) {
  const kids = await dfsDb.nodes.where("parentId").equals(id).toArray();
  for (const kid of kids) await dfsDeleteDeep(kid.id);
  await dfsDb.nodes.delete(id);
}
// "삭제"는 이제 영구 삭제가 아니라 휴지통으로 옮기는 것이다(완전한 휴지통 기능 - 사용자 지시).
// 폴더는 그 안의 내용을 통째로 데리고 이동한다(하위 항목들의 parentId는 그대로라서 구조가 유지됨).
// 요청 #159: Shift+Delete는 실제 윈도우처럼 휴지통을 거치지 않고 곧바로 영구 삭제해야 한다 -
// dfsDelete를 호출하는 기존 ~13곳(드래그앤드롭 덮어쓰기 충돌 정리, 폴더 병합 정리 등 내부 동작)은
// 전부 이 두 번째 인자를 안 넘기므로(undefined = false) 그대로 휴지통行 동작을 유지하고, Delete
// 키/삭제 메뉴 쪽에서만 Shift 여부를 넘겨 실제로 영구 삭제가 필요한 경우에만 켠다.
async function dfsDelete(node, permanent) {
  if (permanent) { await dfsPermanentlyDelete(node); return; }
  await dfsDb.nodes.update(node.id, {
    originalParentId: node.parentId,
    deletedAt: Date.now(),
    parentId: DFS_RECYCLEBIN_ROOT
  });
  await dfsCloseWindowsShowing(node.id);
}
// 휴지통 비우기/영구 삭제 전용 - 진짜로 다시는 되돌릴 수 없게 지운다.
async function dfsPermanentlyDelete(node) {
  await dfsDeleteDeep(node.id);
  // 요청 #113: 휴지통이 이제 진짜 탐색기 안에서 폴더처럼 열어볼 수 있으므로, 지금 그 폴더 "안"을
  // 보고 있는 채로 영구 삭제됐다면(예: 휴지통에 든 폴더를 열어본 뒤 그 폴더 자체를 영구 삭제)
  // 삭제된 경로가 그대로 남아 오류 화면이 뜨지 않도록 휴지통 루트로 되돌린다.
  await dfsCloseWindowsShowing(node.id);
}
async function dfsRecycleBinItems() {
  if (!dfsDb) return [];
  const items = await dfsDb.nodes.where("parentId").equals(DFS_RECYCLEBIN_ROOT).toArray();
  items.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  return items;
}
// 휴지통에서 원래 있던 자리로 되돌린다. 그 사이 원래 부모 폴더 자체가 사라졌으면(그 폴더도 같이
// 삭제됐거나 등) 바탕화면 최상위로 대신 복원한다. 이름이 그 사이 다시 쓰였으면 번호를 붙인다.
async function dfsRestoreFromRecycleBin(node) {
  let targetParent = node.originalParentId != null ? node.originalParentId : DFS_DESKTOP_ROOT;
  if (targetParent !== DFS_DESKTOP_ROOT) {
    const p = await dfsDb.nodes.get(targetParent);
    if (!p) targetParent = DFS_DESKTOP_ROOT;
  }
  const uniqueName = await dfsUniqueName(targetParent, node.name);
  const pos = await dfsNextIconPos(targetParent);
  await dfsDb.nodes.update(node.id, {
    parentId: targetParent,
    name: uniqueName,
    x: pos.x, y: pos.y,
    updatedAt: Date.now()
  });
  showToast(`"${uniqueName}"을(를) 복원했습니다.`, { sound: "restore_from_recyclebin" });
}
async function dfsEmptyRecycleBin() {
  const items = await dfsRecycleBinItems();
  if (!items.length) { showToast("휴지통이 비어 있습니다."); return; }
  const ok = await showConfirmDialog(`휴지통에 있는 ${items.length}개 항목을 완전히 삭제할까요? (되돌릴 수 없습니다)`);
  if (!ok) return;
  for (const it of items) await dfsPermanentlyDelete(it);
  showToast("휴지통을 비웠습니다.", { sound: "recyclebin_empty" });
}
/* ---------------- 휴지통 속성(요청 #113(b) - 윈도우 폴더 속성처럼 경로 표시) ----------------
   예전엔 휴지통 전용 오버레이 패널이 따로 있었지만(사용자 지시로 제거 - "그냥 트리에 들어있는거
   말고 폴더처럼" 통합됨), "속성"만은 실제 폴더 속성 대화상자처럼 별도의 작은 안내창으로 남긴다. */
async function dfsShowRecycleBinProperties() {
  const items = await dfsRecycleBinItems();
  const path = `${repoName || "이 PC"}\\${RECYCLEBIN_TREE_NAME}`;
  // 요청 #140: 휴지통에 든 폴더 안의 내용까지(재귀) 포함한 전체 크기/개수도 같이 보여준다.
  const stats = await computeDesktopFolderStats(DFS_RECYCLEBIN_ROOT);
  await showInfoDialog(`휴지통 속성\n\n종류: 시스템 폴더\n위치: ${path}\n크기: ${formatBytes(stats.bytes)} (${stats.bytes.toLocaleString("ko-KR")} 바이트)\n항목: ${items.length}개 (하위 포함 파일 ${stats.files}개, 폴더 ${stats.folders}개)`);
}
/* ---------------- 요청 #140: 바탕화면(가상 파일시스템) 폴더의 속성 ----------------
   실제 저장소 폴더와 달리 네트워크 왕복이 없는 로컬 dexie 조회라, 진행 대화상자 없이 재귀
   집계해도 체감상 즉시 끝난다. 바로가기(shortcut)는 실제 저장 공간을 거의 차지하지 않고
   "무엇을 담고 있는 폴더인가"의 답도 아니므로, dfsCollectFolderFiles(폴더 통째로 다운로드)와
   같은 규칙으로 개수/크기 집계에서 제외한다 - 자기 자신을 가리키는 폴더 속성에 굳이
   바로가기까지 파일처럼 세면 오히려 혼동을 준다. */
async function computeDesktopFolderStats(folderId) {
  let files = 0, folders = 0, bytes = 0;
  const kids = await dfsChildren(folderId);
  for (const kid of kids) {
    if (kid.type === "folder") {
      folders++;
      const sub = await computeDesktopFolderStats(kid.id);
      files += sub.files; folders += sub.folders; bytes += sub.bytes;
    } else if (kid.type === "file") {
      files++;
      bytes += dfsFileByteSize(kid); // 요청 #145: 이진 파일은 blob.size로
    }
    // shortcut은 위 주석 이유로 집계에서 제외
  }
  return { files, folders, bytes };
}
async function dfsShowDesktopFolderProperties(folderId, pathArr) {
  const stats = await computeDesktopFolderStats(folderId);
  const label = (pathArr && pathArr.length) ? pathArr[pathArr.length - 1] : DESKTOP_TREE_NAME;
  const location = (pathArr && pathArr.length) ? pathArr.join("\\") : DESKTOP_TREE_NAME;
  await showInfoDialog(
    `${label} 속성\n\n종류: 폴더\n위치: ${location}\n크기: ${formatBytes(stats.bytes)} (${stats.bytes.toLocaleString("ko-KR")} 바이트)\n포함: 파일 ${stats.files}개, 폴더 ${stats.folders}개`
  );
}
// 바탕화면 파일/바로가기 속성 - 재귀가 필요 없으므로 간단하게 그 자리에서 바로 보여준다.
async function dfsShowDesktopFileProperties(node, pathArr) {
  const location = (pathArr && pathArr.length > 1) ? pathArr.slice(0, -1).join("\\") : DESKTOP_TREE_NAME;
  const lines = [`${node.name} 속성`, ""];
  if (node.type === "shortcut") {
    lines.push("종류: 바로가기");
    lines.push(`위치: ${location}`);
    lines.push(`대상: ${node.url || "(내부 항목을 가리키는 바로가기)"}`);
  } else {
    const size = dfsFileByteSize(node); // 요청 #145: 이진 파일은 blob.size로
    lines.push(`종류: ${node.binary ? (node.mime || "이진 파일") : (node.fileType ? node.fileType.toUpperCase() + " 파일" : "파일")}`);
    lines.push(`위치: ${location}`);
    lines.push(`크기: ${formatBytes(size)} (${size.toLocaleString("ko-KR")} 바이트)`);
  }
  await showInfoDialog(lines.join("\n"));
}
// 요청 #113(a): 파일/폴더를 휴지통 위로 드래그해서 놓으면 확인 없이 곧바로 삭제한다(실제 윈도우도
// 휴지통에 끌어다 놓을 때는 확인창 없이 바로 지운다) - 바탕화면의 휴지통 특수 아이콘(el이 그
// 아이콘 자신이거나 그 자식)인지 판별하는 공용 헬퍼. 트리의 휴지통 행은 각자 자기 자리에서
// attachRecycleBinTreeDropTarget(tree-pane.js)로 별도 처리한다.
function dfsIsRecycleBinIcon(el) {
  // 바탕화면의 휴지통 특수 아이콘뿐 아니라, 왼쪽 트리의 "휴지통" 행(tree-pane.js의
  // attachRecycleBinTreeDropTarget이 표시해둔 data-recycle-bin-root)도 같은 "삭제 대상"으로
  // 취급한다 - 마우스 기반 드래그(dfsSetupIconDrag)는 네이티브 드롭 이벤트가 없어 dfsElementUnder로
  // 찾은 이 요소를 직접 검사해야 하기 때문(요청 #113).
  return !!(el && el.closest && (
    el.closest(`.df-icon[data-special-id="${DFS_RECYCLEBIN_ICON_ID}"]`) ||
    el.closest('[data-recycle-bin-root]')
  ));
}
async function dfsIsDescendant(maybeAncestorId, folderId) {
  let p = folderId;
  while (p !== DFS_DESKTOP_ROOT && p != null) {
    if (p === maybeAncestorId) return true;
    const parentNode = await dfsDb.nodes.get(p);
    if (!parentNode) break;
    p = parentNode.parentId;
  }
  return false;
}
async function dfsMove(node, newParentId) {
  if (node.id === newParentId) return false;
  if (node.type === "folder" && await dfsIsDescendant(node.id, newParentId)) {
    showToast("폴더를 자기 자신의 하위로 옮길 수 없습니다.", { kind: "warn", sound: "error_generic" });
    return false;
  }
  if (node.parentId === newParentId) return true;
  // 이동은 복사와 달리 "같은 이름이면 조용히 번호를 붙이는" 게 아니라 실제 윈도우 탐색기처럼
  // 덮어쓸지 물어봐야 한다(버그 리포트: 폴더를 드래그해서 이미 같은 이름이 있는 곳에 넣어도
  // 확인창 없이 그냥 처리되던 문제 - 드래그로 옮기기/잘라내기 붙여넣기 둘 다 여기를 지난다).
  const conflict = await dfsFindNameConflict(newParentId, node.name, node.id);
  if (conflict) {
    if (node.type === "folder" && conflict.type === "folder") {
      // 버그 리포트(덮어쓰기로 인한 자료 소실): "바탕화면\새 폴더\새 폴더 (2)\새 텍스트 문서.txt"가
      // 있는 채로 "새 폴더 (2)"를 이미 "새 폴더 (2)"가 있는 위치로 옮기면, 예전엔 최상위 이름
      // 충돌 한 번만 확인하고 확인을 누르면 기존 "새 폴더 (2)"를 통째로 dfsDelete로 지워버려서
      // 그 안에 있던(지금 옮기는 폴더에는 없는) 다른 파일들이 검증 없이 그대로 사라졌다. 이제는
      // 폴더끼리 겹칠 때 통째로 지우고 교체하지 않고, 안의 내용을 이름별로 재귀적으로 맞춰보며
      // 병합한다 - 실제로 파일이 겹치는 지점(하위의 하위여도)에서만 개별적으로 덮어쓸지 물어본다.
      const ok = await showConfirmDialog(`이 위치에 이미 "${node.name}" 폴더가 있습니다. 안의 내용을 병합할까요?\n(겹치는 파일만 개별적으로 덮어쓸지 물어봅니다)`);
      if (!ok) return false;
      await dfsMergeFolderInto(node, conflict.id, "move");
      await dfsDelete(node); // 안의 내용을 모두 병합했으니, 이제 비어있는 원본 폴더 자체를 지운다
      return true;
    }
    const ok = await showConfirmDialog(`이 위치에 이미 "${node.name}" 항목이 있습니다. 덮어쓸까요?`);
    if (!ok) return false;
    await dfsDelete(conflict);
  }
  const patch = { parentId: newParentId, name: node.name, updatedAt: Date.now() };
  // 요청 #113(d): 휴지통 안의 항목을 드래그(또는 우클릭 복원)로 휴지통 밖으로 옮기면, 더는
  // "휴지통에 있다"는 낡은 표시(originalParentId/deletedAt)가 남아있으면 안 된다 - 이 필드들은
  // dfsRecycleBinItems가 parentId===DFS_RECYCLEBIN_ROOT인 것만 보여주므로 방치해도 화면에는
  // 안 보이지만, 깨끗하게 지워야 나중에 이 항목이 다시 삭제될 때 옛 원래 위치가 아니라 지금
  // 새로 옮겨진 위치를 기준으로 복원되게 된다.
  if (node.parentId === DFS_RECYCLEBIN_ROOT && newParentId !== DFS_RECYCLEBIN_ROOT) {
    patch.originalParentId = null;
    patch.deletedAt = null;
  }
  await dfsDb.nodes.update(node.id, patch);
  return true;
}
/* ---------------- 요청 #138: 다중 선택한 여러 아이콘을 한 번에 드래그해서 폴더/휴지통에
   떨어뜨렸을 때 전부 함께 옮기거나 지운다(예전엔 드래그한 그 아이콘 하나만 움직이고/처리됐음).
   특수 아이콘(저장소 루트/휴지통)은 애초에 옮기거나 지울 수 없으므로 호출부에서 이미 걸러내고
   실제 노드 id만 넘겨준다(dfsSetupIconDrag 참고). ---------------- */
async function dfsMoveManyToRecycleBin(ids) {
  if (!ids.length) return;
  const nodes = (await Promise.all(ids.map(id => dfsDb.nodes.get(id)))).filter(n => n && n.parentId !== DFS_RECYCLEBIN_ROOT);
  if (!nodes.length) return;
  for (const n of nodes) await dfsDelete(n);
  showToast(nodes.length === 1
    ? `"${nodes[0].name}"을(를) 휴지통으로 옮겼습니다.`
    : `${nodes.length}개 항목을 휴지통으로 옮겼습니다.`, { sound: "delete_to_recyclebin" });
  await dfsBroadcastChange();
}
async function dfsMoveManyToFolder(ids, targetId, targetName) {
  if (!ids.length) return;
  const candidates = (await Promise.all(ids.map(id => dfsDb.nodes.get(id)))).filter(n => n && n.id !== targetId);
  if (!candidates.length) return;
  const movedNames = [];
  for (const n of candidates) {
    // dfsMove는 형제 구조(이름 충돌 등)를 그때그때 다시 확인해야 하므로, 앞선 이동으로 상태가
    // 바뀌었을 수 있는 캐시된 n 대신 매번 최신 노드를 다시 읽어서 넘긴다.
    const fresh = await dfsDb.nodes.get(n.id);
    if (!fresh || fresh.parentId === targetId) continue;
    const ok = await dfsMove(fresh, targetId);
    if (ok) movedNames.push(fresh.name);
  }
  if (movedNames.length) {
    const dest = targetName ? `"${targetName}" 폴더` : "옮긴 위치";
    showToast(movedNames.length === 1
      ? `"${movedNames[0]}"을(를) ${dest}으로 옮겼습니다.`
      : `${movedNames.length}개 항목을 ${dest}으로 옮겼습니다.`, { sound: "move_or_copy" });
  }
  await dfsBroadcastChange();
}
// ---------------- 폴더끼리 이름이 겹칠 때의 재귀 병합(위 dfsMove/dfsCopyInto가 공용으로 씀) ----------------
// srcFolderNode 밑의 자식들을 이름 기준으로 destFolderId(이미 존재하는 같은 이름의 폴더) 안으로 하나씩
// 맞춰 넣는다 - 이름이 안 겹치면 그대로 옮기거나 복사하고, 폴더끼리 또 겹치면 한 단계 더 재귀적으로
// 내려가 병합하며(여기가 핵심 - "하위의 하위의 하위"까지 전부 이렇게 내려간다), 파일이 실제로
// 겹칠 때만(더 내려갈 데가 없는 진짜 충돌 지점) 개별적으로 덮어쓸지 물어본다.
async function dfsMergeFolderInto(srcFolderNode, destFolderId, mode) {
  const kids = await dfsDb.nodes.where("parentId").equals(srcFolderNode.id).toArray();
  for (const kid of kids) {
    const conflict = await dfsFindNameConflict(destFolderId, kid.name, mode === "move" ? kid.id : null);
    if (!conflict) {
      if (mode === "move") await dfsDb.nodes.update(kid.id, { parentId: destFolderId, updatedAt: Date.now() });
      else await dfsCopyInto(kid, destFolderId, kid.name);
      continue;
    }
    if (kid.type === "folder" && conflict.type === "folder") {
      await dfsMergeFolderInto(kid, conflict.id, mode);
      if (mode === "move") await dfsDeleteDeep(kid.id); // 다 옮겼으니 이제 비어있는 이 하위 폴더는 지운다
      continue;
    }
    // 더 내려갈 데가 없는 진짜 충돌(파일<->파일, 또는 파일<->폴더처럼 타입이 다른 경우) - 여기서만
    // 개별적으로 물어본다. 취소하면 이 항목만 건너뛰고 나머지 형제들은 계속 처리한다.
    const ok = await showConfirmDialog(`이 위치에 이미 "${kid.name}" 항목이 있습니다. 덮어쓸까요?`);
    if (!ok) continue;
    await dfsDelete(conflict);
    if (mode === "move") await dfsDb.nodes.update(kid.id, { parentId: destFolderId, updatedAt: Date.now() });
    else await dfsCopyInto(kid, destFolderId, kid.name);
  }
}

/* ---------------- 클립보드(복사/잘라내기/붙여넣기) - 앱 전체에서 하나만 공유 ---------------- */
let dfsClipboard = null; // { id, mode: "copy" | "cut" }
async function dfsPasteInto(parentId) {
  if (!dfsClipboard) return;
  const node = await dfsDb.nodes.get(dfsClipboard.id);
  if (!node) { dfsClipboard = null; return; }
  if (dfsClipboard.mode === "copy") {
    await dfsCopyInto(node, parentId);
  } else {
    const ok = await dfsMove(node, parentId);
    if (ok) dfsClipboard = null; else return;
  }
  await dfsBroadcastChange();
}

/* ---------------- 변경 후 화면 갱신: 바탕화면 아이콘 + (통합된) 진짜 탐색기 창 ----------------
   예전에는 팝업으로 여러 개 떠 있는 가상 탐색기 창들을 전부 돌면서 새로고침했지만, 이제 바탕화면은
   "진짜" 탐색기 창(#win) 하나로 완전히 통합됐으므로(사용자 지시), 지금 그 창이 보여주고 있는
   위치(currentPath) 하나만 다시 그리면 된다. 바탕화면 관련 폴더 캐시는 dexie가 항상 최신
   정본이므로, 무엇이 바뀌었든 캐시된 항목을 전부 지워서 다음에 다시 읽을 때 최신 상태로
   채워지게 한다. */
async function dfsBroadcastChange() {
  await dfsRenderDesktop();
  // 요청 #113: 휴지통도 이제 바탕화면과 똑같이 dexie 기반 경로이므로(복원/영구삭제가 바탕화면
  // 쪽 캐시에도 영향을 줄 수 있음 - 예: 복원하면 목적지 폴더 캐시가 바뀜) 두 뿌리 다 지운다.
  for (const k of [...dirCache.keys()]) {
    if (k === DESKTOP_TREE_NAME || k.startsWith(DESKTOP_TREE_NAME + "/") || k === RECYCLEBIN_TREE_NAME || k.startsWith(RECYCLEBIN_TREE_NAME + "/")) dirCache.delete(k);
  }
  await revealPath(currentPath).catch(() => {});
  await renderContentPane();
  renderNavPane();
}
async function dfsCloseWindowsShowing(nodeId) {
  // 지금 통합된 진짜 탐색기 창(#win)이 방금 삭제된(또는 영구 삭제된) 폴더(또는 그 하위)를 보고
  // 있었다면, 더는 보여줄 게 없으므로 그 뿌리(바탕화면 또는 휴지통) 루트로 이동한다(실제
  // 탐색기도 보던 폴더가 사라지면 오류 대신 상위/기본 위치로 돌아가는 것과 같은 동작). 요청
  // #113: 휴지통 안까지 들어가서 보고 있을 수도 있으므로 그쪽도 같은 방식으로 처리한다.
  if (!isDfsPath(currentPath)) return;
  const curFolderId = await dfsResolvePathToFolderId(currentPath);
  // 못 찾으면(curFolderId==null) 지금 보던 위치 자체가 깨진 것이므로(방금 삭제됐거나 그 하위였음)
  // 마찬가지로 그 뿌리로 돌아간다.
  if (curFolderId == null || curFolderId === nodeId || await dfsIsDescendant(nodeId, curFolderId)) {
    navigate(isRecycleBinPath(currentPath) ? [RECYCLEBIN_TREE_NAME] : [DESKTOP_TREE_NAME]);
  }
}

/* ---------------- 아이콘 그리기 ---------------- */
function dfsIconGlyphFor(node, size) {
  let inner;
  if (node.type === "folder") inner = folderIcon(size, false);
  // 요청 #133: 사용자가 직접 주소/아이콘을 입력해 만든 바로가기는 그 아이콘(URL 또는 붙여넣은
  // base64 이미지)이 있으면 그대로 그린다 - 기존 항목을 가리키는 바로가기(아이콘 지정 없음)는
  // 예전처럼 기본 파일 아이콘을 쓴다.
  else if (node.type === "shortcut") inner = node.icon ? `<img src="${escapeHtml(resolveIconSrc(node.icon))}" style="width:${size}px;height:${size}px;object-fit:contain;">` : fileIcon(size);
  else {
    // 요청 #146: "확장자 아이콘을 바꾸면 저장소 파일에는 적용되는데 바탕화면에 만든 파일에는
    // 적용이 안 됨" - state.js의 resolveFileIcon(진짜 저장소 파일용)과 같은 순서로, 먼저
    // icon_set.json의 확장자별 커스텀 아이콘부터 확인한다. 없을 때만 기존 규칙(이진 이미지 배지 /
    // html 배지 / 기본 파일 아이콘)으로 떨어진다.
    const ext = fileExtOf(node.name);
    const custom = ext && customIconConfig.extensions[ext];
    if (custom) inner = customImgIcon(custom, size);
    // 요청 #145: 이진 파일 중 이미지는 별도 배지 아이콘, 그 외 이진/텍스트는 기존 그대로.
    else if (node.binary) inner = (node.mime || "").indexOf("image/") === 0 ? imageFileIcon(size) : fileIcon(size);
    else inner = node.fileType === "html" ? htmlFileIcon(size) : fileIcon(size);
  }
  const badge = node.type === "shortcut" ? '<span class="df-icon-shortcut-badge">↪</span>' : "";
  return `<span style="position:relative;display:inline-block;">${inner}${badge}</span>`;
}

/* ---------------- 데스크탑 아이콘 ---------------- */
let dfsSelectedIconId = null;
// 러버밴드(드래그) 또는 Ctrl/Shift+클릭으로 여러 개를 한꺼번에 선택한 아이콘 id들.
// 단일 선택(dfsSelectedIconId)과는 서로 배타적 - 하나가 채워지면 다른 하나는 비운다.
let dfsMultiSelected = new Set();
// 요청 #120: 키보드의 "컨텍스트 메뉴 호출" 키를 눌렀을 때 다중 선택 중 어느 항목 위에 메뉴를 열지
// 정하기 위한 값 - "click"이면 Ctrl/Shift+클릭으로 하나씩 누적한 선택(이 경우 마지막으로 클릭한
// 항목 위에 열림), "drag"면 러버밴드로 한 번에 잡은 선택(이 경우 동시에 잡힌 것으로 보고 가장
// 오른쪽 위 항목 위에 열림) - dfsFindContextMenuKeyIcon 참고.
let dfsLastSelectionOrigin = "click";
// 요청 #151: Shift+방향키 범위 선택용 상태 - dfIconLayer의 keydown 리스너(방향키 처리) 참고.
let dfsArrowAnchorId = null;
let dfsArrowPath = [];
let dfsArrowStateFingerprint = null;
function dfsCurrentSelectionFingerprint() {
  if (dfsMultiSelected.size > 1) return "m:" + [...dfsMultiSelected].map(String).sort().join(",");
  if (dfsSelectedIconId !== null) return "s:" + String(dfsSelectedIconId);
  return "s:";
}
// Ctrl+A = 바탕화면 아이콘 전체 선택 (dfIconLayer의 keydown 리스너에서 호출됨).
async function dfsSelectAllIcons() {
  if (!dfsDb) return;
  const items = await dfsChildren(DFS_DESKTOP_ROOT);
  if (!items.length) return;
  dfsSelectedIconId = null;
  dfsMultiSelected = new Set(items.map(n => n.id));
  dfsRenderDesktop();
}
// 바탕화면의 두 특수 아이콘(저장소 루트 / 휴지통) - dexie에 저장된 진짜 노드가 아니라 매번 고정
// 위치(dfsNextIconPos의 2칸 예약과 짝을 맞춤)에 그려지는 가짜 아이콘이다. 문자열 id를 붙여서
// 선택 표시(dfsSelectedIconId)는 재사용하되, F2/Delete/드래그 등 dexie CRUD 경로는 타지 않는다
// (dfsDb.nodes.get(id)가 문자열 id에 대해 undefined를 돌려주므로 자연히 무시됨).
const DFS_REPOROOT_ICON_ID = "repo-root";
const DFS_RECYCLEBIN_ICON_ID = "recycle-bin";
// 요청 #167: 휴지통 아이콘이 비었는지 여부 - dfsRenderDesktop()이 매번 실제 항목 수를 확인해서
// 갱신해두는 캐시다. tree-pane.js의 renderNavPane()은 동기 함수라 그 자리에서 dexie를 다시 조회할
// 수 없어서, 가장 최근에 dfsRenderDesktop()이 계산해둔 이 값을 그대로 읽어 쓴다.
let dfsRecycleBinHasItems = false;
// 요청 #112 - 사용자 지시: "레포 폴더와, 휴지통도 이동 가능하게". 이 둘은 dexie 노드가 아니라서
// (x,y)를 dfsDb.nodes에 저장할 수 없으므로, 다른 저장소별 UI 상태(설정/트리 펼침 등)와 같은
// 방식으로 localStorage에 따로 둔다: idx:<repo>:specialIconPos = { [specialId]: {x,y} }.
function dfsSpecialIconPosKey() { return `idx:${repoName}:specialIconPos`; }
function dfsLoadSpecialIconPos() {
  try {
    const raw = localStorage.getItem(dfsSpecialIconPosKey());
    if (raw) { const obj = JSON.parse(raw); if (obj && typeof obj === "object") return obj; }
  } catch (e) { /* 무시 - 위치 저장은 편의 기능일 뿐이라 실패해도 기본 위치로 그리면 된다 */ }
  return {};
}
function dfsSaveSpecialIconPos(id, x, y) {
  try {
    const all = dfsLoadSpecialIconPos();
    all[id] = { x, y };
    localStorage.setItem(dfsSpecialIconPosKey(), JSON.stringify(all));
  } catch (e) { /* 용량 초과 등은 무시 */ }
}
// 특수 아이콘 드래그 - dfsSetupIconDrag(진짜 dexie 노드용)와 뼈대는 같지만(마우스로 추적하다가
// 놓으면 clamp해서 확정), 이 둘은 폴더가 아니고 dexie 노드도 아니므로 "폴더 위에 놓으면 그 안으로
// 옮기기" 같은 드롭 타겟 로직은 없다 - 실제 윈도우에서도 휴지통/내 PC를 다른 폴더 "안"으로
// 옮길 수는 없고 바탕화면 위에서 위치만 바꿀 수 있는 것과 동일하다.
function dfsSetupSpecialIconDrag(iconEl, id) {
  let dragging = false, moved = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
  // 요청 #138: 이 특수 아이콘(저장소 루트/휴지통)도 다중 선택에 포함된 채로 끌리면, 선택된 나머지
  // 아이콘들이 형태를 유지하며 함께 움직인다. 다만 이 손잡이로 드롭했을 때는(원래도 그랬듯) 폴더로
  // 옮기거나 휴지통으로 지우는 동작은 없다 - 그룹 전체를 그냥 그 자리에 재배치/격자 스냅만 한다.
  let dragGroup = null;
  function clamp(el, left, top) {
    const maxLeft = Math.max(0, els.dfIconLayer.clientWidth - el.offsetWidth);
    const maxTop = Math.max(0, els.dfIconLayer.clientHeight - el.offsetHeight);
    return { left: Math.max(0, Math.min(left, maxLeft)), top: Math.max(0, Math.min(top, maxTop)) };
  }
  iconEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origLeft = parseFloat(iconEl.style.left) || 0;
    origTop = parseFloat(iconEl.style.top) || 0;
    dragGroup = (dfsMultiSelected.size > 1 && dfsMultiSelected.has(id))
      ? [...dfsMultiSelected].map(gid => {
          const el = dfsIconElementFor(gid);
          if (!el || el === iconEl) return null;
          return { el, id: gid, isSpecial: typeof gid === "string", origLeft: parseFloat(el.style.left) || 0, origTop: parseFloat(el.style.top) || 0 };
        }).filter(Boolean)
      : null;
    e.stopPropagation();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    const pos = clamp(iconEl, origLeft + dx, origTop + dy);
    iconEl.style.left = pos.left + "px";
    iconEl.style.top = pos.top + "px";
    iconEl.style.zIndex = 5;
    if (dragGroup) {
      const appliedDx = pos.left - origLeft, appliedDy = pos.top - origTop;
      dragGroup.forEach(g => {
        const gp = clamp(g.el, g.origLeft + appliedDx, g.origTop + appliedDy);
        g.el.style.left = gp.left + "px";
        g.el.style.top = gp.top + "px";
        g.el.style.zIndex = 5;
      });
    }
  });
  window.addEventListener("mouseup", async () => {
    if (!dragging) return;
    dragging = false;
    iconEl.style.zIndex = "";
    const group = dragGroup;
    dragGroup = null;
    if (group) group.forEach(g => { g.el.style.zIndex = ""; });
    if (!moved) return;
    const pos = clamp(iconEl, parseFloat(iconEl.style.left) || 0, parseFloat(iconEl.style.top) || 0);
    // 요청 #110: 격자모드면 이 특수 아이콘도 예외 없이 격자 칸에 스냅되고, 그 칸에 이미 다른
    // 아이콘(진짜 노드든 다른 특수 아이콘이든)이 있으면 자리를 맞바꾼다.
    if (dfsArrangeMode === "grid") {
      await dfsGridSnapDrop(id, true, pos.left, pos.top, origLeft, origTop);
      if (group) {
        for (const g of group) {
          const gp = clamp(g.el, parseFloat(g.el.style.left) || 0, parseFloat(g.el.style.top) || 0);
          await dfsGridSnapDrop(g.id, g.isSpecial, gp.left, gp.top, g.origLeft, g.origTop);
        }
      }
      await dfsRenderDesktop();
      return;
    }
    dfsSaveSpecialIconPos(id, pos.left, pos.top);
    if (group) {
      for (const g of group) {
        const gp = clamp(g.el, parseFloat(g.el.style.left) || 0, parseFloat(g.el.style.top) || 0);
        await dfsSaveIconPosition(g.id, g.isSpecial, gp.left, gp.top);
      }
      await dfsRenderDesktop();
    }
  });
}
function dfsRenderSpecialIcon(id, x, y, iconHtml, label, onDblClick, buildMenu) {
  const icon = document.createElement("div");
  const isSelected = dfsSelectedIconId === id || dfsMultiSelected.has(id);
  icon.className = "df-icon" + (isSelected ? " selected" : "");
  icon.style.left = x + "px";
  icon.style.top = y + "px";
  icon.dataset.specialId = id;
  icon.innerHTML = `<div class="df-icon-glyph">${iconHtml}</div><div class="df-icon-label">${escapeHtml(label)}</div>`;
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    // 요청 #154: 드래그로 옮긴 직후에도 마우스를 뗀 자리가 여전히 이 아이콘 위라 브라우저가 뒤이어
    // click 이벤트를 하나 더 보낸다 - 그걸 그냥 두면 다중 선택 중이던 나머지가 전부 풀리고 이
    // 아이콘 하나로 좁혀져 버린다(버그 리포트). dfsSetupIconDrag가 실제로 움직인 드래그였을 때만
    // 세워두는 dfsSuppressNextDesktopClick으로 이 한 번의 click만 무시한다.
    if (dfsSuppressNextDesktopClick) { dfsSuppressNextDesktopClick = false; els.dfIconLayer.focus(); return; }
    els.dfIconLayer.focus();
    dfsMultiSelected.clear();
    dfsSelectedIconId = id;
    dfsRenderDesktop();
  });
  icon.addEventListener("dblclick", () => onDblClick());
  icon.addEventListener("contextmenu", (e) => {
    e.preventDefault(); e.stopPropagation();
    els.dfIconLayer.focus();
    dfsMultiSelected.clear();
    dfsSelectedIconId = id;
    dfsRenderDesktop();
    showContextMenu(e.clientX, e.clientY, buildMenu());
  });
  dfsSetupSpecialIconDrag(icon, id);
  els.dfIconLayer.appendChild(icon);
}
async function dfsRenderDesktop() {
  if (!dfsDb) return;
  const items = await dfsChildren(DFS_DESKTOP_ROOT);
  // 요청 #167: 휴지통 아이콘을 그리기 전에 실제로 비어있는지 확인해서 캐시를 갱신한다(트리 쪽
  // 휴지통 행도 같은 캐시를 읽는다 - 위 dfsRecycleBinHasItems 선언부 참고).
  dfsRecycleBinHasItems = (await dfsRecycleBinItems()).length > 0;
  els.dfIconLayer.innerHTML = "";
  // 요청 #112: 두 특수 아이콘도 이동 가능해야 하므로, 사용자가 옮겨서 localStorage에 저장해둔
  // 위치가 있으면 그걸 쓰고, 없으면(처음 방문 등) 기존 기본 위치를 그대로 쓴다.
  const dfsSpecialPos = dfsLoadSpecialIconPos();
  const repoRootPos = dfsSpecialPos[DFS_REPOROOT_ICON_ID] || { x: 24, y: 24 };
  const recycleBinPos = dfsSpecialPos[DFS_RECYCLEBIN_ICON_ID] || { x: 24, y: 124 };
  // 저장소 루트 아이콘 - 트리의 루트 행과 똑같은 아이콘을 쓴다(사용자 지시).
  dfsRenderSpecialIcon(
    DFS_REPOROOT_ICON_ID, repoRootPos.x, repoRootPos.y, resolveRepoRootIcon(40), repoName || "루트",
    () => openRealExplorerAt([]),
    () => {
      const menu = [{ label: "열기", action: () => openRealExplorerAt([]) }];
      if (settings.githubLinksEnabled) menu.push({ label: "저장소에서 보기", action: () => openFolderInRepo({ path: [] }) });
      // 요청 #140: 바탕화면의 "레포 폴더" 특수 아이콘도 저장소 루트 기준으로 실시간 집계된 속성을 보여준다.
      menu.push({ label: "속성", action: () => showRepoFolderProperties([], { kind: "저장소 루트 폴더", title: repoName || "저장소" }) });
      return menu;
    }
  );
  // 휴지통 아이콘 - 바탕화면과 트리 양쪽에 같은 아이콘을 쓴다(사용자 지시). 요청 #111(열 우선
  // 자동배치)과 일관되게, 저장소 루트 아이콘의 옆(같은 줄)이 아니라 바로 아래(같은 첫 번째
  // 열)에 둔다 - 실제 사용자 아이콘들도 이 두 자리 다음(=idx 2)부터 같은 첫 번째 열을 계속
  // 이어서 채운다(dfsNextIconPos 참고).
  dfsRenderSpecialIcon(
    DFS_RECYCLEBIN_ICON_ID, recycleBinPos.x, recycleBinPos.y, resolveRecycleBinIcon(40, !dfsRecycleBinHasItems), "휴지통",
    // 요청 #113(c): 더는 별도 오버레이 패널이 아니라, 통합된 진짜 탐색기 창에서 휴지통 경로로
    // 이동한다 - 다른 폴더 아이콘을 더블클릭하는 것과 완전히 같은 방식.
    () => openRealExplorerAt([RECYCLEBIN_TREE_NAME]),
    () => [
      { label: "열기", action: () => openRealExplorerAt([RECYCLEBIN_TREE_NAME]) },
      { label: "휴지통 비우기", action: async () => { await dfsEmptyRecycleBin(); await dfsBroadcastChange(); } },
      { label: "속성", action: () => dfsShowRecycleBinProperties() }
    ]
  );
  items.forEach(node => {
    const icon = document.createElement("div");
    const isSelected = dfsSelectedIconId === node.id || dfsMultiSelected.has(node.id);
    icon.className = "df-icon" + (isSelected ? " selected" : "");
    icon.style.left = (node.x ?? 24) + "px";
    icon.style.top = (node.y ?? 24) + "px";
    icon.dataset.id = String(node.id);
    icon.innerHTML = `<div class="df-icon-glyph">${dfsIconGlyphFor(node, 40)}</div><div class="df-icon-label">${escapeHtml(node.name)}</div>`;
    icon.addEventListener("click", (e) => {
      e.stopPropagation();
      // 요청 #154: 위 특수 아이콘 click 핸들러와 같은 이유 - 드래그로 실제 이동이 있었으면 뒤이은
      // click 이벤트 한 번은 무시해서 다중 선택이 풀리지 않게 한다.
      if (dfsSuppressNextDesktopClick) { dfsSuppressNextDesktopClick = false; els.dfIconLayer.focus(); return; }
      // 아이콘층에 키보드 포커스를 줘야 이동(방향키)/F2/Delete가 먹는다(사용자 지시로 추가된
      // 바탕화면 키보드 지원 - 아래 dfIconLayer의 keydown 리스너와 triggerF2Rename/
      // triggerDeleteSelected 참고).
      els.dfIconLayer.focus();
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        // 실제 윈도우처럼 Ctrl(또는 Shift)+클릭으로 여러 개를 하나씩 누적/해제한다.
        // 지금까지 단일 선택(dfsSelectedIconId)이었다면, 그 아이콘부터 먼저 다중 선택 집합에
        // 옮겨 담아야 "하나 고른 채로 Ctrl+클릭"이 진짜로 두 개를 선택한 게 된다.
        if (dfsSelectedIconId !== null) { dfsMultiSelected.add(dfsSelectedIconId); dfsSelectedIconId = null; }
        if (dfsMultiSelected.has(node.id)) dfsMultiSelected.delete(node.id);
        else dfsMultiSelected.add(node.id);
        // 요청 #120: 지금부터의 다중 선택은 "하나씩 Ctrl/Shift로 누적"한 것이므로, 나중에 컨텍스트
        // 메뉴 키를 누르면 이 중 "마지막으로 클릭한" 항목(Set의 마지막 원소) 위에 열려야 한다.
        dfsLastSelectionOrigin = "click";
      } else {
        dfsMultiSelected.clear();
        dfsSelectedIconId = node.id;
      }
      dfsRenderDesktop();
    });
    icon.addEventListener("dblclick", () => dfsActivate(node));
    icon.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      els.dfIconLayer.focus();
      // 이미 다중 선택에 포함된 아이콘을 우클릭하면 그 선택을 유지하고(실제 탐색기와 동일),
      // 선택 밖의 아이콘을 우클릭하면 그 아이콘 하나로 선택을 좁힌다.
      if (!dfsMultiSelected.has(node.id)) {
        dfsMultiSelected.clear();
        dfsSelectedIconId = node.id;
        dfsRenderDesktop();
      }
      showContextMenu(e.clientX, e.clientY, dfsBuildIconMenuItems(node));
    });
    dfsSetupIconDrag(icon, node);
    els.dfIconLayer.appendChild(icon);
  });
}
let dfsSuppressNextDesktopClick = false;
document.addEventListener("click", () => {
  if (dfsSuppressNextDesktopClick) { dfsSuppressNextDesktopClick = false; return; }
  if (dfsSelectedIconId !== null || dfsMultiSelected.size) {
    dfsSelectedIconId = null;
    dfsMultiSelected.clear();
    dfsRenderDesktop();
  }
});
// 요청 #119/#120: 바탕화면 빈 곳 우클릭 메뉴 - 마우스 우클릭 리스너와 컨텍스트 메뉴 키(아무것도
// 선택 안 된 상태에서 누른 경우의 대체 동작) 양쪽에서 재사용하기 위해 이름 있는 함수로 뺐다.
// 요청 #150: "바탕화면 우클릭 메뉴가 너무 길고 불편하다" - 최상위에는 새 폴더/새로 만들기만
// 남기고, 그 외(붙여넣기·새로고침·속성·탐색기로 열기·아이콘 격자 정렬·환경설정·메뉴 메이커)는
// 전부 "더 보기" 하위 메뉴 하나로 묶는다.
function dfsBuildDesktopBackgroundMenuItems() {
  const items = [...dfsBuildNewItemMenuItems(DFS_DESKTOP_ROOT, () => dfsBroadcastChange())];
  const moreItems = [
    ...dfsBuildEmptyAreaExtraMenuItems(DFS_DESKTOP_ROOT, () => dfsBroadcastChange(), [DESKTOP_TREE_NAME]),
    { label: "탐색기로 열기", action: () => openRealExplorerAt([DESKTOP_TREE_NAME]) },
    // 요청 #110: 자유모드/격자모드 전환(체크 표시로 지금 모드를 보여줌 - 실제 윈도우의 "아이콘을
    // 격자에 맞춤"과 같은 자리).
    { label: (dfsArrangeMode === "grid" ? "✓ " : "") + "아이콘을 격자에 맞춤", action: async () => {
      const next = dfsArrangeMode === "grid" ? "free" : "grid";
      dfsArrangeMode = next;
      dfsSaveArrangeMode(next);
      if (next === "grid") await dfsSnapAllIconsToGrid();
      await dfsRenderDesktop();
    } },
  ];
  // 요청 #137: 실제 윈도우 바탕화면 우클릭 메뉴 맨 끝에 "디스플레이 설정" 같은 항목이 있는 것처럼,
  // 이 앱도 바탕화면 빈 곳 우클릭에서 바로 환경설정을 열 수 있게 한다.
  if (typeof dfsOpenSettingsWindow === "function") {
    moreItems.push({ label: "환경설정", action: () => dfsOpenSettingsWindow() });
  }
  // 요청 #148: "바탕화면 우클릭 -> 메뉴 메이커를 클릭하면 바로 열리고, 마지막으로 보던 탭을
  // 기억해야 한다" - 특정 탭을 강제하지 않고 그냥 연다(dfsOpenMenuMakerInWindow가 opts.initialTab이
  // 없으면 dfMenuMakerLastTab을 대신 쓴다).
  if (typeof dfsOpenMenuMakerInWindow === "function") {
    moreItems.push({ label: "메뉴 메이커", action: () => dfsOpenMenuMakerInWindow() });
  }
  items.push({ label: "더 보기", items: moreItems });
  return items;
}
// 요청 #120: 컨텍스트 메뉴 키를 눌렀을 때 지금 선택된 아이콘(들) 중 메뉴를 열 기준이 되는 요소를
// 고른다 - 단일 선택이면 그것, 다중 선택이면 dfsLastSelectionOrigin에 따라 "마지막 클릭"
// 또는 "우측 상단" 항목을 고른다(위 dfsLastSelectionOrigin 선언부 주석 참고).
function dfsIconElementFor(id) {
  return typeof id === "string"
    ? els.dfIconLayer.querySelector(`[data-special-id="${id}"]`)
    : els.dfIconLayer.querySelector(`[data-id="${id}"]`);
}
function dfsFindContextMenuKeyIcon() {
  const ids = dfsMultiSelected.size ? [...dfsMultiSelected] : (dfsSelectedIconId != null ? [dfsSelectedIconId] : []);
  if (!ids.length) return null;
  if (ids.length === 1) return dfsIconElementFor(ids[0]);
  if (dfsLastSelectionOrigin === "drag") {
    let best = null, bestScore = -Infinity;
    for (const id of ids) {
      const el = dfsIconElementFor(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const score = r.right * 1000 - r.top; // 오른쪽 우선, 동률이면 위쪽 우선
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }
  return dfsIconElementFor(ids[ids.length - 1]);
}
document.querySelector(".desktop").addEventListener("contextmenu", (e) => {
  if (e.target.closest(".df-icon") || e.target.closest(".window")) return;
  e.preventDefault();
  if (!dfsDb) return; // dexie를 못 불러왔으면 바탕화면 기능 자체를 조용히 비활성화
  const items = dfsBuildDesktopBackgroundMenuItems();
  showContextMenu(e.clientX, e.clientY, items);
});
// 진짜 컴퓨터(OS)에서 파일을 드래그해서 바탕화면에 떨어뜨리면 즉시 가져온다 - 요청 #145로
// 텍스트 파일뿐 아니라 그 외 모든 형식(이미지 등)도 이진 그대로 가져올 수 있다(dfsImportOsFile
// 참고). 폴더 아이콘 위에 놓으면 그 폴더 안으로, 빈 바탕화면에 놓으면 바탕화면 자체로 들어간다.
// 어떤 창(.window) 위로 떨어진 경우는 그 창 자신의 drop 핸들러가 처리하므로 여기서는 무시한다.
// text/plain(내용창 grid-item이나 트리 행에서 네이티브 HTML5 드래그로 끌려온 가상 파일시스템 노드
// id)도 같은 자리에서 받는다 - 버그 리포트: "폴더 창에서... 바탕화면으로" 끌어다 놓아도 빼낼 수
// 있어야 함. (바탕화면 아이콘 자체의 드래그는 네이티브 드래그가 아니라 dfsSetupIconDrag의 마우스
// 추적 방식이라 여기를 지나지 않는다 - 그쪽은 mouseup 핸들러의 clamp() 스냅백이 담당.)
document.querySelector(".desktop").addEventListener("dragover", (e) => {
  if (!dfsDb) return;
  if (e.target.closest(".window")) return;
  if (!e.dataTransfer) return;
  const types = Array.from(e.dataTransfer.types || []);
  if (types.indexOf("Files") === -1 && types.indexOf("text/plain") === -1 && types.indexOf("DownloadURL") === -1) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
});
document.querySelector(".desktop").addEventListener("drop", async (e) => {
  if (!dfsDb) return;
  if (e.target.closest(".window")) return;
  if (!e.dataTransfer) return;
  e.preventDefault();
  if (dfDragHasRepoFile(e)) {
    const under = dfsElementUnder(e.clientX, e.clientY);
    let targetId = DFS_DESKTOP_ROOT;
    if (under && under.classList.contains("df-icon") && under.dataset.id) {
      const node = await dfsDb.nodes.get(Number(under.dataset.id));
      if (node && node.type === "folder") targetId = node.id;
    }
    await dfHandleRepoFileDrop(e, targetId, () => dfsRenderDesktop());
    return;
  }
  if (e.dataTransfer.files && e.dataTransfer.files.length) {
    const under = dfsElementUnder(e.clientX, e.clientY);
    let targetId = DFS_DESKTOP_ROOT;
    if (under && under.classList.contains("df-icon") && under.dataset.id) {
      const node = await dfsDb.nodes.get(Number(under.dataset.id));
      if (node && node.type === "folder") targetId = node.id;
    }
    await dfsImportOsFileList(targetId, e.dataTransfer.files, () => dfsRenderDesktop());
    return;
  }
  const draggedId = Number(e.dataTransfer.getData("text/plain"));
  if (!draggedId) return;
  const srcNode = await dfsDb.nodes.get(draggedId);
  if (!srcNode) return;
  const under = dfsElementUnder(e.clientX, e.clientY);
  // 요청 #113(a): 휴지통 아이콘 위로 놓으면(트리/내용창에서 네이티브 드래그로 끌려온 항목 포함,
  // 예: 복원 중이던 휴지통 항목을 다시 휴지통 위로 놓는 경우까지) 그대로 삭제한다.
  if (dfsIsRecycleBinIcon(under)) {
    if (srcNode.parentId === DFS_RECYCLEBIN_ROOT) return;
    await dfsDelete(srcNode);
    showToast(`"${srcNode.name}"을(를) 휴지통으로 옮겼습니다.`, { sound: "delete_to_recyclebin" });
    await dfsBroadcastChange();
    return;
  }
  // 요청 #113(d): 휴지통 항목을 드래그해서 "바탕화면의 다른 폴더" 아이콘 위에 정확히 놓으면 그
  // 폴더 안으로 복원되고, 그 외 빈 바탕화면이면 바탕화면 루트로 옮긴다(휴지통 항목이 아닌 일반
  // 항목의 드래그도 이 경로를 그대로 타므로 동일하게 개선된다 - 예전엔 항상 무조건 루트로만 갔음).
  let targetId = DFS_DESKTOP_ROOT, targetLabel = "바탕 화면";
  if (under && under.classList.contains("df-icon") && under.dataset.id) {
    const targetNode = await dfsDb.nodes.get(Number(under.dataset.id));
    if (targetNode && targetNode.type === "folder" && targetNode.id !== srcNode.id) {
      targetId = targetNode.id;
      targetLabel = `"${targetNode.name}" 폴더`;
    }
  }
  if (srcNode.parentId === targetId) return;
  const ok = await dfsMove(srcNode, targetId);
  if (ok) showToast(`"${srcNode.name}"을(를) ${targetLabel}으로 옮겼습니다.`, { sound: "move_or_copy" });
  await dfsBroadcastChange();
});

/* ---------------- 바탕화면 빈 공간 드래그 = 러버밴드(고무줄) 다중 선택 ----------------
   내용창(#contentPane)의 다중 선택 드래그와 같은 개념을 바탕화면 아이콘에도 그대로 적용한다.
   아이콘이 없는 빈 곳을 누른 채 끌면 그 사각형과 겹치는 아이콘들이 모두 선택된다. 문턱값(3px)
   이상 움직여야 진짜 드래그로 인정하고, 그 전에 손을 떼면 그냥 "빈 곳 클릭"으로 취급해 기존
   click 리스너가 선택 해제를 담당한다(아래 dfsSuppressNextDesktopClick 참고 - 드래그로 막
   선택을 확정한 순간 뒤따라오는 click 이벤트가 그 선택을 바로 지워버리지 않도록 한 번 막는다). */
let dfsBoxSelectStart = null;
document.querySelector(".desktop").addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!dfsDb) return;
  if (e.target.closest(".df-icon") || e.target.closest(".window") || e.target.closest(".taskbar") || e.target.closest(".start-menu")) return;
  // mousedown의 기본 동작(브라우저가 알아서 포커스를 다른 곳으로 옮기거나 텍스트 선택을 시작하는 것)이
  // 아래 focus() 호출을 뒤늦게 덮어써버리는 걸 막는다 - preventDefault를 안 하면 이 핸들러가 먼저
  // dfIconLayer로 포커스를 줘도 브라우저의 기본 포커싱 동작이 이어서 실행되며 도로 body로 밀려난다.
  e.preventDefault();
  els.dfIconLayer.focus(); // 빈 바탕화면을 눌러도(드래그든 그냥 클릭이든) 키보드 포커스는 바탕화면으로
  dfsBoxSelectStart = { x: e.clientX, y: e.clientY };
});
window.addEventListener("mousemove", (e) => {
  if (!dfsBoxSelectStart) return;
  let box = document.getElementById("dfSelectBox");
  const dx = e.clientX - dfsBoxSelectStart.x, dy = e.clientY - dfsBoxSelectStart.y;
  if (!box) {
    if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return; // 문턱값 전엔 박스를 만들지 않는다(단순 클릭과 구분)
    box = document.createElement("div");
    box.className = "df-select-box";
    box.id = "dfSelectBox";
    document.body.appendChild(box);
  }
  const left = Math.min(dfsBoxSelectStart.x, e.clientX), top = Math.min(dfsBoxSelectStart.y, e.clientY);
  const w = Math.abs(dx), h = Math.abs(dy);
  box.style.left = left + "px"; box.style.top = top + "px";
  box.style.width = w + "px"; box.style.height = h + "px";
  const rect = { left, top, right: left + w, bottom: top + h };
  els.dfIconLayer.querySelectorAll(".df-icon").forEach(el => {
    const r = el.getBoundingClientRect();
    const intersects = r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
    el.classList.toggle("selected", intersects); // 최종 상태는 mouseup에서 dfsMultiSelected로 확정
  });
});
window.addEventListener("mouseup", () => {
  if (!dfsBoxSelectStart) return;
  dfsBoxSelectStart = null;
  const box = document.getElementById("dfSelectBox");
  if (!box) return; // 문턱값을 못 넘겼으면 = 그냥 빈 곳 클릭, 뒤이은 click 리스너에 맡긴다
  box.remove();
  const ids = [];
  els.dfIconLayer.querySelectorAll(".df-icon.selected").forEach(el => {
    if (el.dataset.specialId) ids.push(el.dataset.specialId);
    else ids.push(Number(el.dataset.id));
  });
  dfsSelectedIconId = null;
  dfsMultiSelected = new Set(ids);
  // 요청 #120: 지금부터의 다중 선택은 러버밴드로 "한 번에" 잡은 것이다 - 컨텍스트 메뉴 키를
  // 누르면 이 중 가장 오른쪽 위(우측 상단) 항목 위에 열려야 한다(사용자가 밝힌 대로 정확한 실제
  // 규칙은 불확실하지만, "동시에 잡히면 우측 상단 기준"이라는 사용자 본인의 추정을 따른다).
  dfsLastSelectionOrigin = "drag";
  dfsSuppressNextDesktopClick = true;
  dfsRenderDesktop();
});

function dfsSetupIconDrag(iconEl, node) {
  let dragging = false, moved = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
  // 요청 #138: 지금 끄는 이 아이콘이 다중 선택(2개 이상)에 포함돼 있으면, 선택된 나머지 아이콘도
  // 전부 같은 델타로 함께 움직여야 한다(대각선 등 어떤 배치든 형태를 유지한 채로). dragGroup은
  // [{el, id, isSpecial, origLeft, origTop}] - 특수 아이콘(저장소 루트/휴지통)도 선택에 끼어
  // 있으면 화면상으로는 같이 움직이지만, 옮기거나 지우는 실제 대상이 될 수는 없으므로 드롭 처리
  // 쪽에서는 실제 노드(숫자 id)만 걸러 쓴다.
  let dragGroup = null;
  // 아이콘이 드래그로 화면 맨 아래 작업표시줄 밑을 뚫고 내려가거나 화면 오른쪽 밖으로 나가지
  // 않도록, 아이콘층(.df-icon-layer, 이미 작업표시줄 높이만큼 bottom을 뺀 영역) 자기 자신의
  // 크기 안으로만 좌표를 묶어둔다.
  function clamp(el, left, top) {
    const maxLeft = Math.max(0, els.dfIconLayer.clientWidth - el.offsetWidth);
    const maxTop = Math.max(0, els.dfIconLayer.clientHeight - el.offsetHeight);
    return { left: Math.max(0, Math.min(left, maxLeft)), top: Math.max(0, Math.min(top, maxTop)) };
  }
  iconEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origLeft = parseFloat(iconEl.style.left) || 0;
    origTop = parseFloat(iconEl.style.top) || 0;
    dragGroup = (dfsMultiSelected.size > 1 && dfsMultiSelected.has(node.id))
      ? [...dfsMultiSelected].map(id => {
          const el = dfsIconElementFor(id);
          if (!el || el === iconEl) return null;
          return { el, id, isSpecial: typeof id === "string", origLeft: parseFloat(el.style.left) || 0, origTop: parseFloat(el.style.top) || 0 };
        }).filter(Boolean)
      : null;
    e.stopPropagation();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    if (!moved) return;
    const pos = clamp(iconEl, origLeft + dx, origTop + dy);
    iconEl.style.left = pos.left + "px";
    iconEl.style.top = pos.top + "px";
    iconEl.style.zIndex = 5;
    if (dragGroup) {
      // 기준 아이콘(iconEl) 자신에게 실제로 적용된(클램프된) 델타를 그대로 나머지에도 적용해서
      // 서로의 상대적 위치(형태)가 어긋나지 않게 한다. 각자 화면 밖으로 안 나가게 클램프는 개별
      // 적용하지만, 델타 자체는 항상 기준 아이콘 것 하나로 통일한다.
      const appliedDx = pos.left - origLeft, appliedDy = pos.top - origTop;
      dragGroup.forEach(g => {
        const gp = clamp(g.el, g.origLeft + appliedDx, g.origTop + appliedDy);
        g.el.style.left = gp.left + "px";
        g.el.style.top = gp.top + "px";
        g.el.style.zIndex = 5;
      });
    }
    document.querySelectorAll(".df-drop-target").forEach(el => el.classList.remove("df-drop-target"));
    const under = dfsElementUnder(e.clientX, e.clientY, iconEl);
    if (under && (under.dataset.id || under.dataset.dropFolderKey !== undefined)) under.classList.add("df-drop-target");
  });
  window.addEventListener("mouseup", async (e) => {
    if (!dragging) return;
    dragging = false;
    document.querySelectorAll(".df-drop-target").forEach(el => el.classList.remove("df-drop-target"));
    iconEl.style.zIndex = "";
    const group = dragGroup;
    dragGroup = null;
    if (group) group.forEach(g => { g.el.style.zIndex = ""; });
    if (!moved) return;
    // 요청 #154: 실제로 움직인 드래그였다 - 마우스를 뗀 자리가 여전히 이 아이콘 위라 브라우저가
    // 뒤이어 click 이벤트를 하나 더 보내는데, 그걸 그냥 두면 (특히 다중 선택을 끌어서 옮겼을 때)
    // 이 아이콘 하나로 선택이 좁혀져 버린다(버그 리포트) - 그 한 번의 click만 무시하게 표시해둔다.
    dfsSuppressNextDesktopClick = true;
    // 그룹(다중 선택) 드래그면 실제 노드(숫자 id, 특수 아이콘 제외)들을 한꺼번에 옮기거나 지운다.
    // 단일 아이콘 드래그면 이 배열이 그 아이콘 하나뿐이라 기존 동작과 완전히 같다.
    const realIds = group ? group.filter(g => !g.isSpecial).map(g => g.id) : [];
    if (!group || !realIds.includes(node.id)) realIds.unshift(node.id); // node.id는 항상 실제 노드(기준 아이콘)
    // under는 바탕화면 아이콘(.df-icon)뿐 아니라 통합 탐색기 창(#win)의 내용창 칸(.grid-item -
    // content-pane.js가 desktopMode일 때 dataset.id를 붙여둔다)도 찾는다. 그 덕분에 바탕화면
    // 아이콘을 그 창의 특정 "폴더 칸" 위에 정확히 떨어뜨리면 그 폴더 안으로 들어간다.
    const under = dfsElementUnder(e.clientX, e.clientY, iconEl);
    // 요청 #113/#138: 바탕화면 아이콘(들)을 마우스로 끌어 휴지통 특수 아이콘 위에 놓으면 삭제(휴지통 이동).
    if (dfsIsRecycleBinIcon(under)) {
      await dfsMoveManyToRecycleBin(realIds);
      return;
    }
    if (under && under.dataset.id) {
      const targetId = Number(under.dataset.id);
      const target = await dfsDb.nodes.get(targetId);
      if (target && target.type === "folder" && !realIds.includes(target.id)) {
        await dfsMoveManyToFolder(realIds, target.id, target.name);
        return;
      }
    }
    // 버그 리포트: "바탕화면에서 폴더 탐색기 안쪽으로 드래그 해서... 폴더 창에서 트리로" - 왼쪽
    // 트리(navPane)의 바탕화면 루트 행이나 가상 폴더 행 위에 놓은 경우(tree-pane.js의
    // attachTreeDropTarget이 붙여둔 dataset.dropFolderKey로 대상 폴더를 찾는다).
    if (under && under.dataset.dropFolderKey !== undefined) {
      const targetPathArr = under.dataset.dropFolderKey === "" ? [] : under.dataset.dropFolderKey.split("/");
      const targetId = await dfsResolvePathToFolderId(targetPathArr);
      if (targetId != null && !realIds.includes(targetId)) {
        await dfsMoveManyToFolder(realIds, targetId, null);
        return;
      }
    }
    // 버그 리포트: "바탕화면에서 탐색기 창 안으로 넣을 수도 없다" - 특정 폴더 칸을 정확히 맞추지
    // 못했더라도(빈 칸/파일 칸 위, 혹은 그냥 내용창의 빈 공간), 지금 열려있는 탐색기 창이 바탕화면
    // 폴더를 보여주고 있는 채로 그 창 위에 놓았다면 "지금 보고 있는 그 폴더" 안으로 옮긴다(실제
    // 윈도우 탐색기에 파일을 끌어다 놓을 때와 동일 - 꼭 안의 하위 폴더 칸에 정확히 맞힐 필요는 없음).
    if (!els.win.classList.contains("closed") && !els.win.classList.contains("minimized") && isDfsPath(currentPath)) {
      const overContentPane = document.elementsFromPoint(e.clientX, e.clientY).some(el => el.closest && el.closest("#contentPane"));
      if (overContentPane) {
        // 요청 #113/#138: 지금 열려있는 창이 "휴지통"을 보여주고 있는 채로 그 창 위에 놓으면 삭제(휴지통 이동).
        if (isRecycleBinPath(currentPath)) {
          await dfsMoveManyToRecycleBin(realIds);
          return;
        }
        const folderId = await dfsResolvePathToFolderId(currentPath);
        if (folderId != null && !realIds.includes(folderId)) {
          await dfsMoveManyToFolder(realIds, folderId, null);
          return;
        }
      }
    }
    // 빈 곳에 놓음: 유효한 이동/삭제 대상이 아니었으므로, 그룹 전체(특수 아이콘 포함)의 위치를
    // 그대로 또는 격자에 맞춰 저장한다 - 방금 화면에서 옮긴 상대적 형태를 그대로 유지한다.
    if (group) {
      for (const g of [...group, { el: iconEl, id: node.id, isSpecial: false, origLeft, origTop }]) {
        const pos = clamp(g.el, parseFloat(g.el.style.left) || 0, parseFloat(g.el.style.top) || 0);
        if (dfsArrangeMode === "grid") await dfsGridSnapDrop(g.id, g.isSpecial, pos.left, pos.top, g.origLeft, g.origTop);
        else await dfsSaveIconPosition(g.id, g.isSpecial, pos.left, pos.top);
      }
      await dfsRenderDesktop();
      return;
    }
    const pos = clamp(iconEl, parseFloat(iconEl.style.left) || 0, parseFloat(iconEl.style.top) || 0);
    // 요청 #110: 격자모드면 자유롭게 놓은 픽셀 위치를 그대로 쓰지 않고 가장 가까운 격자 칸으로
    // 스냅하며, 그 칸에 이미 다른 아이콘이 있으면 자리를 맞바꾼다.
    if (dfsArrangeMode === "grid") {
      await dfsGridSnapDrop(node.id, false, pos.left, pos.top, origLeft, origTop);
      await dfsRenderDesktop();
      return;
    }
    await dfsDb.nodes.update(node.id, { x: pos.left, y: pos.top });
  });
}
function dfsElementUnder(clientX, clientY, excludeEl) {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    // .tree-row/.nav-root도 찾는다 - 바탕화면 아이콘을 마우스로 끌어다 왼쪽 트리(navPane) 위에
    // 놓는 것도 지원해야 하기 때문(버그 리포트: "폴더 창에서 트리로 혹은 바탕화면으로"). 트리 행은
    // tree-pane.js의 attachTreeDropTarget이 dataset.dropFolderKey를 붙여둔 것만 실제 드롭을 받는다
    // (저장소의 진짜 폴더처럼 읽기 전용인 행에는 애초에 그 속성이 없다).
    const iconEl = el.closest(".df-icon, .grid-item, .tree-row, .nav-root");
    if (iconEl && iconEl !== excludeEl) return iconEl;
  }
  return null;
}

/* ---------------- 우클릭 메뉴 빌더 (데스크탑 아이콘 / 창 안 그리드 아이템 공용) ---------------- */
function dfsBuildIconMenuItems(node, opts = {}) {
  const refresh = opts.refresh || dfsBroadcastChange;
  const items = [];
  if (node.type === "folder") {
    items.push({ label: "열기", action: () => dfsActivate(node) });
    items.push({ label: "다운로드", action: () => dfsDownloadFolderChoice(node) });
  } else if (node.type === "shortcut") {
    items.push({ label: "열기", action: () => dfsActivate(node) });
    // 요청 #153: 통합 탐색기 창(dfsDesktopFileMenuItems)에만 있던 편집/다운로드(.sc)를 실제
    // 데스크탑 아이콘 우클릭 메뉴에도 똑같이 붙인다 - targetId 방식이든 url 방식이든 이제 둘 다
    // 가능하다(dfsEditShortcut/dfsDownloadShortcutFile이 알아서 처리).
    items.push({ label: "편집", action: () => dfsEditShortcut(node, refresh) });
    items.push({ label: "다운로드(.sc)", action: () => dfsDownloadShortcutFile(node) });
  } else {
    // 요청 #145: 이진 파일은 에디터로 열 수 없다 - 이미지만 "미리보기(새 탭)"를 대신 보여주고,
    // 그 외 이진 파일은 아래 다운로드 항목들만으로 충분하다(더블클릭도 다운로드로 동작).
    if (node.binary) {
      if ((node.mime || "").indexOf("image/") === 0) items.push({ label: "미리보기(새 탭)", action: () => dfsActivate(node) });
    } else {
      items.push({ label: "에디터로 열기", action: () => dfsActivate(node) });
    }
    // 실제 탐색기 파일 메뉴와 순서를 맞춘다: 다운로드(웹훅으로 로컬 헬퍼가 저장) 다음
    // 브라우저에서 다운로드(강제 blob 다운로드).
    items.push({ label: "다운로드", action: () => localHelperSaveContent(node.name, node.binary ? node.blob : (node.content || "")) });
    items.push({ label: "브라우저에서 다운로드", action: () => dfsDownloadVirtualFile(node) });
  }
  items.push({ label: "이름 변경", action: () => dfsPromptRename(node, refresh) });
  items.push({ label: "복사", action: () => { dfsClipboard = { id: node.id, mode: "copy" }; showToast(`"${node.name}"을(를) 복사했습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); } });
  items.push({ label: "잘라내기", action: () => { dfsClipboard = { id: node.id, mode: "cut" }; showToast(`"${node.name}"을(를) 잘라냈습니다. 붙여넣을 위치에서 붙여넣기를 선택하세요.`, { sound: "copy_to_clipboard" }); } });
  if (node.type !== "shortcut") {
    items.push({ label: "바로가기 만들기", action: async () => { await dfsCreateShortcut(node); await refresh(); } });
  }
  items.push({ label: "삭제", action: async () => {
    const ok = await showConfirmDialog(`"${node.name}"을(를) 삭제할까요?${node.type === "folder" ? " (안에 있는 것도 모두 삭제됩니다)" : ""}`);
    if (!ok) return;
    await dfsDelete(node);
    await refresh();
  } });
  // 요청 #148: 실제 데스크탑 아이콘 레이어의 폴더/파일 우클릭에도 메뉴 메이커 "아이콘 설정"을
  // 붙인다(지금까지 이 메뉴에는 없었다 - 통합 탐색기 창의 dfsDesktopFileMenuItems/
  // dfsDesktopFolderMenuItems에만 있었음). 바로가기는 자신의 icon 필드로 지정하므로 제외.
  if (node.type !== "shortcut" && typeof dfsPushIconSettingsMenuItem === "function") {
    const ext = node.type === "file" ? fileExtOf(node.name) : "";
    dfsPushIconSettingsMenuItem(items, ext ? { type: "ext", key: ext } : null);
  }
  return items;
}
// 요청 #140: pathArr은 "속성" 메뉴가 위치/이름을 표시하는 데 필요해서 추가된 선택 인자다(생략하면
// 바탕화면 최상위로 취급) - dfsBuildDesktopBackgroundMenuItems(바탕화면 자체)와 content-pane.js의
// contentPaneOpenBackgroundMenu(바탕화면 안의 가상 폴더) 양쪽에서 이미 알고 있는 currentPath를
// 그대로 넘겨준다.
// 요청 #150: 빈 곳 우클릭 메뉴가 너무 길어졌다는 지적으로, "새 폴더"(가장 자주 씀)만 최상위에
// 남기고 나머지 새 항목 종류는 실제 윈도우처럼 "새로 만들기" 하위 메뉴 하나로 묶는다.
function dfsBuildNewItemMenuItems(parentId, refresh) {
  return [
    { label: "새 폴더", action: async () => { await dfsCreateFolder(parentId); await refresh(); } },
    { label: "새로 만들기", items: [
      { label: "텍스트 문서", action: async () => { await dfsCreateFile(parentId, "txt"); await refresh(); } },
      { label: "Markdown 문서", action: async () => { await dfsCreateFile(parentId, "md"); await refresh(); } },
      { label: "HTML 문서", action: async () => { await dfsCreateFile(parentId, "html"); await refresh(); } },
      // 요청 #133: 기존 항목을 가리키는 "바로가기 만들기"(dfsCreateShortcut)와 달리, 여기서는 처음부터
      // 이름/주소(URL)/아이콘을 직접 입력해서 새 바로가기를 만든다(showShortcutDialog).
      { label: "바로가기", action: async () => {
        const info = await showShortcutDialog();
        if (!info) return;
        await dfsCreateUrlShortcut(parentId, info);
        await refresh();
      } },
    ] },
  ];
}
// 새 항목 만들기 이외의 나머지(붙여넣기/새로고침/속성) - 요청 #150으로 바탕화면 배경 메뉴에서는
// 이것도 "더 보기" 하위 메뉴로 옮겨지지만(dfsBuildDesktopBackgroundMenuItems 참고), 탐색기 안
// 가상 폴더의 빈 곳 우클릭(content-pane.js)에서는 여전히 dfsBuildEmptyAreaMenuItems를 통해
// 예전처럼 평평하게 보여준다(그쪽은 항목 수가 적어 굳이 더 묶을 필요가 없음).
function dfsBuildEmptyAreaExtraMenuItems(parentId, refresh, pathArr) {
  const items = [];
  if (dfsClipboard) items.push({ label: "붙여넣기", action: async () => { await dfsPasteInto(parentId); await refresh(); } });
  items.push({ label: "새로고침", action: () => refresh() });
  items.push({ label: "속성", action: () => dfsShowDesktopFolderProperties(parentId, pathArr && pathArr.length ? pathArr : [DESKTOP_TREE_NAME]) });
  return items;
}
function dfsBuildEmptyAreaMenuItems(parentId, refresh, pathArr) {
  return [...dfsBuildNewItemMenuItems(parentId, refresh), ...dfsBuildEmptyAreaExtraMenuItems(parentId, refresh, pathArr)];
}
async function dfsPromptRename(node, refresh) {
  const next = await showPromptDialog("새 이름", node.name);
  if (next == null) return;
  const ok = await dfsRename(node, next);
  if (ok) refresh();
}
/* ---------------- 폴더 통째로 다운로드(바탕화면 가상 폴더) ----------------
   실제 저장소 폴더와 달리 서버에 URL이 없는 순수 텍스트 파일들이므로(dexie 안 content), 웹훅을
   거칠 필요 없이 그냥 zip으로 묶어 blob 다운로드한다(사용자 지시: "바탕 화면 폴더도 blob로 주면 됨"). */
async function dfsCollectFolderFiles(node, prefix, out) {
  const kids = await dfsChildren(node.id);
  for (const kid of kids) {
    if (kid.type === "folder") {
      await dfsCollectFolderFiles(kid, prefix + kid.name + "/", out);
    } else if (kid.type === "file") {
      // 요청 #145: 이진 파일은 Blob 그대로 넘긴다 - JSZip의 .file()도 Blob을 그대로 받아들인다.
      out.push({ path: prefix + kid.name, content: (kid.binary && kid.blob) ? kid.blob : (kid.content || "") });
    }
    // 바로가기(shortcut)는 가리키는 대상이 폴더 안/밖 어디에도 있을 수 있어 애매하므로 제외한다.
  }
}
// dfsCollectFolderFiles와 같은 재귀이지만, 헬퍼로 다운로드할 때는 실제 저장소 폴더의
// downloadFolderRecursive(local-helper.js)와 똑같이 안이 빈 하위 폴더도 그대로 재현해야 하므로
// 폴더 목록도 같이 모은다(zip 경로는 JSZip이 파일 경로만으로 폴더를 자동으로 만들어주므로
// folders가 필요 없어 기존 dfsCollectFolderFiles를 그대로 둔다).
async function dfsCollectFolderTree(node, prefix, files, folders) {
  const kids = await dfsChildren(node.id);
  for (const kid of kids) {
    if (kid.type === "folder") {
      const rel = prefix + kid.name;
      folders.push(rel);
      await dfsCollectFolderTree(kid, rel + "/", files, folders);
    } else if (kid.type === "file") {
      // 요청 #145: 이진 파일은 Blob 그대로 - fetch의 body로도 Blob을 그대로 넘길 수 있다.
      files.push({ path: prefix + kid.name, content: (kid.binary && kid.blob) ? kid.blob : (kid.content || "") });
    }
    // 바로가기(shortcut)는 dfsCollectFolderFiles와 같은 이유로 제외한다.
  }
}
/* ---------------- 폴더 다운로드 방법 선택: zip 또는 로컬 헬퍼 ----------------
   사용자 지시: "바탕 화면은 방법 두 개 넣기. zip 혹은 헬퍼(다운로드는 하나지만 받을때 묻기)"
   - 우클릭/드래그 메뉴에는 "다운로드" 항목이 하나뿐이고, 누르는 순간 방식을 고르게 한다. */
async function dfsDownloadFolderChoice(node) {
  const choice = await showChoiceDialog(
    `"${node.name}" 폴더를 어떻게 받으시겠습니까?`,
    [
      { label: "Zip으로 받기", value: "zip" },
      { label: "헬퍼로 받기(폴더 그대로 저장)", value: "helper" }
    ]
  );
  if (choice === "zip") await dfsDownloadFolderRecursive(node);
  else if (choice === "helper") await dfsDownloadFolderViaHelper(node);
}
async function dfsDownloadFolderRecursive(node) {
  showToast(`"${node.name}" 폴더 압축 준비 중...`, { sound: "download_start" });
  let JSZip;
  try {
    JSZip = await ensureJSZip();
  } catch (e) {
    showToast(`압축 기능을 불러오지 못했습니다: ${e.message}`, { kind: "warn", sound: "download_error" });
    return;
  }
  const files = [];
  await dfsCollectFolderFiles(node, "", files);
  const zip = new JSZip();
  const root = zip.folder(node.name);
  files.forEach(f => root.file(f.path, f.content));
  let blob;
  try {
    blob = await zip.generateAsync({ type: "blob" });
  } catch (e) {
    showToast(`압축 중 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = node.name + ".zip";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  showToast(`"${node.name}" 폴더를 zip으로 다운로드했습니다.`, { sound: "download_complete" });
}
async function dfsDownloadVirtualFile(node) {
  // 요청 #145: 이진 파일은 저장해둔 Blob을 그대로 쓴다(문자열로 다시 만들면 깨짐).
  const blob = (node.binary && node.blob) ? node.blob : new Blob([node.content || ""], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = node.name;
  a.click();
  URL.revokeObjectURL(a.href);
}
// 요청 #145: 이진 파일(binary:true) 더블클릭 - 에디터로 열 수 없으므로, 이미지는 새 탭에서 바로
// 미리보고(브라우저가 img를 알아서 렌더링), 그 외에는 그냥 다운로드한다. blob URL은 새 탭이 열려
// 있는 동안만 유효하면 되므로(에디터의 blob URL처럼 새로고침 뒤까지 남길 필요 없음) 넉넉히
// 시간을 두고 회수한다.
async function dfsActivateBinaryFile(node) {
  if (!node.blob) { showToast(`"${node.name}" 내용을 찾을 수 없습니다.`, { kind: "warn", sound: "error_generic" }); return; }
  const url = URL.createObjectURL(node.blob);
  if ((node.mime || "").indexOf("image/") === 0) {
    dfOpenNewTab(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  const a = document.createElement("a");
  a.href = url; a.download = node.name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------------- 활성화(더블클릭) ----------------
   에디터는 더 이상 탐색기 창 내부에서 그려지지 않는다 - 파일을 열면 앱 내 창(요청 #135,
   dfsOpenFileInWindow)으로 뜬다. */
async function dfsActivate(node) {
  if (node.type === "folder") {
    // 이제 별도 팝업 창이 아니라, 하나로 통합된 "진짜" 탐색기 창(#win)에서 이 폴더의 경로
    // (["바탕 화면"|"휴지통", ...조상들..., 이 폴더])로 이동시킨다. 요청 #113: 이 폴더가
    // 휴지통 안에 있을 수도 있으므로(폴더째 삭제된 경우) dfsBuildPath가 어느 뿌리인지도 알려준다.
    const { chain, rootName } = await dfsBuildPath(node.id);
    openRealExplorerAt([rootName, ...chain.map(seg => seg.name)]);
    return;
  }
  if (node.type === "shortcut") {
    // 요청 #133: targetId가 있으면(기존 방식) 그 내부 항목을 그대로 연다. 없으면 사용자가 직접
    // 입력한 주소(url)를 여는 바로가기이므로, 메뉴 항목/트레이 아이콘 등과 같은 방식으로 새 탭에서
    // 연다(dfOpenNewTab이 전체화면을 먼저 풀어주는 것까지 동일하게 재사용).
    if (!node.targetId) {
      if (!node.url) { showToast("바로가기에 주소가 없습니다.", { kind: "warn", sound: "error_generic" }); return; }
      openShortcutUrl(node.url, node.popup);
      return;
    }
    const target = await dfsDb.nodes.get(node.targetId);
    if (!target) { showToast("바로가기 대상을 찾을 수 없습니다(삭제된 항목).", { kind: "warn", sound: "error_generic" }); return; }
    return dfsActivate(target);
  }
  // 요청 #145: 이진 파일(binary:true)은 에디터로 열 수 없으므로 먼저 걸러서 dfsActivateBinaryFile로.
  if (node.binary) { return dfsActivateBinaryFile(node); }
  dfsOpenFileInWindow(node);
}

// 요청 #162: 바탕화면(가상 파일시스템)에 저장된 HTML 파일을 진짜 웹페이지처럼(스크립트도 실행되게)
// 새 탭에서 보고 싶다는 요청 - 에디터의 미리보기(요청 #156으로 innerHTML 주입 방식으로 바뀜, 스크립트
// 미실행)와는 다른 별도 기능이다. blob: URL로 새 탭을 연다 - URL.revokeObjectURL을 부르지 않고 이
// 메인 탭(만든 쪽 문서)이 계속 살아있는 한 브라우저가 그 blob URL을 계속 유효하게 유지해주므로, 새로
// 연 탭에서 새로고침(F5)해도 깨지지 않는다(버그 리포트 - 예전에 다른 방식에서 새로고침하면 깨졌음).
// 같은 노드를 여러 번 열 때 매번 새 URL을 만들면 blob이 계속 쌓이므로(메모리 누수), 노드 id별로
// URL을 캐시해두고 내용이 그대로면 재사용하고, 내용이 바뀌었으면(에디터에서 저장 등) 그때만 이전
// 것을 해제(revoke)하고 새로 만든다.
const dfsHtmlViewerUrlCache = new Map(); // nodeId -> { content, url }
function dfsOpenHtmlAsViewerTab(node) {
  const content = node.content || "";
  const cached = dfsHtmlViewerUrlCache.get(node.id);
  let url;
  if (cached && cached.content === content) {
    url = cached.url;
  } else {
    if (cached) { try { URL.revokeObjectURL(cached.url); } catch (e) {} }
    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    url = URL.createObjectURL(blob);
    dfsHtmlViewerUrlCache.set(node.id, { content, url });
  }
  // 주의: blob: URL은 "noopener"를 주고 새 탭을 열면 일부 브라우저(크롬 계열)에서 새 탭이 다른
  // 프로세스로 뜨면서 이 탭이 만든 blob을 못 찾아 로드에 실패하는 경우가 있다(알려진 문제) - 그래서
  // 여기서는 다른 새 탭 열기들과 달리 noopener/noreferrer를 주지 않는다(외부 사이트가 아니라 우리가
  // 직접 만든 내용이라 window.opener 보안 문제도 없음).
  dfOpenNewTab(url, "_blank");
}

/* ============================================================================
   바탕화면 경로 유틸
   ----------------------------------------------------------------------------
   예전에는 바탕화면 폴더를 열면 "진짜" 탐색기(#win)와 별개로 여러 개 동시에 뜰 수 있는 팝업
   창(dfsOpenExplorerWindow)을 새로 만들었지만, 이제는 완전히 하나의 창으로 통합됐다(사용자
   지시) - 바탕화면 폴더를 열면 그냥 #win이 ["바탕화면", ...] 경로로 이동한다(openRealExplorerAt
   / dfsActivate 참고). 아래 dfsBuildPath만 그 경로를 계산하기 위해 남아 있다.
================================================================================= */
async function dfsBuildPath(folderId) {
  // 뿌리(바탕화면 또는 휴지통)부터 folderId까지 [{id,name}, ...] (뿌리 자체는 포함 안 함,
  // folderId가 뿌리 자신이면 빈 배열) - 요청 #113: 휴지통 안의 폴더(통째로 삭제된 폴더)도
  // 같은 방식으로 다뤄야 하므로, 어느 뿌리에서 멈췄는지도 같이 돌려준다.
  const chain = [];
  let cur = folderId;
  while (cur !== DFS_DESKTOP_ROOT && cur !== DFS_RECYCLEBIN_ROOT && cur != null) {
    const node = await dfsDb.nodes.get(cur);
    if (!node) break;
    chain.unshift({ id: node.id, name: node.name });
    cur = node.parentId;
  }
  const rootName = cur === DFS_RECYCLEBIN_ROOT ? RECYCLEBIN_TREE_NAME : DESKTOP_TREE_NAME;
  return { chain, rootName };
}

/* ---------------- 바탕화면 키보드: F2 이름 변경 / Delete 삭제 ----------------
   keyboard-and-activate.js의 triggerF2Rename()/triggerDeleteSelected()가 document.activeElement
   === els.dfIconLayer일 때 이 두 함수로 위임한다. 우클릭 메뉴의 "이름 변경"/"삭제"와 완전히 같은
   동작(dfsPromptRename/dfsDelete)을 재사용해서 두 경로(마우스/키보드)의 결과가 항상 같게 한다. */
async function dfsRenameSelectedIcon() {
  // F2는 실제 탐색기와 마찬가지로 정확히 하나가 선택돼 있을 때만 동작한다.
  const id = dfsSelectedIconId !== null ? dfsSelectedIconId : (dfsMultiSelected.size === 1 ? [...dfsMultiSelected][0] : null);
  // 저장소 루트/휴지통 특수 아이콘(문자열 id - dfsRenderSpecialIcon 참고)은 이름을 바꿀 수 없다 -
  // dexie 기본 키가 숫자라서 문자열 id로 get()을 부르면 안 되므로 여기서 먼저 걸러낸다.
  if (typeof id !== "number") return;
  const node = await dfsDb.nodes.get(id);
  if (node) await dfsPromptRename(node, () => dfsBroadcastChange());
}
async function dfsDeleteSelectedIcons(permanent) {
  // Delete는 여러 개 선택돼 있어도 확인 대화상자 하나로 한꺼번에 지운다(다중 선택된 상태에서
  // 하나씩 확인창이 겹쳐 뜨는 걸 피하기 위함). 특수 아이콘(문자열 id)은 지울 수 없으므로 제외한다.
  const ids = (dfsMultiSelected.size ? [...dfsMultiSelected] : (dfsSelectedIconId !== null ? [dfsSelectedIconId] : []))
    .filter(id => typeof id === "number");
  if (!ids.length) return;
  const nodes = (await Promise.all(ids.map(id => dfsDb.nodes.get(id)))).filter(Boolean);
  if (!nodes.length) return;
  // 요청 #159: Shift+Delete로 눌렀으면(permanent) 휴지통을 거치지 않는다는 걸 확인창 문구로 확실히 알린다.
  const msg = permanent
    ? (nodes.length === 1
        ? `"${nodes[0].name}"을(를) 완전히 삭제할까요? (휴지통을 거치지 않고 바로 삭제되며 되돌릴 수 없습니다)`
        : `선택한 ${nodes.length}개 항목을 완전히 삭제할까요? (휴지통을 거치지 않고 바로 삭제되며 되돌릴 수 없습니다)`)
    : (nodes.length === 1
        ? `"${nodes[0].name}"을(를) 삭제할까요?${nodes[0].type === "folder" ? " (안에 있는 것도 모두 삭제됩니다)" : ""}`
        : `선택한 ${nodes.length}개 항목을 삭제할까요? (폴더 안의 내용도 모두 삭제됩니다)`);
  const ok = await showConfirmDialog(msg);
  if (!ok) return;
  for (const node of nodes) await dfsDelete(node, permanent);
  dfsSelectedIconId = null;
  dfsMultiSelected.clear();
  await dfsBroadcastChange();
}

/* ---------------- 바탕화면 키보드: 방향키 = 아이콘 사이 이동(선택 옮기기) ----------------
   실제 윈도우 바탕화면처럼, 방향키를 누르면 그 방향으로 가장 "가까운" 아이콘으로 선택이
   옮겨간다(아이콘을 화면에서 실제로 움직이는 게 아니다 - 그건 마우스 드래그의 몫). 후보는
   눌린 방향으로 실제 투영 성분(along)이 양수인 아이콘만으로 좁히고, 그중 방향에서 벗어난
   정도(perp)에 패널티를 줘서 가장 "그 방향에 가깝고 가까운" 아이콘을 고른다. 아무것도 선택돼
   있지 않으면 맨 왼쪽 위 아이콘부터 시작한다(실제 탐색기 내용창의 방향키 이동과 같은 방식). */
els.dfIconLayer.tabIndex = 0;
els.dfIconLayer.addEventListener("keydown", async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    // Ctrl+A = 바탕화면 아이콘 전체 선택 (실제 바탕화면과 동일 - 사용자 지시).
    e.preventDefault();
    e.stopPropagation();
    await dfsSelectAllIcons();
    return;
  }
  if (e.key === "Enter") {
    // 엔터 = 선택된 아이콘 열기(탐색기 내용창의 엔터 동작과 동일). 여러 개 선택돼 있으면
    // 실제 윈도우처럼 선택된 항목을 모두 연다(폴더면 탐색기가 열리고, 파일이면 각자의 방식대로 열림).
    e.preventDefault();
    e.stopPropagation();
    if (!dfsDb) return;
    const ids = dfsMultiSelected.size ? [...dfsMultiSelected] : (dfsSelectedIconId !== null ? [dfsSelectedIconId] : []);
    if (!ids.length) return;
    // 요청 #125: 저장소 루트/휴지통 특수 아이콘(id가 문자열)은 dfsDb.nodes 안에 없으므로 따로
    // 처리해야 한다 - 안 그러면 dfsDb.nodes.get()이 undefined를 반환해 filter(Boolean)에서
    // 걸러지고 엔터가 아무 반응도 안 하는 버그가 생긴다(더블클릭과 완전히 같은 동작으로 열어줌).
    const specialIds = ids.filter(id => typeof id === "string");
    const realIds = ids.filter(id => typeof id === "number");
    for (const sid of specialIds) {
      if (sid === DFS_REPOROOT_ICON_ID) await openRealExplorerAt([]);
      else if (sid === DFS_RECYCLEBIN_ICON_ID) await openRealExplorerAt([RECYCLEBIN_TREE_NAME]);
    }
    const nodes = (await Promise.all(realIds.map(id => dfsDb.nodes.get(id)))).filter(Boolean);
    for (const node of nodes) await dfsActivate(node);
    return;
  }
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation(); // 전역 Alt+방향키(뒤로/앞으로 가기) 캡처 리스너와 뒤섞이지 않도록
  if (!dfsDb) return;
  // 요청 #153: 저장소 루트/휴지통 특수 아이콘(id가 문자열)도 방향키로 선택할 수 있어야 하므로,
  // dfsChildren(진짜 dexie 노드만)이 아니라 격자 스냅과 같은 통합 목록(dfsAllDesktopIconPositions -
  // 진짜 노드 + 특수 아이콘 2개, {id, isSpecial, x, y})을 그대로 쓴다.
  const items = await dfsAllDesktopIconPositions();
  if (!items.length) return;
  // 요청 #151: Shift+방향키 범위 선택 - 자유 배치(격자가 아님)라 인덱스 구간이 없으므로, 앵커에서
  // 지금까지 "지나온 아이콘들"의 경로를 기억해뒀다가 그대로 선택한다(이미 지나온 아이콘으로
  // 되돌아가면 그 지점까지만 남기고 뒤쪽은 잘라내 자연히 줄어든다 - 실제 윈도우의 앵커 넘어가면
  // 해제되는 동작과 같은 효과). 화살표가 아닌 다른 방법으로 선택이 바뀐 다음이면(지문이 다르면)
  // 앵커를 새로 잡는다.
  if (dfsCurrentSelectionFingerprint() !== dfsArrowStateFingerprint) {
    dfsArrowAnchorId = null;
    dfsArrowPath = [];
  }
  const centerOf = (n) => ({ x: (n.x ?? 24) + 36, y: (n.y ?? 24) + 40 }); // 아이콘 박스 대략 중심
  const focusId = dfsArrowPath.length ? dfsArrowPath[dfsArrowPath.length - 1]
    : (dfsSelectedIconId !== null ? dfsSelectedIconId
      : (dfsMultiSelected.size ? [...dfsMultiSelected][dfsMultiSelected.size - 1] : null));
  let next = focusId != null ? items.find(n => n.id === focusId) : null;
  if (!next) {
    next = items.slice().sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))[0];
  } else {
    const from = centerOf(next);
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const [dx, dy] = dirs[e.key];
    let best = null, bestScore = Infinity;
    items.forEach(n => {
      if (n.id === next.id) return;
      const to = centerOf(n);
      const vx = to.x - from.x, vy = to.y - from.y;
      const along = vx * dx + vy * dy;
      if (along <= 0) return; // 반대/직각에 가까운 방향은 후보에서 제외
      const perp = Math.abs(vx * dy - vy * dx);
      const score = along + perp * 2;
      if (score < bestScore) { bestScore = score; best = n; }
    });
    if (best) next = best;
  }
  if (e.shiftKey) {
    if (dfsArrowAnchorId == null) { dfsArrowAnchorId = focusId != null ? focusId : next.id; dfsArrowPath = [dfsArrowAnchorId]; }
    const already = dfsArrowPath.indexOf(next.id);
    if (already !== -1) dfsArrowPath = dfsArrowPath.slice(0, already + 1);
    else dfsArrowPath.push(next.id);
    if (dfsArrowPath.length > 1) {
      dfsMultiSelected = new Set(dfsArrowPath);
      dfsSelectedIconId = null;
    } else {
      dfsMultiSelected.clear();
      dfsSelectedIconId = next.id;
    }
  } else {
    dfsArrowAnchorId = next.id;
    dfsArrowPath = [next.id];
    dfsSelectedIconId = next.id;
    dfsMultiSelected.clear();
  }
  dfsArrowStateFingerprint = dfsCurrentSelectionFingerprint();
  dfsRenderDesktop();
});

dfsInitDb();

