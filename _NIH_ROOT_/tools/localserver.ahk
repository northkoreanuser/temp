; ============================================================
; 로컬 헬퍼 서버 - AutoHotkey v1
;
; index.html(HTTPS로 호스팅된 GitHub Pages)에서 로컬로 파일을
; "열기" / "다운로드" 할 수 있게 해주는 로컬 웹훅 서버.
; - GET /ping              -> 살아있는지 확인용 (고유 서명 문자열 응답, 아래 참고)
; - GET /open?url=...&size=...     -> 그 URL을 %temp%에 받아서 바로 실행(연결 프로그램으로 열기)
; - GET /download?url=...&size=... -> 저장 대화상자를 띄워서 사용자가 고른 위치에 다운로드
;   (size는 선택값. index.html이 색인에 저장된 파일 크기를 알고 있으면 같이 보내주고,
;    없으면 이 서버가 HEAD 요청으로 직접 알아낸다.)
; - GET /kill              -> 이 헬퍼 프로세스를 종료한다 (#NoTrayIcon이라 트레이 메뉴로
;   못 끄니, index.html 환경설정의 "웹훅 종료" 버튼이 이걸로 끈다)
; - GET /pickfolder        -> 폴더 선택 대화상자를 한 번 띄워서 고른 경로를 응답 (다중 다운로드용.
;   여러 파일을 받을 때마다 매번 저장 대화상자를 띄우는 대신, 폴더를 딱 한 번만 고르게 한다)
; - GET /savetofolder?url=...&size=...&folder=...&name=... -> 대화상자 없이 바로 그 폴더에 저장
;   (이름이 이미 있으면 " (2)"처럼 뒤에 번호를 붙여 안 겹치게 한다)
; - GET /mkdir?base=...&rel=...      -> 폴더 통째로 다운로드할 때 중첩 폴더 구조를 만든다
;   (base=사용자가 /pickfolder로 고른 위치, rel=그 안의 상대 경로 - 이미 있으면 그냥 OK)
; - GET /savetopath?url=...&size=...&base=...&rel=... -> 폴더 통째로 다운로드할 때 base\rel 경로에
;   있는 그대로 저장한다(폴더 구조를 그대로 재현해야 하므로 /savetofolder와 달리 이름 번호를
;   붙이지 않는다 - 어차피 매번 새로 만든 폴더 안이라 충돌이 없다)
; - POST /savecontent?name=... (요청 본문 = 파일 내용 그대로, 최대 4MB)
;   -> 저장 대화상자를 띄워서 그 본문 바이트를 그대로 저장. 브라우저 자체 저장소(가상 데스크탑
;   파일시스템)나 index.html에 내장된 파일처럼, 서버에 실제 URL이 없어서 /download처럼
;   "url을 다시 받아오는" 방식이 안 되는 파일을 다운로드할 때 쓴다.
; - POST /savecontentto?base=...&rel=... (요청 본문 = 파일 내용 그대로, 최대 4MB) -> 대화상자
;   없이 base\rel 경로에 있는 그대로 저장한다(/savetopath와 같은 폴더 재현 방식이지만, url을
;   다시 받아오는 대신 /savecontent처럼 이미 POST 본문에 들어있는 내용을 그대로 쓴다) - 바탕
;   화면 가상 파일시스템 폴더를 통째로 다운로드할 때(폴더 구조를 그대로 재현해야 하는데 각
;   파일이 서버에 실제 URL은 없는 경우) 쓴다.
;
; 포트는 고정하지 않고 8000~8020 사이에서 비어있는 걸 동적으로 잡는다.
; index.html도 같은 범위를 스캔해서 응답하는 포트를 찾아 쓴다 (양쪽 다 동적).
; 그 범위에 이미 다른 무관한 프로그램이 떠있을 수도 있으므로, /ping은 단순
; "OK"가 아니라 이 헬퍼만의 고유 서명(HELPER_SIGNATURE)을 응답한다 -
; index.html은 정확히 그 문자열이 와야만 "찾았다"고 판단한다.
;
; 참고: HTTPS 페이지에서 http://127.0.0.1로 요청하는 건 크롬의
; "Local Network Access" 정책 때문에 처음 한 번은 브라우저 권한
; 팝업이 뜬다. 그건 정상이고, 사용자가 허용을 눌러야 동작한다.
; ============================================================
#NoEnv
#Persistent
#SingleInstance, Force
#NoTrayIcon
SetBatchLines, -1

PORT_MIN := 8000
PORT_MAX := 8020
; /ping 응답으로 이 문자열을 돌려준다. 단순 "OK"는 8000~8020 사이에 떠있는
; 다른 무관한 프로그램이 우연히 같은 응답을 줄 수도 있어서, 이 헬퍼만의
; 고유한 서명으로 구분한다. index.html은 정확히 이 문자열을 확인한다.
HELPER_SIGNATURE := "AHK-REPO-INDEXER-LOCALHELPER-v1"

; 열기/다운로드 파일이 이 크기(바이트)를 넘으면 진행률 표시 다운로더를 사용한다.
; 필요하면 이 값만 바꾸면 됨.
CustomDownloadThresholdBytes := 50 * 1024 * 1024

; PID 감시 주기(ms). 목록에 뭔가 있을 때만 이 주기로 계속 돌면서 "즉발"에 가깝게 확인한다
; (목록이 비면 타이머 자체를 꺼서 놀지 않는다). 필요하면 이 값만 바꾸면 됨.
ProcCheckIntervalMs := 200
; 프로세스가 끝난 걸 확인한 뒤 temp 파일 삭제를 몇 번까지 재시도할지. 필요하면 이 값만 바꾸면 됨.
ProcDeleteMaxRetries := 30

RunningProcs := []   ; [{pid, path}, ...] "열기"로 실행해서 temp에 남아있는 파일들 추적
UniqueCounter := 0
Busy := false         ; 진행률 다운로드 도중 재진입 방지용 (개인용 단일 서버라 동시 다운로드는 막는다)

boundUrl := StartWebhookServer(PORT_MIN, PORT_MAX, A_ScriptDir . "\webhook.log")
if !boundUrl {
    MsgBox, 4096, 로컬 헬퍼, %PORT_MIN%~%PORT_MAX% 사이에 열 수 있는 포트가 없습니다.
    ExitApp
}
; #NoTrayIcon이라 트레이 아이콘을 마우스로 우클릭해서 끌 수 없다 - index.html 환경설정의
; "웹훅 종료" 버튼이 /kill 요청을 보내서 끄는 게 유일한 정상 종료 방법이다.
return

; ===================== 서버 시작 (portMin~portMax 사이에서 빈 포트 탐색) =====================
StartWebhookServer(portMin, portMax, logFile := "webhook.log") {
    global WHSock, WHLog, WM_WH := 0x5555
    WHLog := logFile
    DllCall("LoadLibrary", "Str", "Ws2_32.dll")
    VarSetCapacity(w, 400, 0), DllCall("Ws2_32\WSAStartup", "UShort", 0x202, "Ptr", &w)
    WHSock := DllCall("Ws2_32\socket", "Int", 2, "Int", 1, "Int", 6, "Ptr")
    ov := 1, DllCall("Ws2_32\setsockopt", "Ptr", WHSock, "Int", 0xFFFF, "Int", 4, "Ptr", &ov, "Int", 4)

    bound := false
    port := portMin
    Loop, % (portMax - portMin + 1) {
        VarSetCapacity(sa, 16, 0), NumPut(2, sa, 0, "UShort"), NumPut(DllCall("Ws2_32\htons", "UShort", port, "UShort"), sa, 2, "UShort"), NumPut(DllCall("Ws2_32\inet_addr", "AStr", "127.0.0.1", "UInt"), sa, 4, "UInt")
        if (DllCall("Ws2_32\bind", "Ptr", WHSock, "Ptr", &sa, "Int", 16) != -1) {
            bound := true
            break
        }
        port++
    }
    if !bound
        return false

    DllCall("Ws2_32\listen", "Ptr", WHSock, "Int", 5)
    DllCall("Ws2_32\WSAAsyncSelect", "Ptr", WHSock, "Ptr", A_ScriptHwnd, "UInt", WM_WH, "Int", 8)
    OnMessage(WM_WH, "WHSocketEvent"), OnExit("WHCleanup")
    return "http://127.0.0.1:" . port
}

; ===================== 소켓 이벤트 =====================
WHSocketEvent(wParam, lParam) {
    global WHSock, WM_WH
    Event := lParam & 0xFFFF

    if (wParam = WHSock && Event = 8)
        Client := DllCall("Ws2_32\accept", "Ptr", WHSock, "Ptr", 0, "Ptr", 0, "Ptr"), Client != -1 && DllCall("Ws2_32\WSAAsyncSelect", "Ptr", Client, "Ptr", A_ScriptHwnd, "UInt", WM_WH, "Int", 0x21)

    if (Event = 1)
        WHHandleRequest(wParam), DllCall("Ws2_32\closesocket", "Ptr", wParam)

    if (Event = 0x20)
        DllCall("Ws2_32\closesocket", "Ptr", wParam)
}

; ===================== 요청 처리 (라우팅 + 로그) =====================
; 기존 라우트(GET, /open·/download 등)는 요청이 전부 한 번의 recv로 들어온다고 가정해도
; 문제없었다(URL 몇 개뿐인 아주 짧은 요청이라서). 하지만 /savecontent는 파일 내용 전체가
; POST 본문으로 들어오므로, 그게 첫 recv 한 번에 다 안 들어올 수도 있다(특히 큰 파일이거나
; 네트워크가 나눠 보낸 경우). 그래서 헤더에서 Content-Length를 읽고, 모자라면 아주 짧게
; 폴링하며 마저 받는다(최대 4MB, 그래도 못 채우면 에러). 본문은 문자열로 바꾸지 않고
; 받은 그대로 바이트 버퍼에 들고 있다가 파일로 그대로 흘려보낸다(불필요한 인코딩 왕복 없음).
WHHandleRequest(Client) {
    global WHLog, HELPER_SIGNATURE
    bufCap := 4194304  ; 4MB 상한 (개인용 로컬 헬퍼 - 실용적인 선에서 타협, 완전한 스트리밍 재조립은 하지 않음)
    VarSetCapacity(buf, bufCap, 0)
    total := DllCall("Ws2_32\recv", "Ptr", Client, "Ptr", &buf, "Int", bufCap, "Int", 0)
    if (total <= 0)
        return

    ; 헤더 구간은 항상 아스키이므로, 본문이 아직 덜 왔거나 바이너리라도(뒤쪽 바이트가 UTF-8로
    ; 안 맞아떨어져도) 이 시점엔 헤더 끝(\r\n\r\n)만 찾으면 되고, 그 이후 내용은 문자열로
    ; 쓰지 않을 것이므로 디코딩이 다소 뭉개져도 안전하다.
    headerStr := StrGet(&buf, total, "UTF-8")
    headerEndPos := InStr(headerStr, "`r`n`r`n")
    if !headerEndPos
        return WHSend(Client, 400, "Bad Request")

    if !RegExMatch(headerStr, "im)^(\S+)\s+(\S+)\s+HTTP", m)
        return WHSend(Client, 400, "Bad Request")

    method := m1, reqPath := m2

    contentLength := 0
    if RegExMatch(headerStr, "im)^Content-Length:\s*(\d+)", clm)
        contentLength := clm1 + 0

    ; 헤더는 아스키라서 문자 위치 = 바이트 오프셋. "\r\n\r\n"(4글자) 매치 시작 위치(1-based) +
    ; 4글자 뒤가 본문 시작이므로, 0-based 바이트 오프셋으로는 headerEndPos + 3.
    ; 주의: StrGet(..., "UTF-8")이 본문의 multi-byte/invalid 바이트 때문에 문자열 길이를
    ; 바이트 수와 다르게 만들 수 있으므로, 헤더 끝 위치는 바이트 단위로 다시 확인한다.
    bodyStart := headerEndPos + 3
    ; 바이트 단위로 \r\n\r\n 찾기 (더 안전)
    Loop, % total - 3 {
        if (NumGet(&buf + A_Index - 1, "UChar") = 13 && NumGet(&buf + A_Index, "UChar") = 10
            && NumGet(&buf + A_Index + 1, "UChar") = 13 && NumGet(&buf + A_Index + 2, "UChar") = 10) {
            bodyStart := A_Index + 3   ; 0-based: after the 4-byte sequence (A_Index is 1-based start of \r)
            break
        }
    }
    bodyLen := total - bodyStart

    if (contentLength > 0 && bodyLen < contentLength) {
        attempts := 0
        while (bodyLen < contentLength && total < bufCap && attempts < 400) {
            room := bufCap - total
            r2 := DllCall("Ws2_32\recv", "Ptr", Client, "Ptr", &buf + total, "Int", room, "Int", 0)
            if (r2 > 0) {
                total += r2
                bodyLen += r2
            } else {
                Sleep, 10
            }
            attempts += 1
        }
        if (bodyLen < contentLength)
            return WHSend(Client, 400, "요청 본문을 완전히 받지 못했습니다(너무 크거나 전송이 끊겼습니다. 상한 4MB)")
    }
    if (contentLength > 0 && bodyLen > contentLength)
        bodyLen := contentLength

    ; 본문을 별도 버퍼로 안전하게 복사 (포인터 산술/수명 문제 방지, 0바이트 저장 버그 방지)
    bodyBuf := ""
    if (bodyLen > 0) {
        VarSetCapacity(bodyBuf, bodyLen, 0)
        DllCall("RtlMoveMemory", "Ptr", &bodyBuf, "Ptr", &buf + bodyStart, "Ptr", bodyLen)
    }

    ; 경로와 쿼리스트링 분리 (/open?url=...&size=... -> routePath=/open, queryStr=url=...&size=...)
    qPos := InStr(reqPath, "?")
    routePath := qPos ? SubStr(reqPath, 1, qPos - 1) : reqPath
    queryStr := qPos ? SubStr(reqPath, qPos + 1) : ""

    fileUrl := ""
    if RegExMatch(queryStr, "(?:^|&)url=([^&]*)", qm)
        fileUrl := UrlDecode(qm1)

    sizeParam := ""
    if RegExMatch(queryStr, "(?:^|&)size=([^&]*)", sm)
        sizeParam := UrlDecode(sm1)

    folderParam := ""
    if RegExMatch(queryStr, "(?:^|&)folder=([^&]*)", fm)
        folderParam := UrlDecode(fm1)

    nameParam := ""
    if RegExMatch(queryStr, "(?:^|&)name=([^&]*)", nm)
        nameParam := UrlDecode(nm1)

    ; 폴더 통째로 다운로드용(/mkdir, /savetopath) - base=사용자가 고른 최상위 저장 위치,
    ; rel=그 안에서의 상대 경로("/"로 구분된 채로 옴, 각 조각은 index.html이 이미 encode해서 보냄).
    baseParam := ""
    if RegExMatch(queryStr, "(?:^|&)base=([^&]*)", bam)
        baseParam := UrlDecode(bam1)

    relParam := ""
    if RegExMatch(queryStr, "(?:^|&)rel=([^&]*)", rlm)
        relParam := UrlDecode(rlm1)

    FormatTime, ts,, yyyy-MM-dd HH:mm:ss
    FileAppend, % ts . "  " . method . " " . reqPath . "`n", %WHLog%, UTF-8

    if (method = "OPTIONS") {
        WHSend(Client, 200, "")
        return
    }

    if (routePath = "/ping") {
        WHSend(Client, 200, HELPER_SIGNATURE)
    } else if (routePath = "/open") {
        HandleOpen(Client, fileUrl, sizeParam)
    } else if (routePath = "/download") {
        HandleDownload(Client, fileUrl, sizeParam)
    } else if (routePath = "/kill") {
        HandleKill(Client)
    } else if (routePath = "/pickfolder") {
        HandlePickFolder(Client)
    } else if (routePath = "/savetofolder") {
        HandleSaveToFolder(Client, fileUrl, sizeParam, folderParam, nameParam)
    } else if (routePath = "/mkdir") {
        HandleMkdir(Client, baseParam, relParam)
    } else if (routePath = "/savetopath") {
        HandleSaveToPath(Client, fileUrl, sizeParam, baseParam, relParam)
    } else if (routePath = "/savecontent") {
        HandleSaveContent(Client, bodyLen > 0 ? &bodyBuf : 0, bodyLen, nameParam)
    } else if (routePath = "/savecontentto") {
        HandleSaveContentToPath(Client, bodyLen > 0 ? &bodyBuf : 0, bodyLen, baseParam, relParam)
    } else {
        WHSend(Client, 404, "Not Found")
    }
}

; ===================== 종료: #NoTrayIcon이라 트레이 메뉴로 못 끄니, index.html 환경설정의
; "웹훅 종료" 버튼이 이 라우트로 이 프로세스를 끈다. 응답을 먼저 깨끗하게 보내고 소켓을
; 닫은 뒤 종료해야 브라우저 쪽에서 fetch가 에러 없이 정상 완료된다. =====================
HandleKill(Client) {
    WHSend(Client, 200, "BYE")
    DllCall("Ws2_32\closesocket", "Ptr", Client)
    ExitApp
}

; ===================== 열기: 이름 안 겹치게 temp에 받아서 바로 실행 + PID 추적 =====================
HandleOpen(Client, fileUrl, sizeParam) {
    global RunningProcs, Busy, ProcCheckIntervalMs
    if (fileUrl = "")
        return WHSend(Client, 400, "url 파라미터가 없습니다")
    if (Busy)
        return WHSend(Client, 503, "다른 다운로드가 진행 중입니다. 잠시 후 다시 시도하세요")

    dest := UniqueTempPath(fileUrl)
    ok := DownloadWithOptionalProgress(fileUrl, dest, sizeParam, "여는")
    if !ok
        return WHSend(Client, 502, "다운로드 실패")

    ; UseErrorLevel을 반드시 붙인다: 없으면 연결된 프로그램이 없는 등 실행에
    ; 실패했을 때 AHK가 자체 오류 대화상자를 띄우면서 스크립트 전체(=이 웹훅 서버)가
    ; 그 창을 닫기 전까지 멈춰버린다. UseErrorLevel을 쓰면 그런 대화상자 없이
    ; ErrorLevel만 "ERROR"로 설정되고 스크립트는 계속 실행된다.
    pid := 0
    Run, %dest%,, UseErrorLevel, pid
    if (ErrorLevel = "ERROR") {
        if FileExist(dest)
            FileDelete, %dest%
        return WHSend(Client, 502, "연결된 프로그램이 없어 열 수 없습니다")
    }
    if pid {
        RunningProcs.Push({pid: pid, path: dest})
        ; 감시 목록이 방금 비어있다가 하나라도 생겼으면 타이머를 켠다(즉발 검사 시작).
        ; 이미 돌고 있었으면 SetTimer를 다시 호출해도 그냥 주기만 갱신될 뿐 문제 없다.
        SetTimer, CheckRunningProcs, % ProcCheckIntervalMs
    }
    WHSend(Client, 200, "OK")
}

; ===================== 다운로드: 저장 대화상자 -> 사용자가 고른 위치에 저장 =====================
HandleDownload(Client, fileUrl, sizeParam) {
    global Busy
    if (fileUrl = "")
        return WHSend(Client, 400, "url 파라미터가 없습니다")
    if (Busy)
        return WHSend(Client, 503, "다른 다운로드가 진행 중입니다. 잠시 후 다시 시도하세요")

    name := UrlToFileName(fileUrl)
    savePath := ""
    FileSelectFile, savePath, S16, %A_MyDocuments%\%name%, 다운로드 위치 선택, 모든 파일 (*.*)
    if (savePath = "")
        return WHSend(Client, 200, "CANCELLED")

    ok := DownloadWithOptionalProgress(fileUrl, savePath, sizeParam, "다운로드")
    if !ok
        return WHSend(Client, 502, "다운로드 실패")

    WHSend(Client, 200, "OK")
}

; ===================== 브라우저 저장소(가상 파일)에서 보낸 내용을 그대로 저장 =====================
; url이 아니라 요청 본문(bodyPtr부터 bodyLen바이트)에 파일 내용이 이미 그대로 들어있다 -
; 네트워크로 다시 받아올 필요 없이 그 바이트를 저장 대화상자로 고른 위치에 그대로 쓴다.
HandleSaveContent(Client, bodyPtr, bodyLen, nameParam) {
    global Busy
    if (nameParam = "")
        return WHSend(Client, 400, "name 파라미터가 없습니다")
    if (Busy)
        return WHSend(Client, 503, "다른 다운로드가 진행 중입니다. 잠시 후 다시 시도하세요")

    savePath := ""
    FileSelectFile, savePath, S16, %A_MyDocuments%\%nameParam%, 다운로드 위치 선택, 모든 파일 (*.*)
    if (savePath = "")
        return WHSend(Client, 200, "CANCELLED")

    Busy := true
    if FileExist(savePath)
        FileDelete, %savePath%
    ok := false
    f := FileOpen(savePath, "w")
    if IsObject(f) {
        f.RawWrite(bodyPtr, bodyLen)
        f.Close()
        ok := true
    }
    Busy := false

    if !ok
        return WHSend(Client, 502, "저장 실패")
    WHSend(Client, 200, "OK")
}

; ===================== 바탕 화면 가상 폴더 다운로드용: 대화상자 없이 base\rel 경로에 POST 본문을
; 그대로 저장(HandleSaveToPath와 같은 뼈대이지만 url이 아니라 HandleSaveContent처럼 이미 받은
; 본문 바이트를 그대로 쓴다 - 폴더 구조를 그대로 재현하는 용도라 이름 번호는 붙이지 않는다) =====================
HandleSaveContentToPath(Client, bodyPtr, bodyLen, base, rel) {
    global Busy
    if (base = "" || rel = "")
        return WHSend(Client, 400, "base/rel 파라미터가 없습니다")
    if (Busy)
        return WHSend(Client, 503, "다른 다운로드가 진행 중입니다. 잠시 후 다시 시도하세요")

    dest := StrReplace(base . "\" . rel, "/", "\")
    SplitPath, dest,, destDir
    if (destDir != "" && !FileExist(destDir))
        FileCreateDir, % destDir

    Busy := true
    if FileExist(dest)
        FileDelete, %dest%
    ok := false
    f := FileOpen(dest, "w")
    if IsObject(f) {
        f.RawWrite(bodyPtr, bodyLen)
        f.Close()
        ok := true
    }
    Busy := false

    if !ok
        return WHSend(Client, 502, "저장 실패")
    WHSend(Client, 200, "OK")
}

; ===================== 다중 다운로드용: 폴더 선택 대화상자를 한 번만 띄움 =====================
HandlePickFolder(Client) {
    folder := SelectFolderEx("", "다운로드 받을 폴더를 선택하세요")
    if (folder = "")
        return WHSend(Client, 200, "CANCELLED")
    WHSend(Client, 200, folder)
}

; ===================== 다중 다운로드용: 대화상자 없이 지정된 폴더에 바로 저장 =====================
HandleSaveToFolder(Client, fileUrl, sizeParam, folder, nameParam) {
    global Busy
    if (fileUrl = "" || folder = "")
        return WHSend(Client, 400, "url/folder 파라미터가 없습니다")
    if (Busy)
        return WHSend(Client, 503, "다른 다운로드가 진행 중입니다. 잠시 후 다시 시도하세요")
    if !FileExist(folder)
        return WHSend(Client, 400, "폴더가 존재하지 않습니다: " . folder)

    name := (nameParam != "") ? nameParam : UrlToFileName(fileUrl)
    dest := UniqueDestPath(folder, name)

    ok := DownloadWithOptionalProgress(fileUrl, dest, sizeParam, "다운로드")
    if !ok
        return WHSend(Client, 502, "다운로드 실패")

    WHSend(Client, 200, "OK")
}

; ===================== 폴더 통째로 다운로드: base\rel 경로에 중첩 폴더를 만든다(이미 있으면 그냥 OK) =====================
HandleMkdir(Client, base, rel) {
    if (base = "")
        return WHSend(Client, 400, "base 파라미터가 없습니다")
    target := (rel = "") ? base : base . "\" . rel
    target := StrReplace(target, "/", "\")  ; index.html은 항상 "/"로 상대경로를 보내므로 윈도우 구분자로 맞춘다
    if !FileExist(target) {
        FileCreateDir, % target
        if !FileExist(target)
            return WHSend(Client, 502, "폴더를 만들지 못했습니다: " . target)
    }
    WHSend(Client, 200, "OK")
}

; ===================== 폴더 통째로 다운로드: base\rel 경로에 있는 그대로 저장(대화상자 없음, 이름 번호도
; 안 붙임 - 매번 새로 만드는 폴더 구조를 그대로 재현하는 용도라 충돌이 없다고 가정한다) =====================
HandleSaveToPath(Client, fileUrl, sizeParam, base, rel) {
    global Busy
    if (fileUrl = "" || base = "" || rel = "")
        return WHSend(Client, 400, "url/base/rel 파라미터가 없습니다")
    if (Busy)
        return WHSend(Client, 503, "다른 다운로드가 진행 중입니다. 잠시 후 다시 시도하세요")

    dest := StrReplace(base . "\" . rel, "/", "\")
    SplitPath, dest,, destDir
    if (destDir != "" && !FileExist(destDir))
        FileCreateDir, % destDir

    ok := DownloadWithOptionalProgress(fileUrl, dest, sizeParam, "다운로드")
    if !ok
        return WHSend(Client, 502, "다운로드 실패")

    WHSend(Client, 200, "OK")
}

; ===================== folder\name이 이미 있으면 "이름 (2).ext"처럼 번호를 붙여 안 겹치게 =====================
UniqueDestPath(folder, name) {
    dest := folder . "\" . name
    if !FileExist(dest)
        return dest

    dotPos := InStr(name, ".", false, -1)  ; 마지막 "."
    if dotPos {
        base := SubStr(name, 1, dotPos - 1)
        ext := SubStr(name, dotPos)
    } else {
        base := name
        ext := ""
    }
    n := 2
    Loop {
        candidate := folder . "\" . base . " (" . n . ")" . ext
        if !FileExist(candidate)
            return candidate
        n += 1
    }
}

; ===================== temp 파일명 충돌 방지 (같은 이름 파일을 여러 번/여러 폴더에서 열어도 안 겹침) =====================
UniqueTempPath(fileUrl) {
    global UniqueCounter
    name := UrlToFileName(fileUrl)
    UniqueCounter += 1
    return A_Temp . "\ri_" . A_TickCount . "_" . UniqueCounter . "_" . name
}

; ===================== 실행해둔 temp 파일 정리: PID가 더 이상 없으면 파일 삭제 =====================
; 목록(RunningProcs)에 하나라도 있는 동안만 이 타이머가 돌면서(ProcCheckIntervalMs 주기,
; 기본 200ms = 사실상 즉발) 계속 검사한다. 목록이 비면 스스로 타이머를 꺼서 쉰다.
; 프로세스가 끝난 걸 확인하면 그 즉시 삭제를 시도하고, 삭제 성공 여부까지 확인한다
; (삭제 명령 후 삭제 검사) - 파일이 아직 잠겨있는 경우를 대비해 최대
; ProcDeleteMaxRetries회까지 재시도하고, 그래도 안 되면 포기하고 목록에서만 뺀다.
;
; 아래 두 개(CheckRunningProcs, DownloadProgressTick)는 함수(Name(){ })가 아니라
; 레이블 기반 서브루틴이라서, 최상위(자동 실행 구역)와 마찬가지로 처음부터
; 전역 스코프를 그대로 쓴다 - 함수 안에서만 필요한 "global" 선언이 필요 없다.
CheckRunningProcs:
    remaining := []
    for index, entry in RunningProcs {
        Process, Exist, % entry.pid
        if (ErrorLevel = 0) {
            DeleteFileWithRetries(entry.path, ProcDeleteMaxRetries)
        } else {
            remaining.Push(entry)
        }
    }
    RunningProcs := remaining
    if (RunningProcs.Length() = 0)
        SetTimer, CheckRunningProcs, Off
return

; ===================== 삭제 명령 -> 삭제 확인, 최대 maxRetries회까지 재시도 =====================
DeleteFileWithRetries(path, maxRetries) {
    if !FileExist(path)
        return true
    Loop, % maxRetries {
        FileDelete, % path
        if !FileExist(path)
            return true
        Sleep, 50
    }
    return false
}

; ===================== size 파라미터 우선 사용, 없으면 HEAD로 Content-Length 조회 =====================
ResolveFileSize(url, sizeParam) {
    size := sizeParam + 0
    if (sizeParam != "" && size > 0)
        return size
    return HeadContentLength(url)
}
HeadContentLength(url) {
    size := 0
    try {
        ComObjError(0)
        req := ComObjCreate("WinHttp.WinHttpRequest.5.1")
        req.Open("HEAD", url)
        req.Send()
        size := req.GetResponseHeader("Content-Length") + 0
    } catch e {
        size := 0
    }
    return size
}

; ===================== 임계값 넘으면 진행률 표시 다운로드, 아니면 그냥 다운로드 =====================
DownloadWithOptionalProgress(url, dest, sizeParam, verb) {
    global CustomDownloadThresholdBytes, Busy
    size := ResolveFileSize(url, sizeParam)

    Busy := true
    if (size > CustomDownloadThresholdBytes) {
        DownloadFileWithProgress(url, dest, verb, size)
    } else {
        UrlDownloadToFile, %url%, %dest%
    }
    Busy := false
    return FileExist(dest) ? true : false
}

; ===================== 진행률 표시 다운로더 (사용자가 준 DownloadFile() 예시 기반) =====================
DownloadFileWithProgress(url, dest, verb, finalSize) {
    global DL_SaveFileAs, DL_FinalSize, DL_LastSize, DL_LastTick
    DL_SaveFileAs := dest
    DL_FinalSize := finalSize
    DL_LastSize := 0
    DL_LastTick := A_TickCount
    Progress, H80,, % verb " 중...", 로컬 헬퍼 다운로드
    SetTimer, DownloadProgressTick, 200
    UrlDownloadToFile, %url%, %dest%
    SetTimer, DownloadProgressTick, Off
    Progress, Off
}
DownloadProgressTick:
    if !FileExist(DL_SaveFileAs)
        return
    cur := 0
    f := FileOpen(DL_SaveFileAs, "r")
    if IsObject(f) {
        cur := f.Length
        f.Close()
    }
    nowTick := A_TickCount
    elapsed := nowTick - DL_LastTick
    speed := elapsed > 0 ? Round((cur - DL_LastSize) / 1024 / (elapsed / 1000)) : 0
    DL_LastSize := cur
    DL_LastTick := nowTick
    percent := DL_FinalSize > 0 ? Round(cur / DL_FinalSize * 100) : 0
    if (percent > 100)
        percent := 100
    Progress, %percent%,, % "[속도: " speed " Kb/s] [" percent "%]", 로컬 헬퍼 다운로드
return

; ===================== URL의 마지막 경로 조각을 파일명으로 사용 =====================
UrlToFileName(u) {
    if (p := InStr(u, "#"))
        u := SubStr(u, 1, p - 1)
    if (p := InStr(u, "?"))
        u := SubStr(u, 1, p - 1)
    parts := StrSplit(u, "/")
    name := parts.Length() ? parts[parts.Length()] : ""
    return name = "" ? "download" : name
}

; ===================== 퍼센트 인코딩 디코드 (UTF-8 바이트 그대로 모아서 한 번에 변환) =====================
UrlDecode(str) {
    len := StrLen(str)
    if (len = 0)
        return ""
    VarSetCapacity(buf, len, 0)
    n := 0
    pos := 1
    while (pos <= len) {
        c := SubStr(str, pos, 1)
        if (c = "%" && pos + 2 <= len) {
            NumPut("0x" . SubStr(str, pos + 1, 2), buf, n, "UChar")
            n += 1
            pos += 3
        } else {
            NumPut(Asc(c), buf, n, "UChar")
            n += 1
            pos += 1
        }
    }
    return n ? StrGet(&buf, n, "UTF-8") : ""
}

; ===================== 응답 전송 (CORS 헤더 포함) =====================
WHSend(Client, status, text) {
    statusText := (status = 200) ? "OK" : (status = 400) ? "Bad Request" : (status = 404) ? "Not Found" : (status = 502) ? "Bad Gateway" : (status = 503) ? "Service Unavailable" : "Error"
    VarSetCapacity(bodyBuf, StrPut(text, "UTF-8"), 0), bodyLen := StrPut(text, &bodyBuf, "UTF-8") - 1
    header := "HTTP/1.1 " . status . " " . statusText . "`r`n"
        . "Access-Control-Allow-Origin: *`r`n"
        . "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n"
        . "Content-Type: text/plain; charset=utf-8`r`n"
        . "Content-Length: " . bodyLen . "`r`n"
        . "Connection: close`r`n`r`n"
    headerLen := StrPut(header, "UTF-8") - 1, total := headerLen + bodyLen

    VarSetCapacity(respBuf, total, 0), StrPut(header, &respBuf, "UTF-8")
    if (bodyLen > 0)
        DllCall("RtlMoveMemory", "Ptr", &respBuf + headerLen, "Ptr", &bodyBuf, "Ptr", bodyLen)

    sentTotal := 0
    while (sentTotal < total) {
        sent := DllCall("Ws2_32\send", "Ptr", Client, "Ptr", &respBuf + sentTotal, "Int", total - sentTotal, "Int", 0)
        if (sent <= 0)
            break
        sentTotal += sent
    }
}

; ==================================================================================================================================
; 폴더 선택 대화상자 (다중 다운로드용). OS 버전에 따라 XP 이전은 FileSelectFolder, Vista 이후는
; Common Item Dialog(IFileDialog)를 쓴다. 사용자가 제공한 예시 함수를 그대로 사용.
; Parameter:
;     StartingFolder -  the full path of a folder which will be preselected.
;     Prompt         -  a text used as window title (Common Item Dialog) or as text displayed withing the dialog.
;     ----------------  Common Item Dialog only:
;     OwnerHwnd      -  HWND of the Gui which owns the dialog. If you pass a valid HWND the dialog will become modal.
;     BtnLabel       -  a text to be used as caption for the apply button.
;  Return values:
;     On success the function returns the full path of selected folder; otherwise it returns an empty string.
; ==================================================================================================================================
SelectFolderEx(StartingFolder := "", Prompt := "", OwnerHwnd := 0, OkBtnLabel := "") {
   Static OsVersion := DllCall("GetVersion", "UChar")
        , IID_IShellItem := 0
        , InitIID := VarSetCapacity(IID_IShellItem, 16, 0)
                  & DllCall("Ole32.dll\IIDFromString", "WStr", "{43826d1e-e718-42ee-bc55-a1e261c37bfe}", "Ptr", &IID_IShellItem)
        , Show := A_PtrSize * 3
        , SetOptions := A_PtrSize * 9
        , SetFolder := A_PtrSize * 12
        , SetTitle := A_PtrSize * 17
        , SetOkButtonLabel := A_PtrSize * 18
        , GetResult := A_PtrSize * 20
   SelectedFolder := ""
   If (OsVersion < 6) { ; IFileDialog requires Win Vista+, so revert to FileSelectFolder
      FileSelectFolder, SelectedFolder, *%StartingFolder%, 3, %Prompt%
      Return SelectedFolder
   }
   OwnerHwnd := DllCall("IsWindow", "Ptr", OwnerHwnd, "UInt") ? OwnerHwnd : 0
   If !(FileDialog := ComObjCreate("{DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7}", "{42f85136-db7e-439c-85f1-e4075d135fc8}"))
      Return ""
   VTBL := NumGet(FileDialog + 0, "UPtr")
   ; FOS_CREATEPROMPT | FOS_NOCHANGEDIR | FOS_PICKFOLDERS
   DllCall(NumGet(VTBL + SetOptions, "UPtr"), "Ptr", FileDialog, "UInt", 0x00002028, "UInt")
   If (StartingFolder <> "")
      If !DllCall("Shell32.dll\SHCreateItemFromParsingName", "WStr", StartingFolder, "Ptr", 0, "Ptr", &IID_IShellItem, "PtrP", FolderItem)
         DllCall(NumGet(VTBL + SetFolder, "UPtr"), "Ptr", FileDialog, "Ptr", FolderItem, "UInt")
   If (Prompt <> "")
      DllCall(NumGet(VTBL + SetTitle, "UPtr"), "Ptr", FileDialog, "WStr", Prompt, "UInt")
   If (OkBtnLabel <> "")
      DllCall(NumGet(VTBL + SetOkButtonLabel, "UPtr"), "Ptr", FileDialog, "WStr", OkBtnLabel, "UInt")
   If !DllCall(NumGet(VTBL + Show, "UPtr"), "Ptr", FileDialog, "Ptr", OwnerHwnd, "UInt") {
      If !DllCall(NumGet(VTBL + GetResult, "UPtr"), "Ptr", FileDialog, "PtrP", ShellItem, "UInt") {
         GetDisplayName := NumGet(NumGet(ShellItem + 0, "UPtr"), A_PtrSize * 5, "UPtr")
         If !DllCall(GetDisplayName, "Ptr", ShellItem, "UInt", 0x80028000, "PtrP", StrPtr) ; SIGDN_DESKTOPABSOLUTEPARSING
            SelectedFolder := StrGet(StrPtr, "UTF-16"), DllCall("Ole32.dll\CoTaskMemFree", "Ptr", StrPtr)
         ObjRelease(ShellItem)
   }  }
   If (FolderItem)
      ObjRelease(FolderItem)
   ObjRelease(FileDialog)
   Return SelectedFolder
}

; ===================== 종료 처리 =====================
WHCleanup() {
    global WHSock
    DllCall("Ws2_32\closesocket", "Ptr", WHSock), DllCall("Ws2_32\WSACleanup")
}
