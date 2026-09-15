/* ============================================================================
   내장 에디터 (옵시디언 스타일 마크다운/HTML/텍스트 에디터)
   ----------------------------------------------------------------------------
   업로드받은 원본 에디터의 markdown()/inline()/isFenceOpen() 파서, HTML 샌드박스
   미리보기, 코드블록 복사, 굵게/기울임/링크 단축키, 상태줄(글자수 등), M/H/T 렌더
   모드 순환, 뷰어/에디터 토글, 테마를 그대로 옮겨왔다. 단, 주소창(#) 압축 저장/공유
   엔진만은 빼고 그 자리를 대신해 dexie 자동저장(가상 파일)으로 대체했다 - 이 페이지가
   이미 #을 경로/트리 상태 저장용으로 쓰고 있어서 중복 구현이 불가능하기 때문(사용자 지시).
================================================================================= */
function dfEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function dfInline(s) {
  s = dfEsc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^ )]+)(?:\s+"([^"]*)")?\)/g, (_, a, u, t) => `<img src="${u}" alt="${a}"${t ? ` title="${t}"` : ""}>`);
  s = s.replace(/\[([^\]]+)\]\(([^ )]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(`{1,3})([\s\S]*?)\1(?!`)/g, (_, fence, content) => {
    let c = content;
    if (fence.length > 1 && /^ /.test(c) && / $/.test(c) && c.trim() !== "") c = c.slice(1, -1);
    return `<code>${c}</code>`;
  });
  s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_, t) => `<strong><em>${t}</em></strong>`);
  s = s.replace(/___([\s\S]+?)___/g, (_, t) => `<strong><em>${t}</em></strong>`);
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, (_, inner) => `<strong>${inner.replace(/\*([^*]+)\*/g, "<em>$1</em>")}</strong>`);
  s = s.replace(/__([\s\S]+?)__/g, (_, inner) => `<strong>${inner.replace(/_([^_]+)_/g, "<em>$1</em>")}</strong>`);
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  s = s.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s;
}
function dfIsFenceOpen(l) {
  if (!/^```/.test(l)) return false;
  return !l.slice(3).includes("```");
}
function dfMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n"), out = [];
  let i = 0, inCode = false, codeLang = "", code = [];
  function pushCodeBlock() {
    let lang = codeLang, content = code;
    if (content.length === 0 && lang) { content = [lang]; lang = ""; }
    out.push(`<div class="df-e-codewrap"><button type="button" class="df-e-code-copy" title="코드 복사">[C]</button><pre><code class="language-${dfEsc(lang)}">${dfEsc(content.join("\n"))}</code></pre></div>`);
    inCode = false; codeLang = ""; code = [];
  }
  while (i < lines.length) {
    let l = lines[i];
    if (!inCode && dfIsFenceOpen(l)) { inCode = true; codeLang = l.replace(/^```/, "").trim(); code = []; i++; continue; }
    if (inCode && /^```\s*$/.test(l)) { pushCodeBlock(); i++; continue; }
    if (inCode && /```\s*$/.test(l)) { code.push(l.replace(/```\s*$/, "")); pushCodeBlock(); i++; continue; }
    if (inCode) { code.push(l); i++; continue; }
    if (/^ {0,3}#{1,6}\s+/.test(l)) {
      const m = l.match(/^ {0,3}(#{1,6})\s+(.*)$/), n = m[1].length;
      out.push(`<h${n}>${dfInline(m[2].replace(/\s+#+\s*$/, ""))}</h${n}>`); i++; continue;
    }
    if (/^---+$/.test(l.trim())) {
      let end = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "") break;
        if (/^---+$/.test(lines[j].trim())) { end = j; break; }
      }
      if (end > i + 1) {
        const rows = lines.slice(i + 1, end).map(x => {
          const m = x.match(/^\s*([^:]+):\s*(.*)$/);
          return m ? `<tr><th>${dfEsc(m[1].trim())}</th><td>${dfEsc(m[2].trim())}</td></tr>` : `<tr><td colspan="2">${dfEsc(x)}</td></tr>`;
        }).join("");
        out.push(`<table class="frontmatter">${rows}</table>`);
        i = end + 1; continue;
      }
      out.push("<hr>"); i++; continue;
    }
    if (/^\*\*\*+$/.test(l.trim())) { out.push("<hr>"); i++; continue; }
    if (/^>\s?/.test(l)) {
      const q = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${q.map(x => `<p>${dfInline(x)}</p>`).join("")}</blockquote>`); continue;
    }
    if (/^\s*[-*+]\s+/.test(l)) {
      const items = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        let x = lines[i].replace(/^\s*[-*+]\s+/, "");
        const task = x.match(/^\[([ xX])\]\s+(.*)$/);
        items.push(task ? `<li class="task"><input type="checkbox" ${task[1].toLowerCase() === "x" ? "checked" : ""} disabled>${dfInline(task[2])}</li>` : `<li>${dfInline(x)}</li>`); i++;
      }
      out.push(`<ul>${items.join("")}</ul>`); continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      const items = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(`<li>${dfInline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`); i++; }
      out.push(`<ol>${items.join("")}</ol>`); continue;
    }
    if (l.trim() === "") { i++; continue; }
    if (l.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(lines[i + 1])) {
      const split = x => x.trim().replace(/^\||\|$/g, "").split("|").map(v => v.trim());
      const heads = split(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") { rows.push(split(lines[i])); i++; }
      out.push(`<table><thead><tr>${heads.map(x => `<th>${dfInline(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${heads.map((_, k) => `<td>${dfInline(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`); continue;
    }
    const para = [l]; i++; while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6})\s|^>|^\s*[-*+]\s|^\s*\d+\.\s/.test(lines[i]) && !/^---+$|^\*\*\*+$/.test(lines[i].trim()) && !dfIsFenceOpen(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${para.map(dfInline).join("<br>")}</p>`);
  }
  if (inCode) pushCodeBlock();
  return out.join("");
}

function dfDetectFileType(name) {
  if (/\.md$/i.test(name)) return "md";
  if (/\.html?$/i.test(name)) return "html";
  return "txt";
}
function dfInitialRenderMode(fileType) {
  return fileType === "md" ? "markdown" : fileType === "html" ? "html" : "text";
}
function dfFallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.cssText = "position:fixed;opacity:0;left:-9999px;top:-9999px";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}
function dfCopyText(text, onDone) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => { dfFallbackCopy(text); onDone(); });
  } else { dfFallbackCopy(text); onDone(); }
}

// 실제 리포 파일이 텍스트인지 이진 파일인지 판별: 출력 불가능한 문자(NUL 포함) 비율이
// 너무 높으면 "텍스트 아님"으로 본다 (JS fetch로 내려받은 내용을 검사). 예전엔 NUL 바이트가
// 하나만 있어도 즉시 이진 파일로 확정해버려서, 끝에 우연히 널 패딩이 조금 남은 평범한 텍스트/ini
// 파일(스톱워치.ini 등)까지 "텍스트 아님"으로 오판해 아예 열 수 없게 만드는 문제가 있었다.
// 이제는 NUL도 다른 제어문자와 똑같이 비율로만 판단하고, 그래도 이진으로 의심되면(false 반환)
// 호출부에서 무조건 막지 않고 사용자에게 강제로 열지 물어보게 해서 오탐이 있어도 막다른 골목이
// 되지 않게 한다.
function dfLooksLikeText(sampleText) {
  const len = sampleText.length;
  if (len === 0) return true;
  let weird = 0;
  for (let i = 0; i < len; i++) {
    const c = sampleText.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue; // 탭/개행/캐리지리턴은 정상
    if (c === 0xFFFD) continue; // UTF-8이 아닌 인코딩(EUC-KR/CP949 등)으로 저장된 텍스트 파일의 대체문자는 이진 신호로 안 침
    if (c < 32 || c === 127) weird++;
  }
  return (weird / len) < 0.05;
}

/* ---------------- 렌더 모드 순환(M/H/T) + 뷰어/에디터 토글 + 상태줄 등 전체 에디터 뷰 ---------------- */
/* ============================================================================
   에디터 = 앱 내 창 (요청 #135)
   예전엔 완전히 별개의 브라우저 새 탭(about:blank + document.write)으로 열렸지만, 이제 이 문서
   자신의 DOM 안에 app-window.js의 dfCreateAppWindow로 만든 "진짜 창처럼" 뜨는 패널로 연다.
   window.opener 간접호출(opener.dfsSaveNodeContent 등)이 필요 없어졌다 - 같은 문서 안이므로
   그 함수들을 그냥 직접 부른다. 파일을 여러 개 동시에 열 수 있어야 하므로(멀티 인스턴스) 아래
   dfInitEditorWindow는 전역 document가 아니라 자기 창의 bodyEl(root)로 모든 조회를 한정한다 -
   그래야 에디터 창을 두 개 이상 띄워도 서로 간섭하지 않는다(반대로 메뉴 메이커는 한 번에 하나만
   뜨는 싱글턴이라 그렇게까지 엄격하게 스코프할 필요가 없다). --------------------------------- */
const DF_EDITOR_PAGE_CSS = `
  html, body { margin: 0; height: 100%; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .df-editor { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; background: var(--df-bg, #14161b); color: var(--df-text, #d7dae0); }
  .df-editor[data-theme="light"] { --df-bg: #f7f7f8; --df-panel: #ffffff; --df-panel2: #eef0f3; --df-border: #dde1e7; --df-text: #20242b; --df-muted: #6a7180; --df-accent: #7c5cf0; --df-accent2: #6247c4; --df-code: #f1f2f5; --df-code-text: #2a2e37; --df-inline-code-bg: #e6e8ed; --df-quote: #7c5cf0; --df-quote-text: #4a4f5a; --df-quote-bg: #00000006; --df-heading: #14161b; --df-hover-bg: #00000009; }
  .df-editor:not([data-theme="light"]) { --df-bg: #14161b; --df-panel: #181b21; --df-panel2: #1d2129; --df-border: #2b3039; --df-text: #d7dae0; --df-muted: #858c99; --df-accent: #8b7cf6; --df-accent2: #a89dff; --df-code: #0d0f13; --df-code-text: #d5d9e1; --df-inline-code-bg: #242832; --df-quote: #858cff; --df-quote-text: #aeb3be; --df-quote-bg: #ffffff03; --df-heading: #f0f1f4; --df-hover-bg: #ffffff08; }
  .df-editor { background: var(--df-bg); color: var(--df-text); }
  .df-editor-top { height: 42px; flex: 0 0 42px; display: flex; align-items: center; gap: 8px; padding: 0 10px; background: var(--df-panel); border-bottom: 1px solid var(--df-border); -webkit-app-region: drag; }
  .df-editor-top .df-e-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
  .df-editor-top .df-spacer { flex: 1; }
  .df-editor-top button { border: 1px solid var(--df-border); background: transparent; color: var(--df-muted); height: 28px; padding: 0 8px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12.5px; }
  .df-editor-top button:hover { background: var(--df-hover-bg); color: var(--df-text); }
  .df-editor-body { flex: 1; min-height: 0; display: flex; position: relative; }
  .df-editor.textmode .df-e-preview { display: none !important; }
  .df-editor:not(.textmode) .df-e-editor { border-right: 1px solid var(--df-border); }
  .df-e-editor, .df-e-preview { min-width: 0; flex: 1; overflow: auto; position: relative; }
  .df-editor.viewer .df-e-editor { display: none; }
  .df-e-editor textarea { width: 100%; height: 100%; box-sizing: border-box; resize: none; border: 0; outline: 0; background: transparent; color: var(--df-text); font: 14px/1.7 "SFMono-Regular",Consolas,"Liberation Mono",monospace; padding: 18px 22px; }
  .df-e-preview-inner { max-width: 860px; margin: auto; padding: 28px 34px 60px; font-size: 15px; line-height: 1.75; }
  .df-e-preview-inner h1,.df-e-preview-inner h2,.df-e-preview-inner h3,.df-e-preview-inner h4,.df-e-preview-inner h5,.df-e-preview-inner h6{ line-height: 1.25; color: var(--df-heading); margin: 1.4em 0 .5em; }
  .df-e-preview-inner h1{font-size:1.9em}.df-e-preview-inner h2{font-size:1.5em}.df-e-preview-inner h3{font-size:1.2em}
  .df-e-preview-inner p{margin:.7em 0}.df-e-preview-inner a{color:var(--df-accent2)}
  .df-e-preview-inner blockquote{border-left:3px solid var(--df-quote);margin:1em 0;padding:.15em 1em;color:var(--df-quote-text);background:var(--df-quote-bg)}
  .df-e-preview-inner code{font:.9em "SFMono-Regular",Consolas,monospace;background:var(--df-inline-code-bg);color:var(--df-text);border-radius:5px;padding:.15em .38em}
  .df-e-preview-inner pre{background:var(--df-code);border:1px solid var(--df-border);border-radius:9px;padding:14px;overflow:auto}
  .df-e-preview-inner pre code{background:transparent;padding:0;color:var(--df-code-text)}
  .df-e-preview-inner ul,.df-e-preview-inner ol{padding-left:1.6em}
  .df-e-preview-inner table{border-collapse:collapse;width:100%;margin:1em 0}
  .df-e-preview-inner th,.df-e-preview-inner td{border:1px solid var(--df-border);padding:7px 9px;text-align:left}
  .df-e-preview-inner th{background:var(--df-panel2)}
  .df-e-preview-inner hr{border:0;border-top:1px solid var(--df-border);margin:1.8em 0}
  .df-e-preview-inner img{max-width:100%;border-radius:8px}
  .df-e-codewrap{position:relative}
  .df-e-code-copy{position:absolute;top:8px;right:8px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:1px solid var(--df-border);background:var(--df-panel);color:var(--df-muted);border-radius:6px;cursor:pointer;opacity:0;transition:opacity .12s;font-size:12px}
  .df-e-codewrap:hover .df-e-code-copy{opacity:1}
  .df-e-code-copy.copied{opacity:1;color:var(--df-accent)}
  .df-e-html-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
  .df-editor-status { height: 24px; flex: 0 0 24px; border-top: 1px solid var(--df-border); background: var(--df-panel); color: var(--df-muted); display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 0 10px; font-size: 10.5px; font-family: "SFMono-Regular",Consolas,monospace; }
`;

// 에디터 창 본문 HTML(창 자체의 타이틀바/이동/크기조절/닫기는 app-window.js의 dfCreateAppWindow가
// 담당하므로, 여기서는 그 .app-win-body 안에 들어갈 내용만 만든다).
function dfsBuildEditorBodyHtml(theme) {
  return `
    <div class="df-editor" data-theme="${theme}">
      <div class="df-editor-top">
        <button class="df-e-mode" title="렌더 모드 전환"></button>
        <button class="df-e-toggle" title="에디터/뷰어 전환">O</button>
        <span class="df-e-name"></span>
        <span class="df-spacer"></span>
        <button class="df-e-theme" title="테마 전환">T</button>
        <button class="df-e-copyall" title="전체 복사">[C]</button>
        <button class="df-e-save" title="지금 저장(Ctrl+S) - 이 가짜 PC의 바탕 화면에 저장됩니다">저장</button>
        <button class="df-e-download" title="다운로드 - 웹훅이 켜져 있으면 웹훅으로, 아니면 브라우저 다운로드로">다운로드</button>
      </div>
      <div class="df-editor-body">
        <div class="df-e-editor"><textarea spellcheck="false"></textarea></div>
        <div class="df-e-preview">
          <div class="df-e-preview-inner"></div>
          <iframe class="df-e-html-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" title="HTML 미리보기(샌드박스)" style="display:none;"></iframe>
        </div>
      </div>
      <div class="df-editor-status">
        <span class="df-e-chars"></span><span class="df-e-words"></span><span class="df-e-pos"></span>
        <span class="df-e-savestate"></span>
      </div>
    </div>`;
}

// 에디터 창 하나의 실제 동작을 연결한다. root는 그 창의 .app-win-body(dfCreateAppWindow가 준
// handle.bodyEl)로, 모든 조회를 이 안으로 한정해서 에디터를 여러 개 동시에 열어도 서로 절대
// 간섭하지 않는다(예전 새 탭 방식은 탭마다 자기 document가 따로였어서 자동으로 격리됐지만,
// 이제는 한 문서 안에 여러 창이 같이 있으므로 직접 스코프를 지켜줘야 한다).
function dfInitEditorWindow(handle, NODE, state) {
  const root = handle.bodyEl;
  const RENDER_MODES = ["markdown", "html", "text"];
  const RENDER_LABELS = { markdown: "M", html: "H", text: "T" };
  const RENDER_TITLES = { markdown: "HTML 뷰어로 전환", html: "텍스트 모드로 전환", text: "Markdown 뷰어로 전환" };
  let renderMode = dfInitialRenderMode(NODE.fileType);
  let viewerMode = false;

  const wrap = root.querySelector(".df-editor");
  const nameEl = root.querySelector(".df-e-name");
  nameEl.textContent = NODE.name;
  const ta = root.querySelector(".df-e-editor textarea");
  const previewInner = root.querySelector(".df-e-preview-inner");
  const htmlFrame = root.querySelector(".df-e-html-frame");
  const modeBtn = root.querySelector(".df-e-mode");
  const toggleBtn = root.querySelector(".df-e-toggle");
  const themeBtn = root.querySelector(".df-e-theme");
  const copyAllBtn = root.querySelector(".df-e-copyall");
  const saveBtn = root.querySelector(".df-e-save");
  const downloadBtn = root.querySelector(".df-e-download");
  const saveStateEl = root.querySelector(".df-e-savestate");
  ta.value = NODE.content;

  function applyRenderMode() {
    wrap.classList.toggle("textmode", renderMode === "text");
    modeBtn.textContent = RENDER_LABELS[renderMode];
    modeBtn.title = RENDER_TITLES[renderMode];
    toggleBtn.style.visibility = renderMode === "text" ? "hidden" : "visible";
  }
  function applyViewerMode() {
    wrap.classList.toggle("viewer", viewerMode);
    toggleBtn.textContent = viewerMode ? "편집" : "뷰어";
    toggleBtn.title = viewerMode ? "편집 모드로 전환" : "뷰어 모드로 전환";
  }
  function updateStatus() {
    const v = ta.value, p = ta.selectionStart, before = v.slice(0, p);
    const line = before.split("\n").length, col = p - (before.lastIndexOf("\n") + 1);
    root.querySelector(".df-e-chars").textContent = v.length + "자";
    root.querySelector(".df-e-words").textContent = (v.trim().match(/\S+/g) || []).length + "단어";
    root.querySelector(".df-e-pos").textContent = line + "행 " + (col + 1) + "열";
  }
  // 버그 리포트: "HTML 모드에서 오른쪽에 아무 것도 뜨지 않음" - iframe 자체는 이미 .df-e-preview
  // 안에 잘 배치돼 있었지만(아래 다른 버그 리포트 참고), sandbox="" (빈 문자열)로 스크립트 실행 자체를
  // 막아놨었다. 그래서 순수 정적 HTML은 보였어도, 실제 저장소의 html 파일처럼 자바스크립트로
  // 화면을 그리는 페이지(이 앱 자신이 그렇듯)는 아무 스크립트도 못 돌아서 흰 화면만 나왔다.
  // sandbox="allow-scripts"로 스크립트 실행은 허용하되, allow-same-origin은 일부러 안 준다 -
  // 그래야 미리보기 안의 스크립트가 부모 문서(이 앱 자신)로 접근할 수 없다(srcdoc + allow-scripts만
  // 있으면 그 프레임은 독립된 오리진으로 취급된다).
  // 버그 리포트: "에디터 HTML 모드 수정 안됨" - 예전엔 iframe(.df-e-html-frame)이 .df-editor-body
  // 바로 밑에 있어서 position:absolute;inset:0이 편집기 전체 폭(왼쪽 textarea까지 포함)을 덮어버려,
  // HTML 모드로 바꾸면 왼쪽 에디터(textarea)가 화면엔 보여도 클릭/타이핑이 안 먹혔다(iframe이 위에서
  // 가로막음). iframe을 .df-e-preview(오른쪽 뷰어 칸) 안으로 옮겨서(dfsBuildEditorBodyHtml 참고) 그
  // 칸 안에서만 absolute로 채워지게 하고, 왼쪽 textarea(ta)는 마크다운/HTML/텍스트 어느 모드든
  // 항상 그대로 편집 가능하게 둔다.
  // 요청 #156, 버그 리포트: "에디터 HTML 모드 렌더링이 안 됨(뷰어에 아무것도 안 뜸)" - 위 두 차례의 iframe
  // 수정(샌드박스 권한/배치)에도 여전히 안 뜨는 경우가 있어서, 아예 iframe(srcdoc)을 걷어내고
  // 마크다운 뷰어와 완전히 같은 방식(previewInner.innerHTML에 그대로 꽂아 넣기)으로 통일한다 -
  // 마크다운처럼 파싱하지 않고 원본 HTML을 그대로 넣는 것만 다르다. 대신 innerHTML로 넣은
  // <script>는 브라우저가 실행하지 않으므로(HTML 표준 동작), 스크립트로 화면을 그리는 페이지는
  // 여전히 정적으로만 보인다 - 그런 페이지는 "새 탭에서 열기"로 실제 페이지 그대로 확인해야 한다.
  function renderContent() {
    htmlFrame.style.display = "none";
    previewInner.style.display = "";
    previewInner.innerHTML = renderMode === "html" ? ta.value : dfMarkdown(ta.value);
    updateStatus();
  }
  function setSaveState(text) { if (saveStateEl) saveStateEl.textContent = text; }
  // 저장: 이미 바탕화면(가상 파일시스템)에 있는 파일이면(NODE.id가 있음) 그 자리에 그대로
  // 덮어쓴다. 저장소에서 막 불러온 파일이면(NODE.id가 없음 - 원본에는 애초에 쓸 수 없으므로)
  // "저장"이 곧 바탕화면에 새 파일을 만드는 것이다 - 한 번 저장되고 나면 그 뒤로는 그 새
  // 파일을 계속 덮어쓴다(NODE.id를 새로 받은 id로 갱신해둔다). 같은 문서 안이므로 이제
  // dfsSaveNodeContent/dfsSaveNodeContentAsNew를 직접 부른다(예전엔 window.opener를 거쳤음).
  function doSave() {
    try {
      if (NODE.id == null) {
        dfsSaveNodeContentAsNew(NODE.name, NODE.fileType, ta.value).then(function(res) {
          NODE.id = res.id;
          NODE.name = res.name;
          nameEl.textContent = NODE.name;
          const tbTitle = handle.el.querySelector(".tb-title");
          if (tbTitle) tbTitle.textContent = NODE.name + " - 에디터";
          state.dirty = false;
          setSaveState("바탕 화면에 저장됨 " + new Date().toLocaleTimeString());
        }, function() { setSaveState("저장 실패"); });
      } else {
        dfsSaveNodeContent(NODE.id, ta.value);
        state.dirty = false;
        setSaveState("저장됨 " + new Date().toLocaleTimeString());
      }
    } catch (e) { setSaveState("저장 실패"); }
  }
  // 자동 저장 없음(사용자 지시) - 저장 버튼(또는 Ctrl+S)을 직접 눌러야만 저장된다. 대신 수정만
  // 되고 아직 저장 안 된 상태를 상태줄에 분명히 보여준다(markDirty) - 저장을 깜빡하고 창을
  // 닫으려 하면 dfCreateAppWindow의 confirmClose가 state.dirty를 보고 확인창을 띄운다.
  function markDirty() {
    state.dirty = true;
    setSaveState("저장 안 됨(수정됨) - Ctrl+S로 저장");
  }

  applyRenderMode();
  applyViewerMode();
  renderContent();

  modeBtn.onclick = function() { renderMode = RENDER_MODES[(RENDER_MODES.indexOf(renderMode) + 1) % RENDER_MODES.length]; applyRenderMode(); renderContent(); };
  toggleBtn.onclick = function() { viewerMode = !viewerMode; applyViewerMode(); };
  themeBtn.onclick = function() {
    wrap.dataset.theme = wrap.dataset.theme === "light" ? "dark" : "light";
    dfsSetEditorTheme(wrap.dataset.theme);
  };
  copyAllBtn.onclick = function() { dfCopyText(ta.value, function() { copyAllBtn.classList.add("copied"); const old = copyAllBtn.textContent; copyAllBtn.textContent = "OK"; setTimeout(function() { copyAllBtn.classList.remove("copied"); copyAllBtn.textContent = old; }, 900); }); };
  saveBtn.onclick = function() { doSave(); };

  // 다운로드: 웹훅이 켜져 있으면 웹훅으로 저장 대화상자를 띄우고, 아니면 그냥 브라우저 자체 blob
  // 다운로드로 떨어진다(따로 "헬퍼 받으세요" 안내는 띄우지 않는다 - 안내가 필요한 경우는
  // 열기/다운로드처럼 로컬 프로그램이 "꼭" 필요할 때뿐이고, 여기는 blob 다운로드로 항상 대체
  // 가능하기 때문). 포트 탐색은 이 파일 안에서 다시 구현하지 않고 local-helper.js의 ensureHelperPort를
  // 그대로 쓴다 - 포트 캐싱을 공유하고, 처음 찾았을 때 dfNoteWebhookConnected(#134 자동 활성화)도
  // 자연히 같이 탄다.
  function blobDownload() {
    const blob = new Blob([ta.value], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = NODE.name; a.click();
    URL.revokeObjectURL(a.href);
    setSaveState("브라우저로 다운로드됨");
  }
  downloadBtn.onclick = async function() {
    if (downloadBtn.disabled) return;
    downloadBtn.disabled = true;
    const oldLabel = downloadBtn.textContent;
    downloadBtn.textContent = "확인 중...";
    try {
      const port = await ensureHelperPort();
      downloadBtn.disabled = false;
      downloadBtn.textContent = oldLabel;
      if (port === null) { blobDownload(); return; }
      const res = await fetch("http://127.0.0.1:" + port + "/savecontent?name=" + encodeURIComponent(NODE.name), {
        method: "POST",
        body: ta.value
      });
      const text = await res.text();
      if (!res.ok) throw new Error(String(res.status));
      const cancelled = text.indexOf("CANCELLED") !== -1;
      if (!cancelled) dfNoteWebhookDownloadSucceeded(); // 요청 #152
      setSaveState(cancelled ? "다운로드가 취소되었습니다" : "웹훅으로 다운로드됨");
    } catch (e) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = oldLabel;
      blobDownload();
    }
  };

  previewInner.addEventListener("click", function(e) {
    const btn = e.target.closest(".df-e-code-copy");
    if (!btn) return;
    const code = btn.parentElement.querySelector("pre code");
    if (!code) return;
    dfCopyText(code.textContent, function() { btn.classList.add("copied"); const old = btn.textContent; btn.textContent = "OK"; setTimeout(function() { btn.classList.remove("copied"); btn.textContent = old; }, 900); });
  });

  ta.addEventListener("input", function() { renderContent(); markDirty(); });
  ta.addEventListener("click", updateStatus);
  ta.addEventListener("keyup", updateStatus);
  // Ctrl+B/I/K/S는 이 창의 textarea 자체에 붙어 있으므로(전역 window가 아님) 에디터를 여러 개
  // 열어도 포커스가 있는 textarea가 있는 창에만 적용된다 - 그대로 유지.
  ta.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "k", "s"].indexOf(e.key.toLowerCase()) !== -1) {
      const k = e.key.toLowerCase();
      if (k === "s") { e.preventDefault(); doSave(); return; }
      e.preventDefault();
      if (k === "k") {
        const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
        const fullLink = sel.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
        const labelUrl = sel.match(/^([\s\S]*\S)[ \t]+((?:https?:\/\/|www\.)\S+)$/i);
        const bareUrl = sel.match(/^(https?:\/\/\S+|www\.\S+)$/i);
        let replacement;
        if (fullLink) replacement = fullLink[1] + " " + fullLink[2];
        else if (bareUrl) replacement = "[HyperLink](" + sel + ")";
        else if (labelUrl) replacement = "[" + labelUrl[1] + "](" + labelUrl[2] + ")";
        else if (sel) replacement = "[" + sel + "](https://example.com)";
        else replacement = "[HyperLink](https://example.com)";
        ta.setRangeText(replacement, a, b, "select");
      } else {
        dfToggleEmphasis(ta, k === "b" ? 2 : 1);
      }
      renderContent(); markDirty(); return;
    }
    if (e.key === "Tab") { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); }
  });
  updateStatus();
}

// 파일을 앱 내 창으로 연다(요청 #135). 에디터는 여러 개 동시에 열 수 있으므로(멀티 인스턴스)
// 매번 새 dfCreateAppWindow 인스턴스를 만든다 - 메뉴 메이커와 달리 싱글턴 체크가 없다.
function dfsOpenFileInWindow(node, opts = {}) {
  // 요청 #145: 이진 파일(binary:true)은 애초에 dfsActivate가 여기 대신 dfsActivateBinaryFile로
  // 보내지만, 혹시 다른 경로에서 실수로 이 함수가 직접 불려도 텍스트로 뭉개 열지 않도록 안전망을
  // 둔다.
  if (node.binary) {
    showToast(`"${node.name}"은(는) 이진 파일이라 에디터로 열 수 없습니다. 다운로드를 이용하세요.`, { kind: "warn", sound: "error_generic" });
    return;
  }
  const fileType = node.fileType || dfDetectFileType(node.name);
  const theme = (settings && settings.dfEditorTheme) || "dark";
  // 실제 저장소 파일(원본에는 쓸 수 없음)도 이제 읽기 전용이 아니라 자유롭게 수정할 수 있다
  // (사용자 지시: "어차피 저장 그 위치에 못하잖아" - 원본에 못 쓰는 건 어차피 마찬가지니 그냥
  // 다른 곳에 저장하게 하면 된다). id가 없는(=바탕화면 가상 파일이 아니라 저장소에서 막 불러온)
  // 상태에서 "저장"을 누르면 이 가짜 OS의 바탕화면에 새 파일로 만들어진다(doSave 참고).
  const NODE = { id: node.id ?? null, name: node.name, fileType, content: node.content || "" };
  const state = { dirty: false };
  dfInjectStyleOnce("dfEditorStyle", DF_EDITOR_PAGE_CSS);
  const handle = dfCreateAppWindow({
    title: NODE.name + " - 에디터",
    icon: "\u{1F4DD}",
    width: 900,
    height: 640,
    bodyHtml: dfsBuildEditorBodyHtml(theme),
    isDirty: () => state.dirty,
    confirmClose: async () => {
      if (!state.dirty) return true;
      return await showConfirmDialog(`"${NODE.name}"에 저장하지 않은 내용이 있습니다.\n저장하지 않고 닫으시겠습니까?`, { okLabel: "닫기", cancelLabel: "취소" });
    },
  });
  dfInitEditorWindow(handle, NODE, state);
  return handle;
}

// 새 탭 에디터가 opener(이 페이지)를 통해 저장을 반영하기 위해 호출하는 함수
async function dfsSaveNodeContent(id, content) {
  if (id == null || !dfsDb) return;
  await dfsDb.nodes.update(id, { content, updatedAt: Date.now() });
  await dfsBroadcastChange();
}
// 실제 저장소에서 막 불러온 파일(아직 바탕화면에 없어서 id가 없음)을 에디터에서 처음 "저장"할
// 때 호출된다 - 원본(GitHub)에는 쓸 수 없으므로, 이 가짜 OS의 바탕화면(가상 파일시스템)에
// 새 파일로 만든다(사용자 지시). 이름이 겹치면 dfsUniqueName이 자동으로 구분해준다. 이후
// 저장부터는 이 새 id로 dfsSaveNodeContent가 그 자리를 그대로 덮어쓴다.
async function dfsSaveNodeContentAsNew(name, fileType, content) {
  if (!dfsDb) throw new Error("바탕화면을 사용할 수 없습니다.");
  const uniqueName = await dfsUniqueName(DFS_DESKTOP_ROOT, name);
  const pos = await dfsNextIconPos(DFS_DESKTOP_ROOT);
  const now = Date.now();
  const id = await dfsDb.nodes.add({
    parentId: DFS_DESKTOP_ROOT, type: "file", name: uniqueName, content: content || "",
    fileType, x: pos.x, y: pos.y, createdAt: now, updatedAt: now
  });
  await dfsBroadcastChange();
  return { id, name: uniqueName };
}
function dfsSetEditorTheme(theme) {
  if (!settings) return;
  settings.dfEditorTheme = theme === "light" ? "light" : "dark";
  saveSettings();
}
function dfStarRunBefore(v, idx) { let n = 0, i = idx - 1; while (i >= 0 && v[i] === "*") { n++; i--; } return n; }
function dfStarRunAfter(v, idx) { let n = 0, i = idx; while (i < v.length && v[i] === "*") { n++; i++; } return n; }
function dfToggleEmphasis(ta, bit) {
  const v = ta.value;
  const a = ta.selectionStart, b = ta.selectionEnd;
  let coreStart = a; while (coreStart < b && v[coreStart] === "*") coreStart++;
  let coreEnd = b; while (coreEnd > coreStart && v[coreEnd - 1] === "*") coreEnd--;
  const core = v.slice(coreStart, coreEnd) || "text";
  const left = dfStarRunBefore(v, coreStart), right = dfStarRunAfter(v, coreEnd);
  const current = Math.min(left, right);
  const next = current ^ bit;
  const rangeStart = coreStart - left, rangeEnd = coreEnd + right;
  const stars = "*".repeat(next);
  ta.setRangeText(stars + core + stars, rangeStart, rangeEnd, "select");
  ta.selectionStart = rangeStart + next;
  ta.selectionEnd = rangeStart + next + core.length;
}

/* ---------------- 텍스트 뷰어 (사진/음악 뷰어와 같은 방식) ----------------
   사용자 지시: "텍스트 뷰어로 열기 사진 뷰어나 음악 뷰어와 같은 방식으로 구현해.
   우클릭 메뉴에는 추가하지 말고 더블클릭 메이커 메뉴에만 추가해"
   - 메뉴 메이커 > 확장자 탭의 EXTENSION_RUN_ACTIONS에 "textviewer"로만 노출
   - 우클릭 메뉴에는 넣지 않음
   - 앱 내 창으로 읽기 전용 텍스트를 보여준다 (에디터와 달리 편집/저장 UI 없음) */
const DF_TEXT_VIEWER_CSS = `
  .df-text-viewer-root { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; background: var(--bg, #1e1e1e); color: var(--fg, #ddd); }
  .df-text-viewer-pre { flex: 1; min-height: 0; margin: 0; padding: 12px 14px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: Consolas, "Courier New", monospace; font-size: 13px; line-height: 1.45; background: transparent; border: none; color: inherit; }
  .df-text-viewer-status { flex: 0 0 auto; padding: 4px 10px; font-size: 11.5px; opacity: .75; border-top: 1px solid rgba(127,127,127,.25); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
function resolveTextViewerIconHtml(name) {
  const dot = (name || "").lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const custom = ext && customIconConfig.extensions[ext];
  if (custom) return customImgIcon(custom, 16);
  return "\u{1F4C4}"; // 📄
}
function dfsOpenTextViewerWindow(it, text, statusUrl) {
  dfInjectStyleOnce("dfTextViewerStyle", DF_TEXT_VIEWER_CSS);
  const handle = dfCreateAppWindow({
    title: it.name || "텍스트 뷰어",
    icon: "\u{1F4C4}",
    width: 720,
    height: 520,
    bodyHtml:
      '<div class="df-text-viewer-root">' +
        '<pre class="df-text-viewer-pre"></pre>' +
        '<div class="df-text-viewer-status"></div>' +
      '</div>'
  });
  const tbIcon = handle.el.querySelector(".tb-icon");
  if (tbIcon) tbIcon.innerHTML = resolveTextViewerIconHtml(it.name);
  const pre = handle.bodyEl.querySelector(".df-text-viewer-pre");
  const statusEl = handle.bodyEl.querySelector(".df-text-viewer-status");
  pre.textContent = text;
  statusEl.textContent = statusUrl || "";
  return handle;
}
async function dfsOpenRepoFileInTextViewer(it) {
  showToast(`"${it.name}" 여는 중...`);
  let text;
  let statusUrl = "";
  try {
    const url = await githubRawUrl(it);
    statusUrl = url;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch (e) {
    showToast(`파일을 불러오지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
    return;
  }
  if (!dfLooksLikeText(text.slice(0, 8000))) {
    const proceed = await showConfirmDialog(`"${it.name}"은(는) 텍스트가 아닌 파일일 수 있습니다.\n그래도 텍스트 뷰어로 열까요? (내용이 깨져 보일 수 있습니다)`);
    if (!proceed) return;
  }
  dfsOpenTextViewerWindow(it, text, statusUrl);
}

/* ---------------- 실제 GitHub 리포 파일을 "에디터로 열기"(앱 내 창, 수정 가능) ----------------
   원본(GitHub)에는 이 페이지가 직접 쓸 수 없지만, 그렇다고 에디터 자체를 읽기 전용으로 만들
   필요는 없다(사용자 지시) - 수정 후 저장하면 이 가짜 OS의 바탕화면에 새 파일로 저장된다
   (dfsSaveNodeContentAsNew/dfInitEditorWindow의 doSave 참고). */
async function dfsOpenRepoFileInEditor(it) {
  showToast(`"${it.name}" 여는 중...`);
  let text;
  try {
    const url = await githubRawUrl(it);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    text = await res.text();
  } catch (e) {
    showToast(`파일을 불러오지 못했습니다: ${e.message}`, { kind: "warn", sound: "error_generic" });
    return;
  }
  // 이진 파일로 의심돼도 무조건 막지 않는다(오탐 가능성 - 스톱워치.ini 같은 사례) - 대신 CSS
  // 커스텀 확인창으로 사용자에게 강제로 열지 물어본다.
  if (!dfLooksLikeText(text.slice(0, 8000))) {
    const proceed = await showConfirmDialog(`"${it.name}"은(는) 텍스트가 아닌 파일일 수 있습니다.\n그래도 에디터로 열까요? (내용이 깨져 보일 수 있습니다)`);
    if (!proceed) return;
  }
  dfsOpenFileInWindow({ name: it.name, fileType: dfDetectFileType(it.name), content: text });
}

main();
