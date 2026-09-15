; ============================================================
; GitHub Pages 인덱서
;
; 리포 루트 = 이 스크립트(indexer.ahk)의 경로에서 "_NIH_ROOT_" 폴더를 잘라낸 위치.
; indexer.ahk는 실제로 <리포 루트>\_NIH_ROOT_\tools\indexer.ahk에 있으므로, 자기 경로
; 안에서 "_NIH_ROOT_"라는 폴더 이름을 찾아 그 앞부분까지만 남기면 리포 루트가 된다
; (DetectRootDir 참고). 혹시 옛날 방식대로 indexer.ahk가 리포 루트에 바로 있는 경우
; (_NIH_ROOT_를 못 찾은 경우)엔 그냥 자기가 있는 폴더를 루트로 쓴다(하위 호환).
;
; 루트부터 모든 하위 폴더까지 재귀적으로 돌면서,
; "폴더마다" 그 폴더 바로 안에 있는 폴더/파일 목록을 담은
; pages.json을 만든다. (하위 폴더 안까지 미리 다 담지 않음)
;
; index.html은 폴더를 열 때마다 그 폴더의 pages.json을
; 꼬리에 꼬리를 물며 추가로 읽어들이는 방식으로 동작한다.
;
; ------------------ 색인 제외 규칙 ------------------
; [모든 폴더(루트+모든 하위)에서 제외]
;   pages.json, 이름에 "_NIH_"가 포함된 폴더/파일 (대소문자 무관)
;   -> indexer.ahk(본인)/localserver.ahk/menu.json/index.html의 JS·CSS는 전부 _NIH_ROOT_
;      폴더 안(_NIH_ROOT_\index\menu.json, _NIH_ROOT_\tools\indexer.ahk,
;      _NIH_ROOT_\tools\localserver.ahk, _NIH_ROOT_\index\*.js, _NIH_ROOT_\index\ui\theme\*)에
;      있으므로, 이 규칙 하나로 폴더째 통째로 색인에서 빠진다 - 예전처럼 파일 이름을 하나하나
;      루트 전용 예외 목록에 넣을 필요가 없다.
; [루트에서만 제외]
;   .git 폴더, index.html (index.html은 GitHub Pages가 서빙해야 하므로 _NIH_ROOT_ 밖,
;   리포 루트에 그대로 둔다)
; -----------------------------------------------------
; ------------------ 바탕화면 편의 사본 ------------------
; 색인이 끝나면 indexer.ahk(본인)와 localserver.ahk를 바탕화면에도 복사해둔다 - 리포 폴더
; 깊숙한 곳(_NIH_ROOT_\tools\)까지 매번 찾아가지 않고 바탕화면에서 바로 다시 색인하거나
; 로컬 헬퍼를 켤 수 있게 하기 위함이다. localserver.ahk는 리포마다 구분되고 용도도 한눈에
; 보이도록 "{리포 이름} Manager.ahk"로 이름을 바꿔서 둔다. 이건 순수히 바탕화면에 놓는
; "사본"의 이름일 뿐이고, 리포 안의 원본 파일명(localserver.ahk)은 그대로이므로 위 색인
; 제외 규칙은 손댈 필요가 없다. 둘 다 평범한 FileCopy로 복사하므로(고정/잠금 없음) 실제
; 바탕화면 아이콘처럼 마우스로 자유롭게 옮길 수 있다. 실행할 때마다 최신 버전으로 덮어써서
; 리포가 업데이트돼도 뒤처지지 않게 한다.
; -----------------------------------------------------
; ============================================================
#NoEnv
#SingleInstance, Force
SetBatchLines, -1

global RootDir := DetectRootDir()
global DirCount := 0

SetWorkingDir, %RootDir%
SplitPath, RootDir, RepoName

; 모든 위치에서 이름이 정확히 일치하면 제외
GlobalExactExclude := ["pages.json"]
; 루트에서만 제외할 이름 (indexer.ahk/localserver.ahk/menu.json은 _NIH_ROOT_ 폴더 자체가
; "_NIH_" 규칙에 걸려 통째로 빠지므로 여기 넣을 필요가 없다)
; README.md는 깃허브 저장소 설명용 파일이라 이 앱 자신의 색인(=사용자가 보는 파일 목록)에는
; 나올 이유가 없고, .nojekyll도 GitHub Pages가 _NIH_ROOT_ 폴더를 그대로 서빙하게 해주는
; 저장소 관리용 설정 파일일 뿐이라 마찬가지로 숨긴다(둘 다 pages.json 자체에 아예 안 실리게
; 해서 index.html 쪽의 filterNames와 이중으로 막는다). AHK의 "=" 비교는 기본적으로 대소문자를
; 가리지 않으므로 "readme.md"처럼 소문자로 된 실제 파일명도 그대로 걸러진다.
RootOnlyExclude := [".git", "index.html", "README.md", ".nojekyll"]

; ------------------------------------------------------------
; 자기 경로(A_ScriptFullPath)에서 "_NIH_ROOT_" 폴더 이름을 찾아, 그 앞부분까지를
; 리포 루트로 돌려준다. 경로를 "\"로 나눠서 세그먼트 단위로 비교하므로,
; "_NIH_ROOT_2"처럼 이름이 겹치는 다른 폴더를 잘못 잘라내는 일이 없다.
; "_NIH_ROOT_"를 못 찾으면(구버전처럼 indexer.ahk가 루트에 바로 있는 경우) 그냥
; A_ScriptDir을 그대로 루트로 쓴다(하위 호환).
; ------------------------------------------------------------
DetectRootDir() {
    segments := StrSplit(A_ScriptDir, "\")
    root := ""
    found := false
    for index, seg in segments {
        if (seg = "_NIH_ROOT_") {
            found := true
            break
        }
        root .= (root = "" ? "" : "\") . seg
    }
    if (!found || root = "")
        return A_ScriptDir
    return root
}

IndexDir(RootDir, true)
CopyHelpersToDesktop(RepoName)

TrayTip, 색인 완료, % DirCount . "개 폴더를 색인하여 pages.json을 생성했습니다.", 3
ExitApp

; ------------------------------------------------------------
; indexer.ahk(본인)와 localserver.ahk를(둘 다 _NIH_ROOT_\tools\ 안에 있음) 바탕화면에
; 편의용으로 복사한다. localserver.ahk는 "{리포 이름} Manager.ahk"로 이름을 바꿔서 둔다.
; 실제로 있을 때만 복사하고(없으면 조용히 건너뜀), 복사 실패(권한 등)도 색인 자체를
; 막지 않도록 조용히 무시한다.
; ------------------------------------------------------------
CopyHelpersToDesktop(repoName) {
    global RootDir

    toolsDir := RootDir . "\_NIH_ROOT_\tools"

    selfSrc := toolsDir . "\indexer.ahk"
    if FileExist(selfSrc) {
        selfDest := A_Desktop . "\indexer.ahk"
        FileCopy, %selfSrc%, %selfDest%, 1
    }

    helperSrc := toolsDir . "\localserver.ahk"
    if FileExist(helperSrc) {
        helperDest := A_Desktop . "\" . repoName . " Manager.ahk"
        FileCopy, %helperSrc%, %helperDest%, 1
    }
}

; ------------------------------------------------------------
; dir 폴더 하나를 색인(pages.json 생성)하고, 하위 폴더로 재귀한다.
; isRoot = true 이면 루트 전용 예외 규칙도 함께 적용한다.
; ------------------------------------------------------------
IndexDir(dir, isRoot) {
    global DirCount
    folders := []
    files := []

    Loop, Files, %dir%\*, D
    {
        if ShouldExclude(A_LoopFileName, isRoot)
            continue
        folders.Push(A_LoopFileName)
    }
    Loop, Files, %dir%\*, F
    {
        if ShouldExclude(A_LoopFileName, isRoot)
            continue
        ; 웹훅(localserver.ahk)이 다운로드 전에 HEAD 요청 없이도 파일 크기를 알 수 있도록 size를 남긴다.
        ; CRC32도 같이 계산해 속성 창/무결성 확인에 쓸 수 있게 한다.
        fullPath := dir . "\" . A_LoopFileName
        files.Push({name: A_LoopFileName, size: A_LoopFileSize, crc32: FileCRC32Hex(fullPath)})
    }

    SortNamesKo(folders)
    SortFilesKo(files)

    WritePagesJson(dir, folders, files)
    DirCount++

    ; 폴더 먼저 위, 파일은 아래 -> pages.json에도 그 순서로 저장됨.
    ; 하위 폴더들로 재귀 (이때부터는 isRoot = false)
    for index, name in folders
        IndexDir(dir . "\" . name, false)
}

; ------------------------------------------------------------
; 제외 여부 판정
;  - 이름에 "_NIH_"가 포함되면(대소문자 무관) 어디서든 제외 (_NIH_ROOT_ 폴더 자체가 여기 걸려서
;    그 안의 indexer.ahk/localserver.ahk/menu.json까지 통째로 같이 빠진다)
;  - "pages.json"은 어디서든 제외
;  - 루트에서는 .git / index.html 도 추가로 제외
; ------------------------------------------------------------
ShouldExclude(name, isRoot) {
    global RootOnlyExclude, GlobalExactExclude

    if InStr(name, "_NIH_")
        return true

    for index, ex in GlobalExactExclude
        if (name = ex)
            return true

    if (isRoot) {
        for index, ex in RootOnlyExclude
            if (name = ex)
                return true
    }
    return false
}

; ------------------------------------------------------------
; 이름 배열 기본 정렬 (최종 정렬/한글 정렬은 index.html에서 다시 처리함)
; ------------------------------------------------------------
SortNamesKo(ByRef arr) {
    if (arr.Length() = 0)
        return
    list := ""
    for index, v in arr
        list .= v . "`n"
    list := RTrim(list, "`n")
    Sort, list
    arr := StrSplit(list, "`n")
}

; ------------------------------------------------------------
; files 배열은 {name, size, crc32} 객체라서 SortNamesKo를 그대로 못 쓴다.
; "이름`t크기`tcrc32`n" 형태의 줄로 만들어 이름 기준으로만 정렬한 다음 다시 객체로 되돌린다.
; ------------------------------------------------------------
SortFilesKo(ByRef arr) {
    if (arr.Length() = 0)
        return
    list := ""
    for index, f in arr
        list .= f.name . "`t" . f.size . "`t" . f.crc32 . "`n"
    list := RTrim(list, "`n")
    Sort, list
    lines := StrSplit(list, "`n")
    out := []
    for index, line in lines {
        parts := StrSplit(line, "`t")
        out.Push({name: parts[1], size: parts[2] + 0, crc32: parts[3]})
    }
    arr := out
}

; ------------------------------------------------------------
; 폴더 하나의 pages.json 작성
; -> {"folders":[...], "files":[{"name":...,"size":...,"crc32":"..."}, ...]}
; 파일 목록이 이전과 동일하면 덮어쓰지 않는다(수정 시간이 바뀌어 불필요한 커밋이 생기지 않도록).
; ------------------------------------------------------------
WritePagesJson(dir, folders, files) {
    json := "{`n  ""folders"": " . BuildJsonArray(folders) . ",`n  ""files"": " . BuildFilesJsonArray(files) . "`n}`n"

    outFile := dir . "\pages.json"
    if FileExist(outFile) {
        FileRead, existing, %outFile%
        ; 줄바꿈/공백 차이까지 포함해 바이트 단위로 동일하면 스킵 (수정 시간 유지)
        if (existing = json)
            return
        FileDelete, %outFile%
    }
    FileAppend, %json%, %outFile%, UTF-8-RAW
}

BuildJsonArray(arr) {
    if (arr.Length() = 0)
        return "[]"
    out := "["
    first := true
    for index, name in arr {
        out .= (first ? "" : ",") . "`n    """ . JsonEscape(name) . """"
        first := false
    }
    out .= "`n  ]"
    return out
}

BuildFilesJsonArray(arr) {
    if (arr.Length() = 0)
        return "[]"
    out := "["
    first := true
    for index, f in arr {
        crc := f.crc32
        if (crc = "")
            crc := "00000000"
        out .= (first ? "" : ",") . "`n    {""name"": """ . JsonEscape(f.name) . """, ""size"": " . f.size . ", ""crc32"": """ . crc . """}"
        first := false
    }
    out .= "`n  ]"
    return out
}

JsonEscape(str) {
    str := StrReplace(str, "\", "\\")
    str := StrReplace(str, """", "\""")
    return str
}

; ------------------------------------------------------------
; CRC32 (IEEE) - 파일 경로를 받아 8자리 대문자 16진 문자열로 돌려준다.
; ntdll\RtlComputeCrc32 사용 (순수 AHK 바이트 루프보다 훨씬 빠름).
; ------------------------------------------------------------
FileCRC32Hex(path) {
    crc := FileCRC32(path)
    ; AHK v1 호환: Format() 없이 8자리 대문자 16진수로 만든다.
    static hexDigits := "0123456789ABCDEF"
    out := ""
    Loop, 8 {
        nibble := (crc >> ((8 - A_Index) * 4)) & 0xF
        out .= SubStr(hexDigits, nibble + 1, 1)
    }
    return out
}

FileCRC32(path) {
    f := FileOpen(path, "r")
    if !IsObject(f)
        return 0

    ; 파일 포인터를 확실히 처음으로
    f.Seek(0)

    crc := 0
    chunkSize := 65536          ; 64KB (필요하면 262144 등으로 키워도 됨)
    VarSetCapacity(buf, chunkSize, 0)

    ; RawRead가 0을 반환하면 EOF → 루프 종료 (AtEOF 의존 제거)
    while (bytesRead := f.RawRead(buf, chunkSize)) {
        if (bytesRead <= 0)
            break
        crc := DllCall("ntdll\RtlComputeCrc32"
            , "UInt", crc
            , "Ptr", &buf
            , "UInt", bytesRead
            , "UInt")
    }
    f.Close()
    return crc
}