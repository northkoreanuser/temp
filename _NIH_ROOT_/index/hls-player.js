/* ============================================================================
   HLS 재생기 / 음악 플레이어 / 사진 뷰어 (요청: "hls 재생기 추가. 파일 확장자 연결은 메뉴
   메이커의 확장자 탭에서 연결한다(하드코딩 연결은 하지 말고, 사용자가 찾아 쓰게 하면 좋음)")
   ----------------------------------------------------------------------------
   .m3u8(HLS 스트림) 같은 파일을 이 재생기로 열려면, 메뉴 메이커의 "확장자" 탭에서 원하는
   확장자를 등록하고 동작으로 "HLS 재생기로 열기"(state.js EXTENSION_RUN_ACTIONS의 "hls")를
   고르면 된다 - 이 파일 자체는 어떤 확장자와도 미리 엮여 있지 않다(하드코딩 금지 - 사용자 지시).
   더블클릭 시 실제 호출은 keyboard-and-activate.js의 runDoubleClickAction이 담당한다.

   요청: "hls 뷰어 창을 음악 플레이어/사진 뷰어로 돌려써라 - mp3나 png 같은 파일은 raw 링크로
   그대로 재생/로드되니, 창의 이름과 아이콘만 바꾸고 등록된 확장자만 불러오면 된다." - 그래서
   창 자체(dfCreateAppWindow 호출, 상태 표시줄, onClose 정리)는 video/music/photo 세 모드가
   전부 공유하는 dfsOpenMediaViewerWindow(it, mode, url) 하나로 합쳐져 있다. 모드별로 달라지는
   부분은 딱 두 가지뿐이다:
     1) 안에 들어가는 미디어 태그(video/audio/img) - mp3/png는 raw 주소를 그대로 물리기만
        하면 브라우저가 알아서 재생/표시하므로 hls.js 같은 조립이 전혀 필요 없다. HLS 재생
        로직(hls.js 지연 로딩, canPlayType 분기)은 video 모드에서만 탄다.
     2) 타이틀바 아이콘 - 메뉴 메이커의 "아이콘" 탭에서 그 확장자에 등록해둔 아이콘(state.js의
        customIconConfig.extensions, resolveFileIcon과 같은 데이터)이 있으면 그걸 쓰고, 없으면
        모드별 기본 이모지(video=▶, music=🎵, photo=🖼)로 떨어진다.
   재생 자체는 hls.js를 필요할 때(video 모드로 처음 열 때)만 CDN에서 지연 로딩한다(state.js의
   ensureJSZip과 완전히 같은 패턴 - 항상 쓰는 기능이 아니므로 페이지 로드시 무조건 불러오지
   않는다). 사파리 등 <video> 태그가 HLS를 자체적으로 재생할 수 있는 브라우저에서는 hls.js 없이
   그대로 물려서 불필요한 네트워크 요청을 건너뛴다.

   에디터처럼 여러 개를 동시에 열어 나란히 볼 수 있는 게 자연스러우므로(메뉴 메이커와 달리) 이
   재생기는 싱글턴으로 만들지 않는다 - 열 때마다(음악/사진 모드도 포함) 새 창이 뜬다.
================================================================================= */
let dfHlsJsLoadPromise = null;
function dfEnsureHlsJs() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (dfHlsJsLoadPromise) return dfHlsJsLoadPromise;
  dfHlsJsLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js";
    s.onload = () => resolve(window.Hls);
    s.onerror = () => { dfHlsJsLoadPromise = null; reject(new Error("hls.js를 불러오지 못했습니다(네트워크 확인)")); };
    document.head.appendChild(s);
  });
  return dfHlsJsLoadPromise;
}

const DF_MEDIA_VIEWER_CSS = `
  .hls-root { flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; background: #000; }
  .hls-video-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .hls-video-wrap video { width: 100%; height: 100%; object-fit: contain; background: #000; }
  .hls-video-wrap img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .hls-video-wrap audio { width: 88%; }
  .hls-video-wrap iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  .hls-status { flex: 0 0 auto; padding: 6px 10px; font: 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color: #ddd; background: #111; border-top: 1px solid #000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

// 타이틀바 아이콘 - 메뉴 메이커 "아이콘" 탭에서 그 확장자에 등록된 아이콘(customIconConfig,
// state.js의 resolveFileIcon과 같은 데이터 출처)이 있으면 그걸 쓰고, 없으면 모드별 기본 이모지.
function resolveMediaViewerIconHtml(name, mode) {
  const dot = (name || "").lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const custom = ext && customIconConfig.extensions[ext];
  if (custom) return customImgIcon(custom, 16);
  if (mode === "music") return "\u{1F3B5}"; // 🎵
  if (mode === "photo") return "\u{1F5BC}\u{FE0F}"; // 🖼️
  if (mode === "pdf") return "\u{1F4C4}"; // 📄
  return "\u{25B6}\u{FE0F}"; // ▶️ (video/hls 기본값, 예전 그대로)
}

// mode: "video"(HLS/일반 영상 - hls.js 필요할 수 있음) | "music"(오디오, <audio> 태그로 raw
// 재생) | "photo"(이미지, <img> 태그로 raw 로드) | "pdf"(문서, <iframe> 태그로 raw 로드 -
// 브라우저 내장 PDF 뷰어가 알아서 렌더링). it: 파일 아이템(이름/아이콘 결정용),
// url: 실제로 불러올 raw 주소.
function dfsOpenMediaViewerWindow(it, mode, url) {
  dfInjectStyleOnce("dfHlsPlayerStyle", DF_MEDIA_VIEWER_CSS);
  let hlsInstance = null;
  const mediaTagHtml = mode === "photo" ? '<img alt="">'
    : mode === "music" ? '<audio controls autoplay></audio>'
    : mode === "pdf" ? '<iframe title="PDF"></iframe>'
    : '<video controls autoplay playsinline></video>';
  const handle = dfCreateAppWindow({
    title: it.name || (mode === "music" ? "음악 플레이어" : mode === "photo" ? "사진 뷰어" : mode === "pdf" ? "PDF 뷰어" : "HLS 재생기"),
    icon: resolveMediaViewerIconHtml(it.name, mode),
    width: mode === "music" ? 480 : 900,
    height: mode === "music" ? 180 : 560,
    bodyHtml:
      '<div class="hls-root">' +
        '<div class="hls-video-wrap">' + mediaTagHtml + '</div>' +
        '<div class="hls-status"></div>' +
      '</div>',
    onClose: () => { if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) { /* 무시 */ } } }
  });

  const statusEl = handle.bodyEl.querySelector(".hls-status");
  statusEl.textContent = url;

  // 음악/사진: raw 주소를 그대로 물리기만 하면 끝 - hls.js 조립이 전혀 필요 없다(요청의 "꼼수").
  if (mode === "photo") {
    const img = handle.bodyEl.querySelector("img");
    img.onerror = () => { statusEl.textContent = "이미지를 불러오지 못했습니다: " + url; };
    img.src = url;
    return handle;
  }
  if (mode === "music") {
    const audio = handle.bodyEl.querySelector("audio");
    audio.onerror = () => { statusEl.textContent = "오디오를 불러오지 못했습니다: " + url; };
    audio.src = url;
    return handle;
  }
  if (mode === "pdf") {
    // 브라우저 내장 PDF 뷰어(대부분의 크로미움/파이어폭스)가 <iframe src="raw.pdf">만으로
    // 알아서 렌더링한다 - photo/music과 완전히 같은 "raw 링크만 물리면 끝" 꼼수.
    const iframe = handle.bodyEl.querySelector("iframe");
    iframe.src = url;
    return handle;
  }

  // video(HLS 포함) - 예전 dfsOpenHlsPlayerWindow와 완전히 같은 로직.
  const video = handle.bodyEl.querySelector("video");
  function playWithNativeHls() { video.src = url; }
  // 사파리처럼 <video>가 HLS를 자체적으로(hls.js 없이) 재생할 수 있으면 그대로 쓰고, 아니면
  // hls.js를 지연 로딩해서 붙인다(대부분의 크로미움/파이어폭스 계열이 이 경로를 탄다).
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    playWithNativeHls();
  } else {
    dfEnsureHlsJs().then((Hls) => {
      if (Hls && Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
        hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
          if (data && data.fatal) statusEl.textContent = "재생 오류: " + (data.details || "알 수 없는 오류") + " - " + url;
        });
      } else {
        // hls.js 자체를 못 쓰는 아주 오래된 브라우저 - 마지막 시도로 네이티브 재생을 건다.
        playWithNativeHls();
      }
    }).catch((e) => {
      statusEl.textContent = "hls.js 로딩 실패: " + e.message;
      showToast(`HLS 재생기 로딩 실패: ${e.message}`, { kind: "warn", sound: "error_generic" });
    });
  }
  return handle;
}

// 저장소에 올라간 파일을 위 뷰어로 연다 - 메뉴 메이커의 확장자 탭에서 이 동작들("hls"/"music"/
// "photo")로 연결해둔 확장자를 더블클릭하면 keyboard-and-activate.js의 runDoubleClickAction이
// 이 함수를 부른다. 같은 오리진(GitHub Pages)의 상대 경로를 그대로 쓴다(viewAsHostedPage와 같은
// 방식) - HLS 재생목록(.m3u8)은 그 안에 상대경로로 세그먼트(.ts/.m4s)를 가리키는 경우가 많아서,
// raw.githubusercontent.com 같은 절대 주소로 바꿔치기하면 오히려 세그먼트를 못 찾을 수 있다.
// 이 페이지 자신의 주소(같은 저장소를 그대로 서빙하는 GitHub Pages)가 항상 세그먼트 상대경로와
// 맞아떨어진다. mp3/png 같은 파일도 이 같은 상대 경로로 그대로 raw 재생/로드된다(요청의 꼼수).
function dfsOpenRepoFileInMediaViewer(it, mode) {
  const url = it.path.map(encodeURIComponent).join("/");
  dfsOpenMediaViewerWindow(it, mode, url);
}
// 기존 이름 유지(다른 파일의 주석/호출부와의 호환용) - 항상 video 모드로 연다.
function dfsOpenRepoFileInHlsPlayer(it) {
  dfsOpenRepoFileInMediaViewer(it, "video");
}
