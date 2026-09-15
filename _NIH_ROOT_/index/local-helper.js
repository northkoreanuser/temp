/* ============ 로컬 헬퍼(localserver.ahk) — 우클릭 "열기"/"다운로드" ============
   HTTPS 페이지에서 http://127.0.0.1로 fetch하는 거라 처음 한 번은 브라우저의
   로컬 네트워크 접근 권한 팝업이 뜬다 (그게 정상). 그래서 페이지 열자마자가
   아니라 실제로 열기/다운로드를 누른 시점에만 확인한다.
================================================================== */
const LOCAL_HELPER_PORT_MIN = 8000; // localserver.ahk와 같은 범위. 고정 포트가 아니라 양쪽 다 이 범위를 스캔해서 맞춘다.
const LOCAL_HELPER_PORT_MAX = 8020;
// 8000~8020 사이에 이미 다른 무관한 프로그램이 떠있을 수 있으므로, 단순 "OK" 응답만으로는
// 그게 우리 헬퍼인지 확신할 수 없다. localserver.ahk의 HELPER_SIGNATURE와 정확히 같은 문자열이어야만 인정한다.
const HELPER_SIGNATURE = "AHK-REPO-INDEXER-LOCALHELPER-v1";
let cachedHelperPort = null; // 한 번 찾으면 이 페이지가 살아있는 동안은 재사용
// 요청 #122(사운드 시나리오): "로컬 헬퍼(웹훅)가 처음 확인됐을 때" 딱 한 번만 알림음을 낸다
// (같은 세션에서 매번 ensureHelperPort를 부를 때마다 울리면 너무 시끄러움).
let dfHelperConnectedOnce = false;
// 요청 #134: 웹훅(로컬 헬퍼)이 이 리포에서(이 브라우저 기준) 통틀어 처음으로 연결된 걸 확인하면,
// 더블클릭 동작을 수동으로 "열기(로컬)"로 바꾸지 않아도 되도록 자동으로 그 설정을 켜준다 - 웹훅을
// 받아서 실행하는 수고를 들인 사람은 당연히 그걸 바로 쓰고 싶어할 거라는 전제. 세션마다 다시
// 켜는 게 아니라 딱 한 번만 하도록(사용자가 나중에 직접 다른 방식으로 바꿔도 계속 존중되도록)
// localStorage에 "이미 자동 활성화했음" 플래그를 남긴다. 이미 "열기(로컬)"였으면(직접 그렇게
// 골랐든, 예전에 이미 자동 활성화됐든) 조용히 플래그만 남기고 설정/토스트는 건드리지 않는다.
function dfWebhookAutoActivatedKey() { return `idx:${repoName}:webhookAutoActivated`; }
function dfAutoActivateHelperSetting() {
  let alreadyDone = false;
  try {
    alreadyDone = localStorage.getItem(dfWebhookAutoActivatedKey()) === "1";
    if (!alreadyDone) localStorage.setItem(dfWebhookAutoActivatedKey(), "1");
  } catch (e) { /* localStorage를 못 쓰면 매번 다시 시도하게 되는 정도라 크게 문제 없음 */ }
  if (alreadyDone || settings.doubleClickAction === "helper") return;
  settings.doubleClickAction = "helper";
  saveSettings();
  dfSettingsReflectDoubleClick("helper"); // 설정창이 이미 열려 있었다면 바로 반영
  // sound를 따로 지정하지 않는다 - 바로 위에서 이미 "webhook_connected" 알림음이 울렸으므로
  // 여기서 또 다른 소리를 겹쳐 울리면 시끄럽기만 하다.
  showToast('로컬 헬퍼가 연결되어, 더블클릭 동작이 자동으로 "열기(로컬)"로 설정되었습니다. 환경설정에서 언제든 바꿀 수 있습니다.', { sticky: true });
}
function dfNoteWebhookConnected() {
  if (dfHelperConnectedOnce) return;
  dfHelperConnectedOnce = true;
  dfsPlaySound("webhook_connected");
  dfAutoActivateHelperSetting();
  // 요청 #152 보강: 웹훅이 한 번이라도 응답하면(포트 스캔 성공 = 헬퍼가 살아 있음) 이미
  // 쓰는 중으로 보고, 페이지 로드시 로컬 웹훅 자동 검사를 켠다. 다운로드 성공/실패와 무관하다
  // - 실패 토스트가 떠도 웹훅이 명령은 받았다는 증거이므로 같은 취급.
  dfNoteWebhookInUse();
}
// 요청 #152: "로컬 웹훅 검사(페이지를 열 때마다 자동으로 헬퍼가 켜져 있는지 미리 확인하는 것)"는
// 기본 꺼짐이지만(브라우저 로컬 네트워크 접근 팝업 등이 번거로울 수 있어서), 웹훅이 한 번이라도
// 응답하면 - 성공 다운로드든, 실패/오류든, 연결 확인이든 - "이 사람은 이미 헬퍼를 쓰고 있구나"로
// 보고 그때부터 자동으로 켠다. 요청 #134(더블클릭 동작 자동 전환)와는 완전히 별개 기능이라
// 서로 건드리지 않는다. 한 번 켜지면 계속 켜진 채로 저장되므로 이후에는 조용히 아무 일도 안 한다.
function dfNoteWebhookInUse() {
  if (settings.checkHelperOnLoad) return;
  settings.checkHelperOnLoad = true;
  saveSettings();
  if (typeof dfSettingsReflectCheckHelperOnLoad === "function") dfSettingsReflectCheckHelperOnLoad(true);
}
// 하위 호환 별칭(기존 호출부 유지). 이제는 성공만이 아니라 웹훅 사용 자체가 기준이다.
function dfNoteWebhookDownloadSucceeded() { dfNoteWebhookInUse(); }

/* ============ 도구 파일 실제 위치 (base64 내장 대신 저장소의 진짜 파일을 그대로 가리킴) ============
   예전엔 index.html 안에 localserver.ahk/indexer.ahk를 base64로 통째로 내장해서(VIRTUAL_FILES)
   "루트에 항상 있는 가상 파일"처럼 보여줬는데, 파일이 바뀔 때마다 base64도 같이 다시 만들어
   넣어야 해서 유지보수가 나빴다(사용자 지시로 제거). 대신 이 두 파일은 저장소의
   _NIH_ROOT_/tools/ 폴더에 실제 파일로 둔다 - _NIH_ROOT_는 이름에 "_NIH_"가 들어있어서
   filterNames가 이미 모든 위치에서 통째로 숨겨주므로(탐색기 트리/검색 어디에도 안 나타남),
   "가상 파일"처럼 따로 특별 취급할 필요가 없다. GitHub Pages는 색인(pages.json)과 무관하게
   저장소의 모든 실제 파일을 그대로 서빙하므로, 경로만 알면(absoluteFileUrl) 내려받는 데
   아무 문제가 없다. ============ */
const LOCALSERVER_TOOL_PATH = ["_NIH_ROOT_", "tools", "localserver.ahk"];
const GITTOOL_TOOL_PATH = ["_NIH_ROOT_", "tools", "Git 올인원.cmd"];
// 로컬 헬퍼 없이(당연히 - 헬퍼가 없어서 이 함수를 부르는 상황이므로) 브라우저 자체 다운로드로
// 저장소의 실제 파일을 바로 내려받는다. localHelperDownload를 거치면 헬퍼가 없을 때 다시
// offerHelperDownload를 부르는 순환에 빠지므로, 일부러 별도 경로로 둔다(닭과 달걀 문제 회피).
function downloadRealFileDirect(pathArr, filename) {
  const a = document.createElement("a");
  a.href = absoluteFileUrl(pathArr);
  a.download = filename || pathArr[pathArr.length - 1];
  document.body.appendChild(a);
  a.click();
  a.remove();
}
/* 웹훅(localserver.ahk)이 필요한 동작(열기/다운로드 등)인데 실행 중인 게 안 잡힐 때: 브라우저
   기본 alert 대신, 이 앱의 다른 대화상자들과 똑같은 CSS 커스텀 확인창(Windows 스타일 질문
   창)으로 "받으시겠습니까?"를 직접 물어본다(사용자 지시) - "받기"를 누르면 즉시 내려받고,
   받은 뒤 실행해서 해당 동작을 다시 시도하도록 안내한다. */
async function offerHelperDownload(actionLabel) {
  const ok = await showConfirmDialog(
    `"${actionLabel}" 기능에는 로컬 헬퍼(localserver.ahk)가 필요한데, 실행 중인 것을 찾지 못했습니다.\n\nlocalserver.ahk를 받으시겠습니까? 받은 뒤 실행하고 "${actionLabel}"를 다시 시도해주세요.`,
    { okLabel: "받기", cancelLabel: "취소" }
  );
  if (ok) downloadRealFileDirect(LOCALSERVER_TOOL_PATH, "localserver.ahk");
}

function absoluteFileUrl(path) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  return base + path.map(encodeURIComponent).join("/");
}
async function pingPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return false;
    const text = await res.text();
    return text.trim() === HELPER_SIGNATURE;
  } catch (e) {
    return false;
  }
}
// 8000~8020을 전부 동시에 스캔해서(끝까지 기다림) 우리 서명으로 응답한 포트들을 오름차순으로 반환한다.
// 웹훅이 실수로 중복 실행됐을 수도 있으므로(예: 스크립트를 두 번 실행) "가장 먼저 응답한 포트"가 아니라
// "가장 낮은 포트 번호"를 정본으로 삼아야 하고, 중복 실행 여부도 판단해야 하므로 race가 아니라 전수 스캔한다.
async function scanAllHelperPorts() {
  const ports = [];
  for (let p = LOCAL_HELPER_PORT_MIN; p <= LOCAL_HELPER_PORT_MAX; p++) ports.push(p);
  const results = await Promise.all(ports.map(p => pingPort(p).then(ok => ok ? p : null)));
  return results.filter(p => p !== null).sort((a, b) => a - b);
}
// 기존 호출부(ensureHelperPort 등) 호환용: 전수 스캔해서 가장 낮은 포트(없으면 null)만 돌려준다.
async function scanForHelperPort() {
  const found = await scanAllHelperPorts();
  return found.length ? found[0] : null;
}
async function ensureHelperPort() {
  if (cachedHelperPort !== null && (await pingPort(cachedHelperPort))) return cachedHelperPort;
  cachedHelperPort = await scanForHelperPort();
  if (cachedHelperPort !== null) dfNoteWebhookConnected();
  return cachedHelperPort;
}
// 특정 포트에 종료 요청을 보낸다 (응답이 오든 안 오든, 연결이 끊기든 상관없이 실패는 그냥 무시한다 -
// 어차피 목적은 "떠 있으면 끄기"이고, 이미 꺼져있었다면 애초에 에러가 나는 게 정상이다).
async function killHelperPort(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/kill`, { signal: AbortSignal.timeout(800) });
  } catch (e) { /* 무시 - 응답 전에 프로세스가 죽거나(정상), 애초에 그 포트에 아무것도 없거나 */ }
}
// 환경설정의 "웹훅 종료" 버튼: 혹시 몇 개가 떠있는지 몰라도 되도록 범위 전체에 킬을 날린다.
async function killAllHelperPorts() {
  const ports = [];
  for (let p = LOCAL_HELPER_PORT_MIN; p <= LOCAL_HELPER_PORT_MAX; p++) ports.push(p);
  await Promise.allSettled(ports.map(p => killHelperPort(p)));
  cachedHelperPort = null;
}
// 페이지 로드시 호출: 실수로 localserver.ahk가 두 번 이상 실행됐을 수 있으므로(두 번째는 더 높은
// 포트를 잡음) 전수 스캔해서 하나보다 많이 발견되면 가장 낮은 포트만 남기고 나머지는 모두 끈다.
async function initHelperPortAndCollapseDuplicates() {
  const found = await scanAllHelperPorts();
  if (found.length === 0) { cachedHelperPort = null; return; }
  cachedHelperPort = found[0];
  dfNoteWebhookConnected();
  if (found.length > 1) {
    const extras = found.slice(1);
    await Promise.allSettled(extras.map(p => killHelperPort(p)));
    showToast(`로컬 헬퍼가 여러 개 실행 중이어서(포트 ${found.join(", ")}) 가장 낮은 포트(${found[0]})만 남기고 정리했습니다.`);
  }
}
function sizeQueryParam(it) {
  return (it && it.size > 0) ? `&size=${encodeURIComponent(it.size)}` : "";
}
async function localHelperOpen(it) {
  const port = await ensureHelperPort();
  if (port === null) { offerHelperDownload("열기"); return; }
  const url = absoluteFileUrl(it.path);
  showToast(`여는 중: ${it.name}`, { sound: "download_start" });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/open?url=${encodeURIComponent(url)}${sizeQueryParam(it)}`);
    if (!res.ok) throw new Error(String(res.status));
    showToast(`열었습니다: ${it.name}`, { sound: "download_complete" });
  } catch (e) {
    showToast(`여는 중 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
  }
}
async function localHelperDownload(it) {
  const port = await ensureHelperPort();
  if (port === null) { offerHelperDownload("다운로드"); return; }
  const url = absoluteFileUrl(it.path);
  showToast(`저장 위치를 선택하세요: ${it.name}`, { sound: "download_start" });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/download?url=${encodeURIComponent(url)}${sizeQueryParam(it)}`);
    const text = await res.text();
    if (!res.ok) throw new Error(String(res.status));
    const cancelled = text.includes("CANCELLED");
    if (!cancelled) dfNoteWebhookDownloadSucceeded(); // 요청 #152
    showToast(cancelled ? "다운로드가 취소되었습니다." : `다운로드 완료: ${it.name}`, { sound: cancelled ? "download_cancel" : "download_complete" });
  } catch (e) {
    showToast(`다운로드 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
  }
}
/* ============ 폴더 통째로 다운로드(재귀) - 실제 저장소 폴더 ============
   사용자 지시: "웹훅 서버에 폴더 이름과 파일을 던져주면 웹훅이 알아서 지정된 폴더에 만들고
   순차 다운로드를 하면 된다(브라우저측에서 다운로드 중단 가능)". crawlAll(search-and-status.js)로
   그 폴더 밑의 모든 하위 폴더/파일을 먼저 알아낸 다음, /pickfolder로 저장 위치를 한 번만 고르고
   /mkdir로 폴더 구조를 그대로 만든 뒤 /savetopath로 파일을 하나씩 그 자리에 내려받는다. */
async function downloadFolderRecursive(it) {
  const port = await ensureHelperPort();
  if (port === null) { offerHelperDownload("폴더 다운로드"); return; }

  showToast(`"${it.name}" 폴더 내용을 확인하는 중...`, { sound: "download_start" });
  let entries;
  try {
    entries = await crawlAll(it.path);
  } catch (e) {
    showToast(`폴더 내용을 읽지 못했습니다: ${e.message}`, { kind: "warn", sound: "download_error" });
    return;
  }
  const folders = entries.filter(en => en.type === "folder");
  const files = entries.filter(en => en.type !== "folder");

  let baseRoot;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pickfolder`);
    baseRoot = (await res.text()).trim();
  } catch (e) {
    showToast(`폴더 선택 중 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
    return;
  }
  if (!baseRoot || baseRoot === "CANCELLED") { showToast("다운로드가 취소되었습니다.", { sound: "download_cancel" }); return; }

  const relPrefix = it.name; // 고른 위치 바로 밑에 이 폴더 이름으로 최상위 폴더를 만들고 그 안에 구조를 재현
  const dlg = showCancelableProgressDialog(`"${it.name}" 폴더 다운로드 준비 중...`);
  try {
    const mkRoot = await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(relPrefix)}`);
    if (!mkRoot.ok) throw new Error(String(mkRoot.status));
    // 안에 파일이 하나도 없는 빈 하위 폴더도 그대로 재현되도록, 모든 하위 폴더를 파일보다 먼저 만든다.
    for (const f of folders) {
      if (dlg.isCancelled()) { showToast("폴더 다운로드가 취소되었습니다.", { sound: "download_cancel" }); return; }
      const rel = relPrefix + "/" + f.path.slice(it.path.length).join("/");
      dlg.setText(`폴더 만드는 중: ${f.name}`);
      await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}`);
    }
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      if (dlg.isCancelled()) { showToast(`폴더 다운로드가 취소되었습니다. (${ok}개 저장됨)`, { sound: "download_cancel" }); return; }
      const f = files[i];
      const rel = relPrefix + "/" + f.path.slice(it.path.length).join("/");
      dlg.setText(`다운로드 중 (${i + 1}/${files.length}): ${f.name}`);
      const url = absoluteFileUrl(f.path);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/savetopath?url=${encodeURIComponent(url)}&base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}${sizeQueryParam(f)}`);
        if (!res.ok) throw new Error(String(res.status));
        ok++;
      } catch (e) { fail++; }
    }
    if (ok > 0) dfNoteWebhookDownloadSucceeded(); // 요청 #152
    showToast(`"${it.name}" 폴더 다운로드 완료: ${ok}개${fail ? `, 실패 ${fail}개` : ""}`, fail ? { kind: "warn", sound: "download_error" } : { sound: "download_complete" });
  } finally {
    dlg.close();
  }
}

/* ============ 폴더 통째로 다운로드(재귀) - 바탕 화면 가상 폴더, 헬퍼 방식 ============
   사용자 지시: "바탕 화면은 방법 두 개 넣기. zip 혹은 헬퍼(다운로드는 하나지만 받을때 묻기)".
   실제 저장소 폴더의 downloadFolderRecursive와 뼈대(pickfolder로 저장 위치 한 번만 고르고
   mkdir로 폴더 구조부터 재현한 뒤 파일을 하나씩 내려받음)는 같지만, 바탕 화면 가상 파일은
   서버에 실제 URL이 없어(dexie 안 content) /savetopath처럼 "url을 다시 받아오는" 방식이
   안 된다 - 대신 이미 갖고 있는 내용을 /savecontentto로 그대로 POST해서 base\rel 경로에 쓴다
   (localHelperSaveContent가 단일 파일에 하는 것과 같은 방식을, 대화상자 없이 폴더 구조
   그대로 재현하도록 확장한 것). */
async function dfsDownloadFolderViaHelper(node) {
  const port = await ensureHelperPort();
  if (port === null) { offerHelperDownload("폴더 다운로드"); return; }

  const files = [];
  const folders = [];
  await dfsCollectFolderTree(node, "", files, folders);

  let baseRoot;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/pickfolder`);
    baseRoot = (await res.text()).trim();
  } catch (e) {
    showToast(`폴더 선택 중 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
    return;
  }
  if (!baseRoot || baseRoot === "CANCELLED") { showToast("다운로드가 취소되었습니다.", { sound: "download_cancel" }); return; }

  const relPrefix = node.name; // 고른 위치 바로 밑에 이 폴더 이름으로 최상위 폴더를 만들고 그 안에 구조를 재현
  const dlg = showCancelableProgressDialog(`"${node.name}" 폴더 다운로드 준비 중...`);
  try {
    const mkRoot = await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(relPrefix)}`);
    if (!mkRoot.ok) throw new Error(String(mkRoot.status));
    // 안에 파일이 하나도 없는 빈 하위 폴더도 그대로 재현되도록, 모든 하위 폴더를 파일보다 먼저 만든다.
    for (const f of folders) {
      if (dlg.isCancelled()) { showToast("폴더 다운로드가 취소되었습니다.", { sound: "download_cancel" }); return; }
      const rel = relPrefix + "/" + f;
      dlg.setText(`폴더 만드는 중: ${f}`);
      await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}`);
    }
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      if (dlg.isCancelled()) { showToast(`폴더 다운로드가 취소되었습니다. (${ok}개 저장됨)`, { sound: "download_cancel" }); return; }
      const f = files[i];
      const rel = relPrefix + "/" + f.path;
      dlg.setText(`다운로드 중 (${i + 1}/${files.length}): ${f.path}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/savecontentto?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}`, {
          method: "POST",
          body: f.content ?? ""
        });
        if (!res.ok) throw new Error(String(res.status));
        ok++;
      } catch (e) { fail++; }
    }
    if (ok > 0) dfNoteWebhookDownloadSucceeded(); // 요청 #152
    showToast(`"${node.name}" 폴더 다운로드 완료: ${ok}개${fail ? `, 실패 ${fail}개` : ""}`, fail ? { kind: "warn", sound: "download_error" } : { sound: "download_complete" });
  } finally {
    dlg.close();
  }
}

/* ============ 다중 선택 다운로드에 폴더 포함 (요청 #115) ============
   위 두 함수(downloadFolderRecursive/dfsDownloadFolderViaHelper)는 "폴더 하나"를 우클릭으로
   다운로드할 때 자기가 직접 /pickfolder로 저장 위치를 고르지만, 다중 선택 다운로드
   (content-pane.js의 handleMultiDownload)는 파일+폴더가 섞여 있어도 한 번 고른 위치 하나에
   전부 담아야 하므로 항목(폴더)마다 /pickfolder를 다시 부를 수 없다. 그래서 "이미 골라둔
   baseRoot 아래에 폴더 하나를 그대로 재현한다"는 부분만 떼어내 재사용 가능하게 만든다 - mkdir/
   savetopath/savecontentto 호출 방식은 위 두 함수와 완전히 같다(다만 다중 선택은 진행률
   대화상자 하나를 모든 항목이 함께 쓰므로 dlg를 인자로 받는다). */
async function downloadRealFolderIntoBase(it, port, baseRoot, dlg) {
  const entries = await crawlAll(it.path);
  const folders = entries.filter(en => en.type === "folder");
  const files = entries.filter(en => en.type !== "folder");
  const relPrefix = it.name; // 고른 위치 바로 밑에 이 폴더 이름으로 하위 폴더를 만들고 그 안에 구조를 재현
  const mkRoot = await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(relPrefix)}`);
  if (!mkRoot.ok) throw new Error(String(mkRoot.status));
  for (const f of folders) {
    if (dlg.isCancelled()) return { cancelled: true, ok: 0, fail: 0 };
    const rel = relPrefix + "/" + f.path.slice(it.path.length).join("/");
    dlg.setText(`폴더 만드는 중: ${f.name}`);
    await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}`);
  }
  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    if (dlg.isCancelled()) return { cancelled: true, ok, fail };
    const f = files[i];
    const rel = relPrefix + "/" + f.path.slice(it.path.length).join("/");
    dlg.setText(`다운로드 중 (${i + 1}/${files.length}): ${f.name}`);
    const url = absoluteFileUrl(f.path);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/savetopath?url=${encodeURIComponent(url)}&base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}${sizeQueryParam(f)}`);
      if (!res.ok) throw new Error(String(res.status));
      ok++;
    } catch (e) { fail++; }
  }
  return { cancelled: false, ok, fail };
}
async function dfsDownloadFolderIntoBase(node, port, baseRoot, dlg) {
  const files = [];
  const folders = [];
  await dfsCollectFolderTree(node, "", files, folders);
  const relPrefix = node.name;
  const mkRoot = await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(relPrefix)}`);
  if (!mkRoot.ok) throw new Error(String(mkRoot.status));
  for (const f of folders) {
    if (dlg.isCancelled()) return { cancelled: true, ok: 0, fail: 0 };
    const rel = relPrefix + "/" + f;
    dlg.setText(`폴더 만드는 중: ${f}`);
    await fetch(`http://127.0.0.1:${port}/mkdir?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}`);
  }
  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    if (dlg.isCancelled()) return { cancelled: true, ok, fail };
    const f = files[i];
    const rel = relPrefix + "/" + f.path;
    dlg.setText(`다운로드 중 (${i + 1}/${files.length}): ${f.path}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/savecontentto?base=${encodeURIComponent(baseRoot)}&rel=${encodeURIComponent(rel)}`, { method: "POST", body: f.content ?? "" });
      if (!res.ok) throw new Error(String(res.status));
      ok++;
    } catch (e) { fail++; }
  }
  return { cancelled: false, ok, fail };
}

// 브라우저 자체 저장소(바탕화면 가상 파일시스템)에만 있는 파일은 서버에 URL이 없으므로
// /download처럼 url= 파라미터로 받아올 수 없다. 대신 이미 갖고 있는 내용을 그대로 로컬
// 헬퍼에 POST로 보내고, 헬퍼가 저장 대화상자를 띄워서 저장한다.
async function localHelperSaveContent(name, content) {
  const port = await ensureHelperPort();
  if (port === null) { offerHelperDownload("다운로드"); return; }
  showToast(`저장 위치를 선택하세요: ${name}`, { sound: "download_start" });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/savecontent?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: content ?? ""
    });
    const text = await res.text();
    if (!res.ok) throw new Error(String(res.status));
    const cancelled = text.includes("CANCELLED");
    if (!cancelled) dfNoteWebhookDownloadSucceeded(); // 요청 #152
    showToast(cancelled ? "다운로드가 취소되었습니다." : `다운로드 완료: ${name}`, { sound: cancelled ? "download_cancel" : "download_complete" });
  } catch (e) {
    showToast(`다운로드 오류: ${e.message}`, { kind: "warn", sound: "download_error" });
  }
}

