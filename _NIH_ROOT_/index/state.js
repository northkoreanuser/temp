/* ============ 아이콘 ============ */
function folderIcon(size, blue) {
  const top = blue ? "#63B3FF" : "#FFCA5F";
  const bot = blue ? "#2E7BE0" : "#FFB13B";
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 8a2 2 0 0 1 2-2h6.17a2 2 0 0 1 1.41.59L14.83 9H27a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" fill="${top}"/>
    <path d="M3 12h26v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V12z" fill="${bot}"/>
  </svg>`;
}
function fileIcon(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 2h11l7 7v19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#eef1f4" stroke="#c7ccd1" stroke-width="1"/>
    <path d="M19 2v6a1 1 0 0 0 1 1h6" fill="none" stroke="#c7ccd1" stroke-width="1"/>
  </svg>`;
}
function htmlFileIcon(size) {
  const badge = Math.round(size * 0.5);
  return `<span style="position:relative;display:inline-block;width:${size}px;height:${size}px;">
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2h11l7 7v19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#eaf2fd" stroke="#8fb8ea" stroke-width="1"/>
      <path d="M19 2v6a1 1 0 0 0 1 1h6" fill="none" stroke="#8fb8ea" stroke-width="1"/>
    </svg>
    <svg width="${badge}" height="${badge}" viewBox="0 0 16 16" style="position:absolute;right:-2px;bottom:-2px;">
      <circle cx="8" cy="8" r="7" fill="#2b7de9" stroke="#fff" stroke-width="1.4"/>
      <path d="M6 10L10 6M10 6H7M10 6V9" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>`;
}

// 요청 #145: 바탕화면에 드래그&드롭으로 가져온 이진 이미지 파일 아이콘 - htmlFileIcon과 같은
// "기본 파일 아이콘 + 모서리 배지" 뼈대를 재사용하되 카메라 대신 간단한 산 그림 배지를 쓴다.
// 이미지가 아닌 다른 이진 파일(zip/exe 등)은 구분할 결정적인 방법이 없으므로 배지 없이
// 그냥 fileIcon을 쓴다(dfsIconGlyphFor 참고).
function imageFileIcon(size) {
  const badge = Math.round(size * 0.5);
  return `<span style="position:relative;display:inline-block;width:${size}px;height:${size}px;">
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2h11l7 7v19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#eef7ea" stroke="#8fca8f" stroke-width="1"/>
      <path d="M19 2v6a1 1 0 0 0 1 1h6" fill="none" stroke="#8fca8f" stroke-width="1"/>
    </svg>
    <svg width="${badge}" height="${badge}" viewBox="0 0 16 16" style="position:absolute;right:-2px;bottom:-2px;">
      <circle cx="8" cy="8" r="7" fill="#3fa34d" stroke="#fff" stroke-width="1.4"/>
      <path d="M4.3 10.8l2.3-2.7 1.8 2 2.4-3.1 2.6 3.8" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="6" cy="5.8" r="0.9" fill="#fff"/>
    </svg>
  </span>`;
}


/* ============ owner/repo 추출 (하드코딩 금지) ============ */
function getOwnerRepo() {
  const owner = location.hostname.split(".")[0] || "";
  const repo = location.pathname.split("/").filter(Boolean)[0] || "";
  return { owner, repo };
}
// 요청: "모든 아이콘 채우는 곳에 /{repo}/_NIH_ROOT_/index/ui/icon/ 주소를 채우는 기능을 만든다
// (바로가기, 파일 메이커 등등)" - 아이콘 URL을 입력하는 곳마다 이 경로를 한 번에 채워주는 버튼이
// 공통으로 쓰는 값이다. repo 이름을 하드코딩하지 않고 항상 getOwnerRepo()로 지금 열려 있는
// 저장소 이름을 그대로 넣는다 - 사용자는 뒤에 실제 파일명만 이어 적으면 된다.
function dfRepoIconFolderPath() {
  const { repo } = getOwnerRepo();
  return `/${repo || "REPO"}/_NIH_ROOT_/index/ui/icon/`;
}

/* ============ GitHub 바로가기 (보기/다운로드/수정/삭제) ============
   이 페이지 자체는 정적 사이트라 파일을 직접 쓸 수 없다. 수정/삭제는 항상
   GitHub의 해당 파일 위치로 이동시키는 것으로 대신한다 (그마저도 환경설정에서
   기본은 꺼져 있음 - 색인과 저장소가 어긋날 수 있어서, 직접 git으로 지우고
   커밋하는 편이 더 안전하기 때문).
================================================================== */
let cachedDefaultBranch = null;
async function getDefaultBranchCached() {
  if (cachedDefaultBranch) return cachedDefaultBranch;
  const { owner, repo } = getOwnerRepo();
  if (!owner || !repo) return "main";
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    cachedDefaultBranch = data.default_branch || "main";
  } catch (e) {
    cachedDefaultBranch = "main"; // 조회 실패해도 링크 자체는 열리도록 합리적인 기본값으로 진행
  }
  return cachedDefaultBranch;
}
function githubItemPath(it) { return it.path.map(encodeURIComponent).join("/"); }
async function githubRawUrl(it) {
  const { owner, repo } = getOwnerRepo();
  const branch = await getDefaultBranchCached();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${githubItemPath(it)}`;
}
// "저장소에서 보기" - GitHub 저장소 화면(blob 뷰어, 커밋 이력 등 GitHub UI 그대로)으로 이동
async function openInRepo(it) {
  const { owner, repo } = getOwnerRepo();
  const branch = await getDefaultBranchCached();
  dfOpenNewTab(`https://github.com/${owner}/${repo}/blob/${branch}/${githubItemPath(it)}`, "_blank", "noopener,noreferrer");
}
// 폴더용 "저장소에서 보기" - 파일의 blob 뷰어 대신 GitHub의 폴더 트리 화면으로 이동한다
// (사용자가 준 예시: https://github.com/<owner>/<repo>/tree/main/_NIH_ROOT_). 루트 폴더(path가
// 빈 배열)는 트리 URL 자체가 그냥 저장소 메인 화면과 같다.
async function openFolderInRepo(it) {
  const { owner, repo } = getOwnerRepo();
  const branch = await getDefaultBranchCached();
  const path = githubItemPath(it);
  const url = path
    ? `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
    : `https://github.com/${owner}/${repo}`;
  dfOpenNewTab(url, "_blank", "noopener,noreferrer");
}
// ============ JSZip 지연 로딩 (바탕화면 가상 폴더를 zip으로 통째로 다운로드할 때만 필요) ============
// 항상 쓰는 기능이 아니므로 페이지 로드시 무조건 불러오지 않고, 실제로 폴더 다운로드를 처음 시도할
// 때 딱 한 번만 CDN에서 불러온다(dexie처럼 이 저장소가 이미 쓰고 있는 것과 같은 CDN).
let jszipLoadPromise = null;
function ensureJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jszipLoadPromise) return jszipLoadPromise;
  jszipLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => { jszipLoadPromise = null; reject(new Error("JSZip을 불러오지 못했습니다(네트워크 확인)")); };
    document.head.appendChild(s);
  });
  return jszipLoadPromise;
}
// "Pages에서 보기" - raw 파일 URL을 그대로 새 탭에 띄운다. 텍스트/이미지는 브라우저가 그대로 보여준다
// (다운로드가 아니라 "그 페이지 자체를 보는" 용도 - 강제 다운로드는 아래 downloadFromGithub가 담당).
// 요청: 우클릭의 "브라우저에서 보기" 옆에 팝업 버전도 필요하다 - popup이 참이면 새 탭 대신
// openShortcutUrl과 같은 크기의 작은 별도 창으로 연다.
async function viewOnPages(it, popup) {
  const url = await githubRawUrl(it);
  if (popup) dfOpenNewTab(url, "_blank", "width=1000,height=700,resizable=yes,scrollbars=yes,noopener");
  else dfOpenNewTab(url, "_blank", "noopener,noreferrer");
}
// "GitHub에서 다운로드" - 단순 링크 이동이 아니라 fetch로 받아서 blob으로 강제 저장한다.
// (raw.githubusercontent.com은 텍스트/이미지를 그냥 열어버리기 때문에, 링크 이동만으로는 다운로드가 안 됨)
async function downloadFromGithub(it) {
  const url = await githubRawUrl(it);
  showToast(`브라우저에서 다운로드 중: ${it.name}`, { sound: "download_start" });
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = it.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    showToast(`다운로드 완료: ${it.name}`, { sound: "download_complete" });
  } catch (e) {
    showToast(`GitHub 다운로드 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
  }
}

/* ============ icon_set.json: 폴더/확장자별 커스텀 아이콘(URL 또는 base64) (요청 #122로 menu.json에서
   분리) ============
   메뉴 메이커(menu-maker.js)의 "아이콘" 탭에서 편집하고, bootstrap.js가 부팅 시
   loadIconSetConfig()로 읽어와 applyCustomIconConfig()로 이 변수에 채워 넣는다. 폴더는 경로
   ("A/B"처럼 "/"로 join한 문자열, 루트는 빈 문자열)로, 파일은 확장자(점 없이, 소문자)로 키를
   삼는다. repoRoot/recycleBin은 바탕화면·트리의 "저장소 루트" 아이콘과 "휴지통" 아이콘을 각각
   따로 지정한다. */
// 요청 #144: "메뉴 메이커 아이콘 탭에서 바탕화면 아이콘, 환경설정 아이콘도 지정 가능하게" -
// repoRoot/recycleBin과 같은 방식으로 고정 슬롯 2개(desktop/settings)를 더 추가한다. desktop은
// 트리의 "바탕 화면" 항목 아이콘(tree-pane.js), settings는 환경설정 창의 타이틀바 아이콘
// (settings-startmenu.js가 app-window.js의 dfCreateAppWindow에 넘기는 icon)에 쓰인다.
let customIconConfig = { folders: {}, extensions: {}, repoRoot: "", recycleBinEmpty: "", recycleBinFull: "", desktop: "", settings: "" };
// 요청: 휴지통 커스텀 아이콘을 "비어있음"/"참" 두 장으로 따로 지정할 수 있어야 한다는 지적 -
// 예전엔 recycleBin 한 필드로 상태와 무관하게 아이콘 하나만 고정됐다(그래서 비어있음/참을 커스텀
// 아이콘에서는 구분할 수 없었다). 기존 icon_set.json에 옛 필드(recycleBin)만 있는 경우와도 호환
// 되도록, 새 필드(recycleBinEmpty/recycleBinFull)가 없으면 옛 필드 값을 두 상태 모두의 기본값으로
// 채워 넣는다(마이그레이션 - 저장하는 순간부터는 새 필드로만 저장된다).
function applyCustomIconConfig(icons) {
  const src = icons || {};
  const legacy = typeof src.recycleBin === "string" ? src.recycleBin : "";
  customIconConfig = {
    folders: (src.folders && typeof src.folders === "object") ? src.folders : {},
    extensions: (src.extensions && typeof src.extensions === "object") ? src.extensions : {},
    repoRoot: typeof src.repoRoot === "string" ? src.repoRoot : "",
    recycleBinEmpty: typeof src.recycleBinEmpty === "string" && src.recycleBinEmpty ? src.recycleBinEmpty : legacy,
    recycleBinFull: typeof src.recycleBinFull === "string" && src.recycleBinFull ? src.recycleBinFull : legacy,
    desktop: typeof src.desktop === "string" ? src.desktop : "",
    settings: typeof src.settings === "string" ? src.settings : ""
  };
}
// 이식성 수정: icon_set.json/menu_set.json 안의 아이콘 경로가 예전엔 "/File-Garage/_NIH_ROOT_/..."
// 처럼 레포 이름을 그대로 박아넣은 절대경로였다 - 레포 이름이 바뀌거나(포크/이름변경) 다른 곳에
// 호스팅하면 전부 깨졌다. resolveIconSrc는 문자열 안에서 "_NIH_ROOT_"가 시작하는 위치를 찾아 그
// 앞부분(레포 이름/도메인 등)을 전부 잘라내고 "_NIH_ROOT_/..."로 시작하는 상대경로만 돌려준다 -
// 상대경로는 index.html 기준으로 풀리므로 레포 이름이 몇 글자든, GitHub Pages든 다른 호스팅이든
// 그대로 통한다. http(s):// 외부 URL이나 data: URI(사용자가 붙여넣은 이미지/파비콘 등)는 건드리지
// 않고 그대로 둔다. "_NIH_ROOT_"가 아예 없는 문자열(원래부터 다른 곳을 가리키는 경로)도 그대로 둔다.
function resolveIconSrc(src) {
  if (typeof src !== "string" || !src) return src;
  if (/^(https?:)?\/\//i.test(src) || src.slice(0, 5) === "data:") return src;
  const idx = src.indexOf("_NIH_ROOT_");
  return idx === -1 ? src : src.slice(idx);
}
function customImgIcon(src, size) {
  return `<img src="${escapeHtml(resolveIconSrc(src))}" width="${size}" height="${size}" style="object-fit:contain;border-radius:3px;" alt="">`;
}
// 실제 저장소 폴더 아이콘 - pathArr가 그 폴더의 경로(루트는 []). blue는 트리 루트처럼 파란 폴더
// 아이콘을 쓸지 여부(커스텀 아이콘이 있으면 이 값은 무시된다).
function resolveFolderIcon(pathArr, size, blue) {
  const custom = customIconConfig.folders[pathArr.join("/")];
  if (custom) return customImgIcon(custom, size);
  return folderIcon(size, blue);
}
// 요청 #141: 저장소에 올라간 .sc 바로가기 파일의 아이콘 - htmlFileIcon과 같은 방식(기본 파일
// 아이콘 + 모서리 배지)이지만, 바탕화면 바로가기(dfsIconGlyphFor의 ↪ 배지)와 헷갈리지 않도록
// 반대쪽 모서리에 실제 윈도우 바로가기 화살표에 가까운 모양을 그린다. 테마 CSS에 기대지 않고
// 완전히 인라인으로 그려서, 8개 테마 style.css를 하나도 건드리지 않고 어디서든(내용창 32px/
// 트리 15px) 항상 같은 모양으로 보이게 한다.
// 요청: "sc 파일 처음 조우하면 파비콘 렌더링하고, 한 번 되면 로컬 저장소에 캐시. 새로고침시엔
// 캐시 유무와 무관하게 sc 파일을 다시 읽어 갱신 후 재저장" - faviconHtml이 있으면(캐시 히트,
// 혹은 갱신 완료 후 패치) 기본 파일 아이콘 자리를 파비콘 <img>로 바꿔치기한다. path/size를
// data-* 속성에 남겨둬서 dfEnsureScFaviconFresh가 나중에 이 자리를 찾아 patchScFaviconDom으로
// 다시 바꿔칠 수 있게 한다(내용창 그리드/트리 양쪽 다 같은 .sc-icon-face 클래스로 통일).
function shortcutFileIcon(size, path, faviconHtml) {
  const badge = Math.max(9, Math.round(size * 0.55));
  const key = path ? path.join("/") : "";
  const face = faviconHtml || fileIcon(size);
  return `<span class="sc-icon" data-sc-icon-path="${escapeHtml(key)}" data-sc-icon-size="${size}" style="position:relative;display:inline-block;width:${size}px;height:${size}px;">
    <span class="sc-icon-face" style="display:inline-block;width:${size}px;height:${size}px;">${face}</span>
    <span style="position:absolute;left:-2px;bottom:-2px;width:${badge}px;height:${badge}px;line-height:${badge}px;text-align:center;font-size:${Math.max(8, Math.round(badge * 0.72))}px;background:#fff;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.25);">↪</span>
  </span>`;
}
function scFaviconImgHtml(src, size) {
  return `<img src="${escapeHtml(src)}" width="${size}" height="${size}" style="object-fit:contain;border-radius:3px;" alt="">`;
}
function dfScFaviconCacheKey(path) { return "dfScFaviconV1:" + path.join("/"); }
function dfReadScFaviconCache(path) {
  try {
    const raw = localStorage.getItem(dfScFaviconCacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed.favicon === "string" && typeof parsed.url === "string") ? parsed : null;
  } catch (e) { return null; } // 캐시가 깨졌어도 조용히 무시하고 기본 아이콘 + 새 fetch로 떨어진다
}
function dfWriteScFaviconCache(path, url, favicon) {
  try { localStorage.setItem(dfScFaviconCacheKey(path), JSON.stringify({ url, favicon })); } catch (e) { /* 저장공간 부족 등은 조용히 무시(부수 기능) */ }
}
// google s2 파비콘 서비스 - 대상 사이트가 favicon.ico를 루트에 안 두거나 manifest로만 아이콘을
// 지정해도 대부분 잡아준다. <img src>는 CORS 제약이 없어(화면 표시만 할 뿐 픽셀을 읽지 않음)
// 대상 사이트가 크로스오리진이어도 그냥 붙여 쓸 수 있다.
function dfFaviconUrlForTarget(targetUrl) {
  try { return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(new URL(targetUrl).hostname)}`; }
  catch (e) { return null; } // url이 상대경로 등 파싱 불가한 형태면 파비콘 없이 기본 아이콘 유지
}
// 이번 페이지 로드에서 이미 한 번 갱신을 마친 .sc 경로 - content-pane.js의 dfRepoTextSniffCache와
// 같은 목적(같은 폴더를 여러 번 다시 그릴 때 매번 네트워크를 타지 않게). 페이지를 새로고침하면
// 이 Set도 함께 비므로 "새로고침시엔 캐시 유무와 무관하게 다시 읽는다"는 요구가 자연히 만족된다.
const dfScFaviconFreshPaths = new Set();
// activateScShortcut(keyboard-and-activate.js)과 완전히 같은 방식으로 .sc 내용을 읽어(같은
// 오리진 상대경로라 CORS 걱정 없음) 그 안의 url로 파비콘 주소를 만들고, 캐시에 없거나 값이
// 바뀌었으면 화면에 이미 그려진 자리(들)를 patchScFaviconDom으로 바꿔치고 캐시를 재저장한다.
async function dfEnsureScFaviconFresh(path) {
  const key = path.join("/");
  if (dfScFaviconFreshPaths.has(key)) return;
  dfScFaviconFreshPaths.add(key);
  try {
    const res = await fetchWithTimeout(path.map(encodeURIComponent).join("/"), 5000);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data || typeof data.url !== "string" || !data.url) return; // 이 앱 형식이 아니면 기본 아이콘 그대로 둔다
    const favicon = dfFaviconUrlForTarget(data.url);
    if (!favicon) return;
    const cached = dfReadScFaviconCache(path);
    dfWriteScFaviconCache(path, data.url, favicon); // 요청: 갱신했으면 항상 재저장(값이 같아도)
    if (!cached || cached.favicon !== favicon) patchScFaviconDom(key, favicon);
  } catch (e) {
    // 네트워크 오류 등은 조용히 무시 - 배경 작업이라 매번 토스트로 알릴 필요는 없다. freshPaths에는
    // 이미 넣어뒀으므로 이 페이지 로드 중 같은 항목을 또 다시 시도하진 않는다(무한 재시도 방지).
  }
}
// 내용창 그리드/트리 양쪽에 동시에 떠 있을 수 있는 같은 .sc 파일의 아이콘 자리를 전부 찾아 바꿔친다.
function patchScFaviconDom(key, faviconUrl) {
  document.querySelectorAll(`.sc-icon[data-sc-icon-path="${CSS.escape(key)}"] .sc-icon-face`).forEach(face => {
    const size = Number(face.parentElement.dataset.scIconSize) || 16;
    face.innerHTML = scFaviconImgHtml(faviconUrl, size);
  });
}
function resolveFileIcon(name, size, path) {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const custom = ext && customIconConfig.extensions[ext];
  if (custom) return customImgIcon(custom, size);
  if (isSc(name)) {
    const cached = path ? dfReadScFaviconCache(path) : null;
    if (path) dfEnsureScFaviconFresh(path); // 그려지자마자 백그라운드로 갱신 시도(dfSniffRepoFileIsText와 같은 패턴)
    return shortcutFileIcon(size, path, cached ? scFaviconImgHtml(cached.favicon, size) : null);
  }
  return isHtml(name) ? htmlFileIcon(size) : fileIcon(size);
}
function resolveRepoRootIcon(size) {
  return customIconConfig.repoRoot ? customImgIcon(customIconConfig.repoRoot, size) : folderIcon(size, true);
}
// 요청 #167: 실제 윈도우처럼 휴지통이 비어있을 때/차 있을 때 서로 다른 그림이어야 한다는 지적 -
// ui/icon/desktop/recyclebin1.ico(비어있음)·recyclebin2.ico(참) 두 아이콘을 기본으로 쓴다. 커스텀
// 아이콘(icon_set.json의 recycleBin)이 지정돼 있으면 예전처럼 상태와 무관하게 그 아이콘 하나로
// 고정한다(커스텀 아이콘까지 상태별 두 장으로 나누는 건 이번 요청 범위를 넘어서므로 스키마는
// 그대로 둔다) - isEmpty는 호출하는 쪽(desktop-fs.js/tree-pane.js)이 실제 휴지통 항목 수를 보고 넘긴다.
function resolveRecycleBinIcon(size, isEmpty) {
  const custom = isEmpty ? customIconConfig.recycleBinEmpty : customIconConfig.recycleBinFull;
  if (custom) return customImgIcon(custom, size);
  const src = "_NIH_ROOT_/index/ui/icon/desktop/" + (isEmpty ? "recyclebin1" : "recyclebin2") + ".ico";
  return `<img src="${src}" width="${size}" height="${size}" style="object-fit:contain;" alt="">`;
}
// 요청 #144: 트리의 "바탕 화면" 항목 아이콘 - 커스텀 아이콘이 없으면 예전 그대로 파란 폴더.
function resolveDesktopIcon(size, blue) {
  return customIconConfig.desktop ? customImgIcon(customIconConfig.desktop, size) : folderIcon(size, blue);
}
// 요청 #144: 환경설정 창 타이틀바 아이콘 - app-window.js의 .tb-icon이 textContent가 아니라
// innerHTML로 채워지도록 함께 바꿨으므로(settings-startmenu.js 참고) 여기서 <img> HTML을 그대로
// 돌려줘도 된다. 커스텀 아이콘이 없으면 예전 그대로 톱니바퀴 이모지.
function resolveSettingsIconHtml() {
  return customIconConfig.settings ? customImgIcon(customIconConfig.settings, 16) : "⚙";
}
// 요청: icon_set.json에 경로 문자열만 있으면(실제 파일 존재 여부와 무관하게) 무조건 <img>를
// 그려버리던 문제 - 경로가 깨져 있으면(오타/삭제됨/404) 브라우저 기본 깨진 이미지 아이콘이 뜬
// 채로 고정됐다. 실제 <img> 엘리먼트를 만들어 onerror가 뜨면(로드 실패) 그 자리를 기본 톱니바퀴로
// 되돌리도록 한다 - settings-startmenu.js의 makeAppIcon(시작메뉴 커스텀 앱 아이콘)과 같은 패턴.
function renderSettingsIconInto(container) {
  if (!container) return;
  if (!customIconConfig.settings) { container.textContent = "⚙"; return; }
  const img = document.createElement("img");
  img.src = resolveIconSrc(customIconConfig.settings);
  img.alt = "";
  img.width = 16;
  img.height = 16;
  img.style.objectFit = "contain";
  img.style.borderRadius = "3px";
  img.onerror = () => { container.textContent = "⚙"; };
  container.innerHTML = "";
  container.appendChild(img);
}
// 시작 메뉴의 "설정" 항목 자체 아이콘 - 위와 같은 규칙(커스텀 있으면 그걸, 로드 실패하거나 아예
// 없으면 기본 톱니바퀴)을 따른다. 부팅 시(bootstrap.js) 한 번, icon_set.json이 바뀔 때마다
// (refreshMergedIconConfig) 다시 불러서 반영한다.
function renderSettingsMenuRowIcon() {
  renderSettingsIconInto(els.settingsMenuIcon);
}

/* ============ sound_set.json: 상황별 알림음 (요청 #122) ============
   메뉴 메이커의 "사운드" 탭에서 편집하고, bootstrap.js가 부팅 시 loadSoundSetConfig()로 읽어와
   applySoundSetConfig()로 이 변수에 채워 넣는다. 키는 아래 DF_SOUND_SCENARIOS에 나열된 시나리오
   식별자, 값은 소리 파일의 URL 또는 base64 데이터 URI다(비어 있으면 그 상황엔 소리를 재생하지
   않음 - 기본값은 전부 무음). 이 앱에서 실제로 구분해 소리를 낼 수 있는 모든 경우를 나열한다. */
const DF_SOUND_SCENARIOS = [
  // 요청: "사운드 옵션에 부팅음을 추가한다(페이지 로드시 화면을 터치하거나 하면 재생, 자동 재생은
  // 불가능하니까)" - 브라우저는 사용자 동작(클릭/터치/키 입력) 전에는 소리 재생 자체를 막으므로,
  // 페이지를 연 시점이 아니라 그 뒤 화면을 처음 클릭/터치/키입력하는 순간 딱 한 번만 재생한다
  // (dfArmBootSoundOnFirstInteraction 참고).
  { key: "boot", label: "부팅음", hint: "페이지를 열고 화면을 처음 클릭/터치(또는 키 입력)했을 때 1회만 - 자동재생은 브라우저 정책상 불가능해 첫 상호작용에 재생합니다" },
  { key: "notify_success", label: "일반 알림(성공)", hint: "대부분의 성공 토스트(기본 종류)" },
  { key: "notify_info", label: "안내 알림", hint: "정보성 안내 토스트" },
  { key: "notify_warn", label: "경고/오류 알림", hint: "실패·경고 토스트 전체" },
  { key: "download_start", label: "다운로드 시작", hint: "저장 위치 선택 등 다운로드가 시작될 때" },
  { key: "download_complete", label: "다운로드 완료", hint: "파일/폴더 다운로드가 끝났을 때" },
  { key: "download_cancel", label: "다운로드 취소", hint: "사용자가 저장 위치 선택 등을 취소했을 때" },
  { key: "download_error", label: "다운로드 오류", hint: "다운로드 중 네트워크 등 오류가 났을 때" },
  { key: "delete_to_recyclebin", label: "휴지통으로 삭제", hint: "파일/폴더를 휴지통으로 옮길 때" },
  { key: "recyclebin_empty", label: "휴지통 비우기", hint: "휴지통을 완전히 비웠을 때" },
  { key: "restore_from_recyclebin", label: "휴지통에서 복원", hint: "휴지통의 항목을 되돌렸을 때" },
  { key: "move_or_copy", label: "이동/복사/이름변경 완료", hint: "드래그 이동, 붙여넣기, 이름 변경이 끝났을 때" },
  { key: "copy_to_clipboard", label: "클립보드에 복사", hint: "복사/잘라내기, 주소·경로 복사" },
  { key: "webhook_connected", label: "로컬 헬퍼(웹훅) 연결됨", hint: "로컬 헬퍼가 처음 확인(ping)됐을 때" },
  { key: "window_open", label: "탐색기 창 열기", hint: "탐색기 창이 열릴 때" },
  { key: "window_close", label: "탐색기 창 닫기", hint: "탐색기 창이 닫힐 때" },
  { key: "window_minimize", label: "창 최소화", hint: "탐색기 창을 최소화할 때" },
  { key: "window_maximize_restore", label: "창 최대화/복원", hint: "탐색기 창을 최대화하거나 원래 크기로 되돌릴 때" },
  { key: "error_generic", label: "일반 오류", hint: "이름 충돌 등 조작이 거부되는 일반 오류" }
];
let soundSetConfig = {};
function applySoundSetConfig(sounds) {
  soundSetConfig = (sounds && typeof sounds === "object") ? sounds : {};
}
// 같은 소리(같은 src 문자열)를 매번 새 Audio()로 만들지 않고 재사용한다 - 짧은 시간에 반복
// 재생되어도(연속 삭제 등) currentTime을 되돌려서 처음부터 다시 재생한다.
const dfSoundCache = {};
// 요청 #147: "사운드 지정 옵션에 파일/URL(base64) 말고 Web Audio API 코드로도 지정할 수 있게
// 추가해줘" - sound_set.json의 값 형식은 그대로 문자열 하나뿐이지만(스키마를 안 바꿔도 되게),
// 그 문자열이 "webaudio:"로 시작하면 나머지를 그 상황에서 소리를 직접 만들어 재생하는 JS 코드로
// 취급한다(예: 오실레이터로 짧은 비프음을 합성) - 그 외(URL/base64)는 기존 그대로 <audio>로 튼다.
// 메뉴 메이커의 사운드 탭(menu-maker.js buildSoundEditorField)이 이 접두어를 붙이고 뗀다.
const DF_SOUND_WEBAUDIO_PREFIX = "webaudio:";
function dfsIsWebAudioSound(src) {
  return typeof src === "string" && src.indexOf(DF_SOUND_WEBAUDIO_PREFIX) === 0;
}
// 사용자 본인이 메뉴 메이커에 직접 입력/붙여넣은 코드를 그대로 실행한다(이 앱은 개인용 정적
// 사이트이고, 이 코드는 항상 사용자 자신의 저장소에 있는 sound_set.json에서만 온다) - 코드가
// 잘못됐어도(문법 오류/런타임 예외) 부수 기능(알림음)이므로 조용히 무시하고 넘어간다.
function dfsRunWebAudioSoundCode(code) {
  try {
    const fn = new Function(code || "");
    fn();
  } catch (e) { /* 무시 - 알림음 하나 안 나는 것뿐이므로 앱 동작을 막지 않는다 */ }
}
function dfsPlaySound(scenarioKey) {
  const src = soundSetConfig[scenarioKey];
  if (!src) return; // 그 상황에 소리가 지정 안 돼 있으면(기본값) 조용히 아무것도 하지 않는다
  if (dfsIsWebAudioSound(src)) { dfsRunWebAudioSoundCode(src.slice(DF_SOUND_WEBAUDIO_PREFIX.length)); return; }
  try {
    let audio = dfSoundCache[src];
    if (!audio) { audio = new Audio(src); dfSoundCache[src] = audio; }
    audio.currentTime = 0;
    audio.play().catch(() => {}); // 브라우저 자동재생 정책 등으로 실패해도 부수 기능이니 조용히 무시
  } catch (e) { /* 무시 */ }
}
// 요청: 페이지 로드시 부팅음을 재생하고 싶어도 브라우저 자동재생 정책 때문에 곧바로는 불가능하다
// - 대신 로드 이후 화면에서 일어나는 첫 클릭/터치/키 입력을 "사용자 동작"으로 인정받는 순간으로
// 삼아 그때 딱 한 번만 dfsPlaySound("boot")를 재생한다(그 뒤로는 다시 재생하지 않음 - 이후의
// 클릭들은 전부 원래 그 클릭이 하려던 일을 그대로 한다). 부팅음이 지정돼 있지 않으면(기본값)
// dfsPlaySound가 알아서 아무 것도 하지 않으므로, 이 함수는 부팅음 설정 여부와 무관하게 항상 걸어
// 둬도 안전하다.
let dfBootSoundArmed = false;
function dfArmBootSoundOnFirstInteraction() {
  if (dfBootSoundArmed) return;
  dfBootSoundArmed = true;
  const events = ["click", "touchstart", "keydown"];
  const handler = () => {
    events.forEach(ev => document.removeEventListener(ev, handler, true));
    dfsPlaySound("boot");
  };
  events.forEach(ev => document.addEventListener(ev, handler, true));
}

/* ============ extension_run_set.json: 확장자별 더블클릭 동작 (요청 #143) ============
   "메뉴 메이커에 '확장자' 네 번째 탭을 추가. 도구에 이니셜을 추가(에디터 = editor 같은 식), 원하는
   확장자를 적고 드롭다운으로 뭘로 열지 선택(ex: html은 새 탭, txt는 에디터)." - 더블클릭했을 때
   무엇을 할지 고를 수 있는 "도구"들을 아래 EXTENSION_RUN_ACTIONS에 고정 목록(각각 짧은
   이니셜(key) + 한글 이름(label))으로 등록해두고, extension_run_set.json은 그 이니셜을 값으로
   삼아 확장자(점 없이, 소문자) -> 이니셜의 단순한 맵이다: { "txt": "editor", "html": "newtab" }.
   settings.doubleClickAction(전역 기본값)과 같은 값 집합을 그대로 쓰되, "editor"(에디터로 열기 -
   지금까지 md 파일에만 하드코딩돼 있던 dfsOpenRepoFileInEditor)가 여기서만 고를 수 있는 선택지로
   새로 추가된다(전역 설정에는 안 넣는다 - 모든 파일을 에디터로 강제 여는 건 잘 안 쓰일 선택이라
   확장자별 설정에서만 의미가 있다고 판단). keyboard-and-activate.js의 activate()가 md/sc를 먼저
   처리한 뒤, 그 외 파일은 extensionRunActionFor()로 이 설정을 먼저 확인하고, 없으면 그제서야
   전역 settings.doubleClickAction으로 떨어진다(runDoubleClickAction 참고). */
const EXTENSION_RUN_ACTIONS = [
  { key: "helper", label: "로컬에서 열기(헬퍼)" },
  { key: "newtab", label: "새 탭에서 열기" },
  // 요청: "새 탭에서 열기(newtab)"의 짝으로 팝업 버전도 확장자 탭에서 고를 수 있어야 한다 -
  // viewAsHostedPage와 완전히 같은 주소를 새 탭 대신 작은 별도 창(popup)으로 연다
  // (openShortcutUrl/트레이 항목의 "팝업으로 열기"와 같은 창 크기 패턴).
  { key: "popup", label: "팝업으로 열기" },
  { key: "editor", label: "에디터로 열기" },
  { key: "text", label: "텍스트(브라우저)로 열기" },
  { key: "download", label: "다운로드" },
  { key: "repo", label: "저장소에서 보기(GitHub)" },
  // 요청: "hls 재생기 추가. 파일 확장자 연결은 메뉴 메이커의 확장자 탭에서 연결한다(하드코딩
  // 연결은 하지 말고, 사용자가 찾아 쓰게 하면 좋음)" - 그래서 여기서는 .m3u8 같은 확장자를
  // 하드코딩으로 이 동작에 미리 이어붙이지 않는다. 사용자가 메뉴 메이커 > 확장자 탭에서 원하는
  // 확장자에 이 동작을 직접 골라 연결해야 한다(hls-player.js의 dfsOpenRepoFileInHlsPlayer 참고).
  { key: "hls", label: "HLS 재생기로 열기" },
  // 요청: "hls 뷰어 창을 음악 플레이어/사진 뷰어로 돌려써라 - mp3/png 등은 raw 링크로 그대로
  // 재생/로드되니 창의 이름/아이콘만 바꾸면 된다." - hls와 완전히 같은 창(hls-player.js의
  // dfsOpenMediaViewerWindow)을 재사용하되 mode만 다르게 넘긴다(HLS 전용 재생 로직은 video
  // 모드에서만 탄다 - 음악/사진은 raw 주소를 <audio>/<img>에 그대로 물릴 뿐이라 hls.js가 필요
  // 없음). 이 확장자 탭에서도 hls처럼 어떤 확장자와도 미리 엮여 있지 않으므로 사용자가 직접 연결.
  { key: "music", label: "음악 플레이어로 열기" },
  { key: "photo", label: "사진 뷰어로 열기" },
  // music/photo와 완전히 같은 논리 - pdf도 raw 주소를 <iframe>에 그대로 물리면 브라우저가
  // 알아서 렌더링하므로(hls.js 같은 조립 불필요) dfsOpenMediaViewerWindow에 mode만 추가.
  { key: "pdf", label: "PDF 뷰어로 열기" },
  // 사용자 지시: "텍스트 뷰어로 열기 사진 뷰어나 음악 뷰어와 같은 방식으로 구현해.
  // 우클릭 메뉴에는 추가하지 말고 더블클릭 메이커 메뉴에만 추가해" - 앱 내 읽기 전용 창
  // (editor.js의 dfsOpenRepoFileInTextViewer). 기존 "text"(브라우저 raw 열기)와 별개.
  { key: "textviewer", label: "텍스트 뷰어로 열기" }
];
function fileExtOf(name) {
  const dot = (name || "").lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
let extensionRunConfig = {};
function applyExtensionRunSetConfig(data) {
  extensionRunConfig = (data && typeof data === "object") ? data : {};
}
// 이 확장자에 등록된 개별 동작이 있으면 그 이니셜을, 없으면 null을 돌려준다(activate()가 null이면
// 전역 settings.doubleClickAction으로 대신 떨어진다).
function extensionRunActionFor(name) {
  const ext = fileExtOf(name);
  const action = ext && extensionRunConfig[ext];
  return (action && EXTENSION_RUN_ACTIONS.some(a => a.key === action)) ? action : null;
}

/* ============ 메뉴 메이커 로컬 반영(요청 #123) ============
   "메뉴 메이커에서 로컬 반영이 우선이고, json을 업로드해서 불러오면 로컬 스토리지를 다시
   덮어씀. 메뉴 추가/수정 시 로컬스토리지에 바로 반영되어야 즉시 테스트 가능" - 편집할 때마다
   (가져오기 포함) 그 내용을 여기 정의된 키로 localStorage에 바로 써두면, 실제 파일을 아직
   저장소에 반영하지 않았어도 이 브라우저에서는 즉시 반영된 걸로 취급해 테스트할 수 있다(로더가
   실제 파일보다 이 값을 먼저 확인 - settings-startmenu.js의 loadMenuSetConfig 등 참고).
   요청 #135로 메뉴 메이커가 별개의 새 탭이 아니라 이 문서 자신 안의 앱 내 창이 된 뒤로는, 이
   함수들을 menu-maker.js용으로 따로 복사해 넣을 필요가 없어졌다(같은 전역 스코프를 그냥 공유).
   대신 메인 화면을 즉시 다시 그리는 부분은 storage 이벤트(다른 문서에서 바뀔 때만 옴)가 아니라
   menu-maker.js의 persistLocalOverride가 settings-startmenu.js의 dfDebouncedLsRefresh를 직접
   불러 처리한다(그 파일의 storage 리스너 주석 참고). */
function dfLsMenuKey() { return "dfLocalMenuSetV1"; }
function dfLsIconKey() { return "dfLocalIconSetV1"; }
function dfLsIconSkinPrefix() { return "dfLocalIconSetSkinV1:"; }
function dfLsIconSkinKey(skinName) { return dfLsIconSkinPrefix() + (skinName || "win7"); }
function dfLsSoundKey() { return "dfLocalSoundSetV1"; }
// 사운드도 아이콘과 똑같이 스킨별로 저장할 수 있다("스킨용으로 저장" - 메뉴 메이커 사운드 탭,
// dfLsIconSkinKey/dfLsIconSkinPrefix와 완전히 같은 패턴).
function dfLsSoundSkinPrefix() { return "dfLocalSoundSetSkinV1:"; }
function dfLsSoundSkinKey(skinName) { return dfLsSoundSkinPrefix() + (skinName || "win7"); }
function dfLsExtRunKey() { return "dfLocalExtRunSetV1"; }
function dfReadLocalOverride(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : null;
  } catch (e) {
    return null; // 저장된 값이 깨졌어도 조용히 무시하고 실제 파일을 쓰게 한다
  }
}
function dfWriteLocalOverride(key, jsonText) {
  try { localStorage.setItem(key, jsonText); } catch (e) { /* 저장공간 부족 등은 조용히 무시(부수 기능) */ }
}
function dfClearLocalOverride(key) {
  try { localStorage.removeItem(key); } catch (e) { /* 무시 */ }
}

/* ============ 전체화면 자동 진입/해제 (요청 #128) ============
   "환경설정에 '페이지 로드시 전체화면' 옵션(기본 켬). 새 탭을 여는 모든 기능/링크를 누르면
   전체화면을 먼저 풀고 열며, 그 탭에서 돌아오면 다시 자동으로 전체화면(사용자가 직접 푼 경우는
   제외)." - 브라우저는 사용자 동작(클릭 등) 없이는 전체화면 API를 거부하므로, "로드시 전체화면"은
   실제로는 로드 후 첫 클릭에 들어가는 식으로 구현한다(dfArmFullscreenOnNextClick). 새 탭/링크를
   여는 모든 곳은 dfOpenNewTab()을 거치게 해서 열기 직전에 전체화면을 풀고, 그 탭에서 돌아오면
   (visibilitychange) 다시 들어간다 - 단, 사용자가 Esc/F11 등으로 "직접" 뺀 경우는 우리가 부른 게
   아니므로 dfFsUserOptedOut을 세워 그 뒤로는 자동으로 다시 넣지 않는다(설정을 다시 켜면 해제). */
let dfFsIntentionalExit = false; // 우리가(새 탭을 열려고) 지금 exitFullscreen()을 부르는 중인지
let dfFsWantReenter = false;     // 그 탭에서 돌아오면 다시 전체화면으로 들어가야 하는지
let dfFsUserOptedOut = false;    // 사용자가 직접 전체화면을 뺐으면(그 뒤로 이 세션에서는 자동으로 안 넣음)
let dfFsArmedForClick = false;   // 다음 클릭에 전체화면 요청을 걸어둔 상태인지(중복 등록 방지)
function dfIsFullscreen() { return !!document.fullscreenElement; }
function dfRequestFullscreenQuiet() {
  try {
    const p = document.documentElement.requestFullscreen();
    if (p && p.catch) p.catch(() => {}); // 아직 사용자 동작이 인정 안 된 상태 등은 조용히 무시
  } catch (e) { /* 무시 */ }
}
// 다음 클릭 한 번에 전체화면 요청을 걸어둔다(로드 직후, 또는 다른 탭에서 돌아온 뒤 자동 재진입이
// 제스처 부족으로 막혔을 때의 대비책 - 둘 다 "클릭하면 바로 들어간다"로 자연스럽게 이어진다).
function dfArmFullscreenOnNextClick() {
  if (dfFsArmedForClick) return;
  dfFsArmedForClick = true;
  const handler = () => {
    dfFsArmedForClick = false;
    document.removeEventListener("click", handler, true);
    if (!settings.fullscreenOnLoad || dfFsUserOptedOut || dfIsFullscreen()) return;
    dfRequestFullscreenQuiet();
  };
  document.addEventListener("click", handler, true);
}
// 새 탭/링크를 여는 곳은 전부 이 함수를 거쳐서 window.open을 부른다 - 실제로 열기 직전에 지금
// 전체화면이면 풀어준다(전체화면 상태에서 새 탭이 뜨면 어색하고, 팝업 크기 지정도 무의미해짐).
function dfExitFullscreenForNewTab() {
  if (!dfIsFullscreen()) return;
  dfFsIntentionalExit = true;
  try {
    const p = document.exitFullscreen();
    if (p && p.catch) p.catch(() => { dfFsIntentionalExit = false; });
  } catch (e) { dfFsIntentionalExit = false; }
}
// 요청 #163: 팝업(작은 별도 창 - features에 width/height가 있는 경우, 예: 트레이 항목의 "팝업으로
// 열기")은 전체화면 위에 떠 있어도 어색하지 않은 별도 창이라 전체화면을 풀 필요가 없다 - 진짜 새
// "탭"(주소창이 있는 일반 브라우저 탭)만 전체화면과 겹치면 어색해서 미리 풀어준다. 또한 환경설정의
// "새 탭을 열어도 전체화면 유지"를 켜뒀으면 새 탭이어도 풀지 않는다(사용자가 명시적으로 원한 것).
function dfOpenNewTab(url, target, features) {
  const isPopup = typeof features === "string" && /(^|,)\s*(width|height)\s*=/.test(features);
  if (!isPopup && !settings.keepFullscreenOnNewTab) dfExitFullscreenForNewTab();
  return window.open(url, target, features);
}
// 요청 #141: 바로가기(가상 파일시스템의 url 방식 + 저장소에 올라간 .sc 파일 둘 다)가 공용으로 쓰는
// "대상 열기" - popup이 참이면 새 탭이 아니라 작은 별도 창으로 띄운다(features 문자열에 width/height
// 등 창 크기 속성이 있으면 대부분의 브라우저가 탭 대신 진짜 새 창으로 연다).
function openShortcutUrl(url, popup) {
  if (popup) return dfOpenNewTab(url, "_blank", "width=1000,height=700,resizable=yes,scrollbars=yes,noopener");
  return dfOpenNewTab(url, "_blank", "noopener,noreferrer");
}
// fullscreenchange로 "누가" 뺐는지 구분한다: dfFsIntentionalExit가 서 있으면 우리가 새 탭을 열려고
// 뺀 것(돌아오면 다시 넣어야 함), 아니면 사용자가 직접(Esc, F11, 브라우저 UI 등으로) 뺀 것(그
// 뒤로는 자동으로 다시 넣지 않음).
function dfSetupFullscreenAutoManagement() {
  document.addEventListener("fullscreenchange", () => {
    if (dfIsFullscreen()) { dfFsWantReenter = false; return; }
    if (dfFsIntentionalExit) {
      dfFsIntentionalExit = false;
      dfFsWantReenter = true;
    } else {
      dfFsUserOptedOut = true;
      dfFsWantReenter = false;
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!settings.fullscreenOnLoad || dfFsUserOptedOut || !dfFsWantReenter || dfIsFullscreen()) return;
    dfRequestFullscreenQuiet(); // 탭 전환 자체가 사용자 동작으로 인정되는 경우도 있어 일단 시도
    dfArmFullscreenOnNextClick(); // 안 되면(대부분) 다음 클릭에 확실히 들어가게 대비
  });
  if (settings.fullscreenOnLoad) dfArmFullscreenOnNextClick();
  // <a target="_blank"> 같은 진짜 링크 클릭(JS의 window.open이 아닌 것)도 캡처링 단계에서 잡아서
  // 새 탭이 열리기 전에 전체화면을 풀어준다 - 링크의 기본 동작(새 탭 열기)은 그대로 두고 병행한다.
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
    if (a) dfExitFullscreenForNewTab();
  }, true);
}

function isHtml(name) { return /\.html$/i.test(name); }
function isMd(name) { return /\.md$/i.test(name); }
// 요청 #141: 바로가기 파일(.sc, "shortcut" 약자) - 바탕화면(가상 파일시스템)에서 만든 바로가기를
// 다운로드해 저장소에 올려두면, 실제 저장소 파일로 다시 나타나도 여전히 "바로가기"로 동작하게
// 하려고 만든 이 앱 전용 형식이다(내용은 JSON 텍스트 - dfsDownloadShortcutFile 참고). 실제
// 윈도우가 .lnk 확장자를 숨기는 것처럼, 이 앱도 .sc는 표시할 때 확장자를 숨긴다(displayName).
function isSc(name) { return /\.sc$/i.test(name); }
// 화면에 보여줄 이름 - 실제 파일명(F2 이름 변경/속성/다운로드 등에는 항상 진짜 이름을 그대로 씀)과
// 달리, 목록/트리/상태표시줄 등 "라벨"에서만 .sc 확장자를 숨긴다(요청 #141 - 실제 윈도우가 등록된
// 확장자를 숨기는 것과 같은 원리).
function displayName(name) { return isSc(name) ? name.replace(/\.sc$/i, "") : name; }
// 내용창/트리/검색 결과가 항목의 종류(type)를 다 같은 규칙으로 정하도록 한 곳에 모아둔다 - html은
// 기본적으로 "저장소에서 보기"(호스팅된 실제 페이지)가 아니라 다른 파일처럼 열기/다운로드 기본
// 동작을 따르고(사용자 지시), md는 더블클릭 기본 동작이 내장 에디터로 열기가 되도록(활성화
// 로직인 activate()에서 이 type 값으로 분기) 별도 종류로 구분해둔다. sc(요청 #141)도 같은 이유로
// 별도 종류 - 더블클릭하면 파일 자체가 아니라 그 안에 적힌 주소로 이동해야 한다.
function fileTypeFor(name) { return isHtml(name) ? "html" : isMd(name) ? "md" : isSc(name) ? "sc" : "file"; }
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ 요청 #140: 속성(Properties) 대화상자용 바이트 표시 ============
   실제 윈도우 속성창처럼 "12.3 MB (12,345,678 바이트)" 형태로 함께 쓰기 위해, 사람이 읽기 쉬운
   쪽(이 함수)과 정확한 바이트 수(toLocaleString)를 호출하는 쪽에서 조합한다.
   단위: 바이트 → KB → MB → GB → TB → PB (끝까지). */
function formatBytes(n) {
  const num = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (num < 1024) return `${num} 바이트`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = num, i = -1;
  do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

/* ============ 저장소(레포) 파일/폴더 속성 대화상자 ============
   context-menu.js / content-pane.js 에서 호출한다.
   예전에는 함수가 정의되지 않아 "속성"을 눌러도 아무 반응이 없었다.
   - 폴더/빈 곳: 하위 전체(재귀) 파일·폴더 개수 + 총 크기
   - 파일: 크기 + (있으면) CRC32 */
async function showRepoFolderProperties(pathArr, opts) {
  opts = opts || {};
  const kind = opts.kind || (pathArr && pathArr.length ? "폴더" : "저장소 루트 폴더");
  const titleName = opts.title || (pathArr && pathArr.length ? pathArr[pathArr.length - 1] : (repoName || "저장소"));
  const location = pathArr && pathArr.length
    ? ((repoName || "저장소") + "\\" + pathArr.join("\\"))
    : (repoName || "저장소");
  showToast("속성 계산 중...", { sound: "download_start" });
  let files = 0, folders = 0, bytes = 0;
  try {
    const all = await crawlAll(pathArr || []);
    for (const it of all) {
      if (it.type === "folder") folders++;
      else {
        files++;
        bytes += Number(it.size) || 0;
      }
    }
  } catch (e) {
    showToast(`속성을 계산하지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
    return;
  }
  await showInfoDialog(
    `${titleName} 속성\n\n` +
    `종류: ${kind}\n` +
    `위치: ${location}\n` +
    `크기: ${formatBytes(bytes)} (${bytes.toLocaleString("ko-KR")} 바이트)\n` +
    `포함: 파일 ${files.toLocaleString("ko-KR")}개, 폴더 ${folders.toLocaleString("ko-KR")}개`
  );
}

async function showRepoFileProperties(it) {
  if (!it) return;
  const pathArr = it.path || [];
  const location = pathArr.length > 1
    ? ((repoName || "저장소") + "\\" + pathArr.slice(0, -1).join("\\"))
    : (repoName || "저장소");
  const size = Number(it.size) || 0;
  const typeLabel = it.type ? String(it.type).toUpperCase() + " 파일" : "파일";
  const lines = [
    `${it.name} 속성`,
    "",
    `종류: ${typeLabel}`,
    `위치: ${location}`,
    `크기: ${formatBytes(size)} (${size.toLocaleString("ko-KR")} 바이트)`
  ];
  if (it.crc32) lines.push(`CRC32: ${it.crc32}`);
  await showInfoDialog(lines.join("\n"));
}

/* ============ 바탕화면을 트리/경로에 포함시키기 위한 예약 세그먼트 ============
   실제 탐색기의 경로는 항상 "이름의 배열"이다(currentPath, history, dirCache 키, 트리,
   해시 프래그먼트, localStorage 마지막 경로 전부 동일한 방식). 바탕화면(가상 파일시스템)도
   같은 방식으로 다루기 위해, 경로의 첫 번째 칸이 이 예약된 이름이면 "바탕화면 안"이라는
   뜻으로 취급한다 - dfsUniqueName이 같은 부모 안에서 이름을 항상 유일하게 보장하므로,
   진짜 저장소 경로와 완전히 같은 방식(이름만으로 매번 다시 찾기)으로 동작할 수 있다.
   기존 탐색기와 바탕화면(가상) 탐색기를 하나의 창으로 통합하기 위한 기반(사용자 지시). ============ */
// 사용자 지시: "바탕화면"이 아니라 "바탕 화면"(띄어쓰기 있음)이 실제 윈도우 표기와 일치함.
const DESKTOP_TREE_NAME = "바탕 화면";
function isDesktopPath(pathArr) { return pathArr.length > 0 && pathArr[0] === DESKTOP_TREE_NAME; }
// 요청 #113 - 사용자 지시: "휴지통도 탐색기에 합쳐라(그냥 트리에 들어있는거 말고 폴더처럼)".
// 바탕화면과 완전히 같은 방식(예약된 경로 첫 칸)으로 휴지통도 진짜 탐색기 경로처럼 다룬다 -
// dexie 안에서는 그냥 parentId가 DFS_RECYCLEBIN_ROOT인 또 다른 "루트"일 뿐이다.
const RECYCLEBIN_TREE_NAME = "휴지통";
function isRecycleBinPath(pathArr) { return pathArr.length > 0 && pathArr[0] === RECYCLEBIN_TREE_NAME; }
// 바탕화면이든 휴지통이든 - "실제 저장소가 아니라 dexie로 읽어야 하는 경로인가?"를 함께 물어야
// 하는 곳(loadDir 라우팅, 캐시 무효화 등)에서 쓴다.
function isDfsPath(pathArr) { return isDesktopPath(pathArr) || isRecycleBinPath(pathArr); }

/* ============ 색인 제외 규칙 (indexer.ahk가 이미 거르지만, html도 자체적으로 한번 더 거른다) ============
   - 이름에 "_NIH_"가 포함되면(대소문자 무관) 모든 위치에서 제외
     -> indexer.ahk/localserver.ahk/menu_set.json 등/index.html의 JS·CSS는 전부 _NIH_ROOT_
        폴더 안(_NIH_ROOT_/index/menu_set.json 등, _NIH_ROOT_/tools/indexer.ahk,
        _NIH_ROOT_/tools/localserver.ahk, _NIH_ROOT_/index/*.js, _NIH_ROOT_/index/ui/theme/*)에
        있으므로 이 규칙 하나로 자동으로 다 숨겨진다 - 따로 이름을 하나하나 예외 목록에 넣을 필요가 없다
        (사용자 지시로 단순화). 단, GitHub Pages가 이 폴더들을 실제로 서빙하려면 리포 루트에
        .nojekyll 빈 파일이 있어야 한다(Jekyll이 기본적으로 "_"로 시작하는 폴더를 빌드에서 빼버림).
   - "pages.json"은 모든 위치에서 제외
   - 루트에서는 .git / index.html / README.md / 바탕화면 도 추가로 제외
     ("바탕화면"은 트리에 별도 최상위 항목으로 추가되므로, 실제로 같은 이름의 저장소 폴더가 있어도
     루트 목록에는 나타나지 않게 한다 - 이름 충돌 방지. README.md는 GitHub이 저장소 페이지에서
     알아서 보여주는 설명용 파일이라 이 앱 자체 탐색기에는 중복으로 나타날 필요가 없다 - 사용자 지시)
============================================================================================= */
function filterNames(names, pathArr) {
  const isRoot = pathArr.length === 0;
  // 대소문자를 가리지 않고 비교한다 - 예를 들어 실제 저장소의 README 파일이 "readme.md"처럼
  // 소문자로 돼 있으면 정확히 "README.md"와만 비교하는 대소문자 구분 비교로는 못 걸러낸다(버그
  // 리포트: 루트에서 readme.md가 계속 보임). .nojekyll(GitHub Pages가 _NIH_ 폴더를 서빙하게
  // 해주는 설정 파일 - index.html 주석 참고)도 사용자용 색인에는 나올 이유가 없는 저장소 관리용
  // 파일이라 같이 숨긴다.
  const rootOnly = new Set([".git", "index.html", "readme.md", ".nojekyll", DESKTOP_TREE_NAME.toLowerCase(), RECYCLEBIN_TREE_NAME.toLowerCase()]);
  return names.filter(name => {
    if (/_NIH_/i.test(name)) return false;
    if (name === "pages.json") return false;
    if (name === "#hashtag.json") return false; // 요청: 폴더별 태그 저장 파일 - 색인/탐색기 어디에도 안 보여야 함
    if (isRoot && rootOnly.has(name.toLowerCase())) return false;
    return true;
  });
}

/* ============ 상태 ============ */
let repoName = "";
const dirCache = new Map();     // pathKey -> {folders:[...], files:[...]}
let currentPath = [];           // 내용창(오른쪽)에 열려있는 폴더
let selected = null;            // {path, name, type}
let multiSelected = new Set();  // 드래그 다중 선택된 항목들의 path key (내용창)
let expanded = new Set();       // 탐색창(왼쪽)에서 펼쳐진 폴더 pathKey
let treeFileHighlightKey = null; // 탐색창(왼쪽)에서 파란 포커스로 강조 중인 "파일" 행의 pathKey (내용창 선택과는 별개)
let treeFocusKey = null; // 방향키로 옮겨다니는 중인 "키보드 포커스" 행의 key (점선 테두리) - 파란 선택(치)과는 별개.
                          // 실제 윈도우처럼, 방향키는 이 포커스만 옮기고 엔터를 눌러야 비로소 선택(파란 박스)이 확정된다.
let history = [];               // 앱 자체 뒤로/앞으로 스택 (window.history와 다름, 이름 겹침 주의)
let historyIndex = -1;
let currentItems = [];          // 현재 내용창에 그려진 항목들
let currentOpts = {};
let currentHeading = null;
let statusFlashTimer = null;
let toastTimer = null;
let openSubmenuEls = [];

const els = {};
// 요청 #136: 환경설정 패널이 고정 오버레이(#settingsOverlay)에서 앱 내 창(app-window.js)으로
// 바뀌면서, 그 안의 입력들(setTheme/setDoubleClick/...)은 더 이상 페이지 로드 시점에 고정으로
// 존재하지 않는다(창을 열 때만 새로 만들어짐) - 그래서 이 정적 els 목록에서 뺐다. settings-startmenu.js의
// dfInitSettingsWindow(handle)가 열릴 때마다 handle.bodyEl 기준으로 새로 찾아 쓴다.
// settingsMenuRow(시작 메뉴의 "설정" 항목 자체)는 항상 고정으로 있으므로 그대로 둔다.
["winTitle","btnMin","btnMax","btnClose","btnNavToggle","btnBack","btnForward","btnUp",
 "btnRefresh","breadcrumb","searchInput","navPane","contentPane","statusText","repoLink",
 "win","taskbar","taskbarApp","clock","batteryWidget","weatherWidget","titlebar","startBtn","startMenu","startAvatar","startUserName","dfIconLayer",
 "startUserLink","startApps","trayIcons","toast","settingsMenuRow","settingsMenuIcon","themeLink"
].forEach(id => els[id] = document.getElementById(id));
