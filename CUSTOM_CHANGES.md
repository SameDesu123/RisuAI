# Custom Changes (stable-version-future)

This branch maintains custom modifications on top of `upstream/main` (kwaroran/RisuAI).

## Build

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm run build
```

## Custom Commits

### 1. feat: restore support and importing for API version 2.0 plugins
- **File**: `src/ts/plugins/plugins.svelte.ts`
- API v2.0 plugin import/load 지원 복원

### 2. perf: make backup write non-blocking (fire-and-forget)
- **File**: `src/ts/globalApi.svelte.ts`
- backup write를 비동기 fire-and-forget으로 변경하여 메인 저장 프로세스 블로킹 방지

### 3. perf: enable gzip compression for Node server save encoding
- **File**: `src/ts/globalApi.svelte.ts`
- Node 서버 저장 시 gzip 압축 활성화

### 4. feat: implement server-side keepalive in Node proxy
- **File**: `server/node/server.cjs`
- proxy 요청 시 서버측 keepalive로 연결 유지 (타임아웃 방지)

### 5. fix: prevent stream truncation in proxy and client
- **Files**: `server/node/server.cjs`, `src/ts/globalApi.svelte.ts`, `src/ts/process/index.svelte.ts`
- 스트리밍 응답이 잘리는 문제 수정

### 6. fix: prevent streaming last-chunk truncation in SSE parsers
- **Files**: `src/ts/process/request/google.ts`, `src/ts/process/request/openAI/requests.ts`
- SSE 파서에서 마지막 청크가 누락되는 문제 수정
- `parseLines` 함수를 외부로 추출하고 `flush` 핸들러 추가
- 라인 기반 버퍼링으로 불완전한 JSON 파싱 방지

### 7-8. fix: pipeTo with preventAbort
- **Files**: `src/ts/process/request/google.ts`, `src/ts/process/request/openAI/requests.ts`
- `pipeTo`에 `{ preventAbort: true }` 옵션 추가
- 소스 스트림 에러 시 writable 측을 graceful하게 close

### 9. fix: ensure final streamed chunk is persisted to chat storage
- **File**: `src/ts/process/index.svelte.ts`
- **Root Cause**: 스트리밍 루프에서 각 청크를 Svelte `$state` 프록시를 통해 `message.data`에 기록하는데, 마지막 청크의 쓰기가 `structuredClone` 시점에 프록시에서 아직 반영되지 않을 수 있음. 또한 `removeIncompleteResponse` 옵션이 마지막 완성된 응답에도 적용되어 텍스트 끝부분이 잘릴 수 있음.
- **Fix**: 스트리밍 루프 종료 후, `structuredClone` 전에 `lastResponseChunk`의 원본 데이터로 `message.data`를 한 번 더 명시적으로 설정. `trimUntilPunctuation`은 완성된 응답에 적용하지 않음.
- **핵심 코드** (line ~1554):
  ```typescript
  if(Object.keys(lastResponseChunk).length > 0) {
      const firstChunkKey = Object.keys(lastResponseChunk)[0]
      let finalResult = lastResponseChunk[firstChunkKey] || ''
      let finalProcessed = await processScriptFull(
          nowChatroom, reformatContent(prefix + finalResult), 'editoutput', msgIndex
      )
      DBState.db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = finalProcessed.data
  }
  ```
- **Conflict Reapply Guide**: 스트리밍 while 루프(`while(abortSignal.aborted === false)`)가 끝난 직후, `addRerolls` 호출 전에 위 코드를 삽입. `lastResponseChunk`, `prefix`, `processScriptFull`, `reformatContent` 변수가 스코프에 있어야 함.

### 10. fix: process deferred final event in Anthropic SSE parser
- **File**: `src/ts/process/request/anthropic.ts`
- **Root Cause**: Anthropic 파서는 `i--; text = prevText` 패턴으로 매 반복마다 마지막 파싱 이벤트를 다음 반복으로 지연. `done: true` 시 다음 반복이 없어 해당 이벤트가 영구 유실됨.
- **Fix**: `done: true` 블록에서 지연된 이벤트를 재처리하고 최종 텍스트를 enqueue.
- **핵심 코드** (line ~804):
  ```typescript
  if(done){
      let finalParts = parserData.split('\n')
      for(;i<finalParts.length;i++){
          if(finalParts?.[i]?.startsWith('data: ')){
              await parseEvent(finalParts[i].slice(6))
          }
      }
      controller.enqueue({"0": text})
      break
  }
  ```
- **Conflict Reapply Guide**: `const {done, value} = await reader.read()` 직후의 `if(done)` 블록 내부에 위 코드를 삽입. 기존 `break`만 있던 것을 교체. `parserData`, `i`, `parseEvent`, `text` 변수가 스코프에 있어야 함.

### 11. fix: add preventAbort to OpenAI tool-retry pipeTo
- **File**: `src/ts/process/request/openAI/requests.ts`
- **Root Cause**: `wrapToolStream` 내 도구 재시도 경로의 `pipeTo`에 `preventAbort` 옵션이 누락. 소스 스트림 에러 시 writable이 즉시 abort되어 `flush()`가 실행되지 않고 버퍼 데이터 유실.
- **Fix**: `{ preventAbort: true }` 추가 및 `.catch()` 핸들러로 에러 시 수동 close.
- **핵심 코드** (line ~1417):
  ```typescript
  resRec.body.pipeTo(transtream.writable, { preventAbort: true }).catch(async () => {
      try { await transtream.writable.close() } catch (_) {}
  })
  ```
- **Conflict Reapply Guide**: `wrapToolStream` 함수 내에서 도구 호출 후 재요청하는 경로의 `pipeTo` 호출 찾기. 메인 경로(함수 최상위)에는 이미 적용되어 있으므로, `wrapToolStream` 내부의 `pipeTo`만 확인.

### 12. feat: implement diff-based incremental save for NodeStorage
- **Files**: `server/node/server.cjs`, `src/ts/storage/risuSave.ts`, `src/ts/storage/nodeStorage.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/bootstrap.ts`
- **Root Cause**: NodeStorage(자체 호스팅 서버)에서 매 저장마다 전체 `database.bin`을 전송. DB가 커지면 수십~수백MB를 매번 보내게 되어 저장/로딩 모두 느려짐.
- **Fix**: `RisuSaveEncoder`가 이미 블록 단위로 관리하는 것을 활용하여, 변경된 블록만 서버에 전송하는 diff 기반 저장 시스템 구현.
- **서버 변경** (`server/node/server.cjs`):
  - 4개 새 엔드포인트: `GET /api/save-capabilities`, `GET /api/save-manifest`, `POST /api/save-diff`, `GET /api/save-blocks`
  - 블록별 파일 저장: `save/__dbblocks/` 디렉토리에 매니페스트 + 개별 블록 파일
  - 자동 마이그레이션: 기존 모놀리식 `database.bin`에서 블록 스토리지로 첫 save-diff 시 자동 변환
  - 원자적 쓰기: `.tmp` → rename 패턴 + 매니페스트 backup
  - 인메모리 mutex로 동시 저장 직렬화
- **클라이언트 변경**:
  - `RisuSaveEncoder` (`risuSave.ts`): `changedBlockNames`, `deletedBlockNames` 추적 + `getChangedBlocks()`, `getDeletedBlockNames()`, `clearChangeTracking()` + `hashBlock()` 유틸
  - `NodeStorage` (`nodeStorage.ts`): `supportsDiffSave()`, `getManifest()`, `saveDiff()`, `getBlocks()` 메서드
  - `globalApi.svelte.ts`: 저장 루프에서 NodeStorage + diff 지원 시 변경 블록만 전송, 미지원 시 기존 전체 저장 fallback
  - `bootstrap.ts`: 로딩 시 매니페스트 확인 → 블록별 로딩 → RISUSAVE 재조립 → decode, 실패 시 모놀리식 fallback
- **바이너리 프로토콜** (save-diff):
  ```
  [headerLen:4B LE][header JSON][blocks...]
  Header: { changedBlocks: { [name]: { hash, size } }, deletedBlocks: [], clientManifestVersion }
  Each block: [nameLen:2B LE][name UTF-8][dataLen:4B LE][block data]
  ```
  블록 데이터는 RISUSAVE 블록 포맷 그대로 (type+compression+name+data) 전송.
- **하위 호환**: `GET /api/save-capabilities`가 404 반환 시 구버전 서버로 판단 → 기존 전체 저장 사용.
- **Conflict Reapply Guide**:
  - `server.cjs`: 기존 `/api/write` 엔드포인트 뒤에 블록 저장 시스템 코드 블록 삽입 (`// ─── Block-based diff save system ───` 주석으로 구분)
  - `risuSave.ts`: `RisuSaveEncoder` 클래스에 `changedBlockNames`/`deletedBlockNames` 필드 + getter/clear 메서드 추가. `set()` 내 각 블록 재인코딩 시 `this.changedBlockNames.add(name)` 호출. 클래스 바로 위에 `hashBlock()` export 함수 추가.
  - `nodeStorage.ts`: `NodeStorage` 클래스에 `_diffSaveSupported`, `supportsDiffSave()`, `getManifest()`, `saveDiff()`, `getBlocks()` 추가
  - `globalApi.svelte.ts`: `saveDb()` 함수 내 `encoder.set()` 호출 후, `isNodeServer && nodeStorageRef && supportsDiffSave()` 분기 추가
  - `bootstrap.ts`: `else` (non-Tauri) 분기 내, `forageStorage.Init()` 직후에 블록 로딩 시도 추가

### 13. feat: implement JSON-patch level incremental save
- **Files**: `src/ts/storage/jsonPatch.ts` (new), `server/node/server.cjs`, `src/ts/storage/risuSave.ts`, `src/ts/storage/nodeStorage.ts`, `src/ts/globalApi.svelte.ts`, `src/ts/bootstrap.ts`
- **Root Cause**: 블록 단위 diff save(커밋 12)는 변경된 블록 전체를 전송. 캐릭터 블록 하나가 수 MB이므로 메시지 1개 추가해도 전체 블록 전송됨.
- **Fix**: 블록의 이전/현재 JSON 스냅샷을 비교하여 필드 레벨 JSON 패치를 생성, 패치만 서버에 전송. 서버가 패치를 적용하고 `.bin` + `.json` 듀얼 저장.
- **클라이언트 변경**:
  - `jsonPatch.ts`: `generatePatch()` diff 엔진 (배열 append 최적화, 최대 깊이 10, 최대 200 ops)
  - `RisuSaveEncoder`: `previousJsonSnapshots`, `currentJsonStrings` Map 추가. `getChangedBlocksWithPatches()` → 패치 가능하면 패치, 아니면 전체 블록 반환. `promoteSnapshots()`, `initSnapshots()` 스냅샷 생명주기 관리.
  - `NodeStorage`: `supportsJsonPatch()`, `saveJsonPatch()` 메서드 추가
  - `globalApi.svelte.ts`: 저장 루프에서 패치 우선 → rejected/fullBlocks는 save-diff로 fallback
  - `bootstrap.ts`: 블록 로딩 후 `buildBlockJsonSnapshots()` → `setInitialBlockJsonSnapshots()`로 첫 저장부터 패치 사용
- **서버 변경** (`server.cjs`):
  - `save-capabilities` v2: `{ diffSave: true, jsonPatch: true, version: 2 }`
  - `POST /api/save-json-patch`: JSON 패치 수신 → `.json` 로드 → `applyJsonPatch()` → SHA-256 해시 검증 → `.json` + `.bin` 원자적 저장
  - `extractJsonFromBlock()`, `encodeJsonToBlock()`, `applyJsonPatch()` 헬퍼 함수
  - `save-diff` 수정: 블록 저장 시 `.json` 파일도 함께 생성 (듀얼 저장)
  - 블록 삭제 시 `.bin` + `.json` 모두 삭제
- **패치 프로토콜** (JSON):
  ```json
  POST /api/save-json-patch
  { "patches": { "blockName": [{ "op": "append", "path": "/chats/0/message", "items": [...] }] },
    "expectedHashes": { "blockName": "sha256hex" },
    "deletedBlocks": [], "manifestVersion": 5 }
  // 응답: { "version": 6, "blocks": {...}, "rejected": [] }
  ```
- **Fallback**: 이전 스냅샷 없음/패치 비효율(>70%)/해시 불일치 → 전체 블록 save-diff 사용
- **Conflict Reapply Guide**:
  - `jsonPatch.ts`: 새 파일, 충돌 없음
  - `server.cjs`: `// ─── JSON Patch helpers ───` 주석 블록 + `POST /api/save-json-patch` 엔드포인트 추가. `save-diff`의 블록 저장 루프에 `.json` 추출/저장 추가. `save-capabilities` 응답에 `jsonPatch: true` 추가.
  - `risuSave.ts`: `RisuSaveEncoder`에 `currentJsonStrings`, `previousJsonSnapshots` 필드 + `set()`에서 JSON string 캡처 + `getChangedBlocksWithPatches()`, `promoteSnapshots()`, `initSnapshots()` 메서드 + `hashString()` export 추가
  - `nodeStorage.ts`: `_jsonPatchSupported` 필드 + `supportsJsonPatch()`, `saveJsonPatch()` 추가
  - `globalApi.svelte.ts`: `initialBlockJsonSnapshots` + `setInitialBlockJsonSnapshots()` 변수/함수. `saveDb()` 내 encoder init 후 스냅샷 초기화. 저장 루프에서 `supportsJsonPatch()` 분기 추가.
  - `bootstrap.ts`: `buildBlockJsonSnapshots()` 함수 + 블록 로딩 성공 후 `setInitialBlockJsonSnapshots()` 호출

### 14. fix: prevent save data loss from block loading failures
- **Files**: `src/ts/bootstrap.ts`, `src/ts/storage/risuSave.ts`
- **Root Cause**: 로딩 중 블록 로드 실패나 타임아웃 발생 시 에러가 조용히 처리되고 빈 상태로 초기화되어 기존 저장 데이터가 덮어씌워질 위험이 있었음. 또한 `RisuSaveEncoder` 초기화 시 `forageStorage.keys()`를 블록마다 반복 호출하여 성능이 저하됨.
- **Fix**: `bootstrap.ts`에서 로딩 실패로 인해 데이터가 비어있을 경우 명시적으로 에러를 스로우하여 유실을 방지. `risuSave.ts`에서 `cachedStorageKeys`를 도입해 반복적인 keys() 호출을 최적화.

### 15. fix(nodeServer): gracefully handle SPA HTML fallback in NodeStorage API fetch
- **File**: `src/ts/storage/nodeStorage.ts`
- **Root Cause**: Node 서버 측 라우팅 문제나 404 시 SPA fallback으로 인해 HTML이 반환될 때 이를 JSON으로 파싱하려다 발생하는 `Unexpected token '<'` 에러.
- **Fix**: fetch 응답 헤더의 `content-type`이 `application/json`을 포함하는지 먼저 확인하도록 조건문 추가.

### 16. fix(storage): cast Uint8Array to BufferSource in hashBlock to fix type error
- **File**: `src/ts/storage/risuSave.ts`
- **Root Cause**: 타입스크립트의 `crypto.subtle.digest` 인자 타입 호환 문제(`Uint8Array<ArrayBufferLike>` -> `BufferSource`).
- **Fix**: 타입 에러 방지를 위해 명시적으로 `as BufferSource` 타입 단언 추가.

### 17. fix: apply additional parameters to OpenAIResponseAPI format
- **File**: `src/ts/process/request/openAI/requests.ts`
- **Root Cause**: OpenAI Response API 포맷(`requestOpenAIResponseAPI`) 사용 시 `reverse_proxy` 및 `xcustom:::` 모델의 추가 파라미터(`additionalParams`, `customModels[].params`)가 적용되지 않아 커스텀 헤더나 바디 파라미터를 설정할 수 없음.
- **Fix**: `requestOpenAIResponseAPI` 함수에 기존 `requestOpenAI`와 동일한 추가 파라미터 처리 로직 추가. `header::` 접두사, `json::` 접두사, `{{none}}` 삭제, 타입 추론(boolean/null/number/string) 등 모든 케이스 지원.
- **Conflict Reapply Guide**: `requestOpenAIResponseAPI` 함수 내 `headers["X-Proxy-Risu"]` 설정 직후, `previewBody` 체크 전에 추가 파라미터 적용 블록 삽입.

### 18. fix(auth): dynamically generate risu-auth token in fetchWithProxy and fetchNative
- **File**: `src/ts/globalApi.svelte.ts`
- **Root Cause**: `fetchWithProxy`와 `fetchNative`가 `localStorage.getItem('risuauth')`로 인증 토큰을 읽지만, 이 키는 코드베이스 어디에서도 설정되지 않음. `NodeStorage.createAuth()`가 동적으로 JWT를 생성하지만 localStorage에 저장하지 않아, Node.js 서버 사용자의 `/proxy2` 프록시 요청이 항상 `{"error":"No auth header"}` 400 에러로 실패.
- **Fix**: `forageStorage.realStorage`를 통해 `NodeStorage.createAuth()`를 호출하는 `getNodeAuth()` 헬퍼 함수 추가. `fetchWithProxy`와 `fetchNative`의 localStorage 읽기를 동적 JWT 생성으로 교체.
- **핵심 코드**:
  ```typescript
  async function getNodeAuth(): Promise<string | null> {
      if (!isNodeServer) return null
      try {
          if (forageStorage.realStorage instanceof NodeStorage) {
              return await forageStorage.realStorage.createAuth()
          }
      } catch (e) {
          console.error('Failed to generate node auth token:', e)
      }
      return null
  }
  ```
- **Conflict Reapply Guide**: `forageStorage` 선언 직후에 `getNodeAuth()` 함수 추가. `fetchWithProxy` 내 `localStorage.getItem('risuauth')` → `await getNodeAuth()`, `fetchNative` 내 인라인 spread → `const nodeAuth = await getNodeAuth()` + `...authHeaders`로 교체.

### 19. perf: 코드베이스 전반 성능 최적화 (32 commits)

전체 코드베이스를 스캔하여 반복적인 비효율 패턴을 최적화. 각 변경은 독립 커밋으로 분리됨.

#### 주요 최적화 패턴

**1. Array.includes() → Set.has() (O(n) → O(1) 조회)**
- `src/ts/process/scripts.ts` — flag 중복 제거 Set
- `src/ts/storage/accountStorage.ts` — seenWarnings Set
- `src/ts/process/triggers.ts` — allowlist Set들, 역방향 순회, 단일패스 루프
- `src/ts/globalApi.svelte.ts` — 채팅명 유일성 검사 Set
- `src/ts/process/stringlize.ts` — 청크 중복제거 Set
- `server/node/server.cjs` — knownPublicKeysHashes, excludedHeaders Set
- `src/ts/plugins/pluginSafeClass.ts` — tagWhitelist, allowedEvents Set
- `src/ts/plugins/apiV3/v3.svelte.ts` — authorizationHeaders Set
- `src/ts/sync/multiuser.ts` — excludeAssets Set
- `src/ts/characterCards.ts` — tag 중복제거 Set
- `src/ts/util.ts` — tag 제외 검색 Set
- `src/ts/process/memory/hypav3.ts` — selectedSummarySet (2곳)
- `src/ts/process/templates/templateCheck.ts` — range resolution Set
- `src/ts/process/lorebook.svelte.ts` — activatedIndexSet
- `src/ts/parser/parser.svelte.ts` — imageCBS, videoExtensions, blobSrcNodeNames Set
- `src/ts/translator/translator.ts` — BLACKLIST_NODES Set
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte` — moduleIntegrationSet

**2. Map 기반 O(1) 조회 인덱스**
- `src/ts/drive/drive.ts` — fileNames Set + fileMap for O(1) 파일 조회
- `src/ts/model/modellist.ts` — lazy Map 인덱스 (getModelInfo O(1))
- `src/ts/process/memory/hypav3.ts` — summaryIndexMap for 정렬 비교자

**3. 불필요한 객체 복사/비교 최적화**
- `src/ts/cbs.ts` — JSON.parse/stringify → structuredClone
- `src/ts/storage/jsonPatch.ts` — JSON.stringify 비교 → key-by-key 비교
- `server/node/server.cjs` — structuredClone 사용
- `src/ts/process/transformers.ts` — hasOwnProperty.call

**4. 정규식/문자열 최적화**
- `src/ts/process/request/request.ts` — 반복 루프 전 정규식 사전 컴파일
- `src/ts/process/request/google.ts` — 단일패스 thought/content 분리
- `src/ts/process/stableDiff.ts` — 6단계 replaceAll → 단일 정규식
- `src/ts/parser/parser.svelte.ts` — replaceAll('\n','').replaceAll('\t','') → /[\n\t]/g 합침
- `src/ts/process/memory/hypamemoryv2.ts`, `hypamemory.ts` — Object.keys().includes() → `in` 연산자

**5. 캐시/바운딩**
- `src/ts/process/index.svelte.ts` — 무한 객체 캐시 → 50엔트리 바운디드 Map (FIFO)
- `src/ts/gui/branches.ts` — 재귀 slice(1) → index 파라미터
- `src/ts/process/memory/supaMemory.ts` — 메모리 미변경 시 불필요한 split 회피

**6. UI 컴포넌트 최적화**
- `src/lib/ChatScreens/Chat.svelte` — CSS getPropertyValue 결과 캐싱 (17회 → 6회 호출)
- `src/lib/ChatScreens/ChatBody.svelte` — 이미지 루프 밖으로 에셋 계산 호이스팅 + Map
- `src/lib/Others/GridCatalog.svelte` — 검색어 toLowerCase 루프 밖으로 호이스팅
- `src/lib/Mobile/MobileCharacters.svelte` — $derived로 검색어 캐싱
- `src/lib/Playground/PlaygroundDocs.svelte` — 검색어 $derived 캐싱
- `src/lib/Setting/Pages/BotSettings.svelte` — 검색어 $derived 사전 분리
- `src/lib/Setting/Pages/Module/ModuleChatMenu.svelte`, `ModuleSettings.svelte` — sortModules 내 toLowerCase 캐싱

**7. 디버그 로그 제거**
- `src/ts/process/stringlize.ts` — 4개 console.log 제거
- `src/ts/parser/parser.svelte.ts` — 4개 console.log 제거
- `src/ts/process/stableDiff.ts` — 9개 console.log 제거
- `src/ts/translator/translator.ts` — 5개 console.log 제거
- `src/lib/ChatScreens/ChatBody.svelte` — 2개 console.log 제거

#### Conflict Reapply Guide
성능 최적화는 대부분 기존 코드의 데이터 구조 교체이므로, upstream 변경 시:
1. `Array` → `Set` 변환: 해당 배열이 upstream에서 변경되었으면, 새 값으로 Set을 다시 생성
2. `.includes()` → `.has()`: upstream에서 새 `.includes()` 호출이 추가되었으면 `.has()`로 교체
3. 캐시 변수: upstream에서 해당 함수가 리팩토링되었으면, 새 구조에 맞게 캐시 재배치
4. console.log 제거: upstream에서 새 디버그 로그가 추가될 수 있으므로, 빌드 후 확인 권장

## Conflict-Prone Files

향후 `upstream/main`과 병합 시 충돌 가능성이 높은 파일:

| File | Reason |
|------|--------|
| `server/node/server.cjs` | keepalive, stream 관련 커스텀 로직 + diff save 시스템 + Set 최적화 |
| `src/ts/process/request/google.ts` | SSE parser 구조 변경 (parseLines/flush) + 단일패스 최적화 |
| `src/ts/process/request/openAI/requests.ts` | SSE parser 구조 변경 (parseLines/flush) |
| `src/ts/plugins/plugins.svelte.ts` | API v2.0 지원 추가 |
| `src/ts/process/index.svelte.ts` | stream truncation fix + final chunk persistence + bounded Map cache |
| `src/ts/process/request/anthropic.ts` | SSE parser deferred event fix |
| `src/ts/storage/risuSave.ts` | RisuSaveEncoder 변경 추적 및 캐싱 로직 추가 |
| `src/ts/storage/nodeStorage.ts` | diff save transport 및 예외 처리 로직 추가 |
| `src/ts/globalApi.svelte.ts` | 저장 루프 diff 분기 + getNodeAuth 헬퍼 + Set 최적화 |
| `src/ts/bootstrap.ts` | 블록 단위 로딩 로직 및 에러 처리 경로 추가 |
| `src/ts/process/triggers.ts` | 다수 Set 변환 및 루프 최적화 |
| `src/ts/parser/parser.svelte.ts` | Set 변환 + console.log 제거 |
| `src/ts/model/modellist.ts` | lazy Map 인덱스 추가 |
| `src/ts/process/memory/hypav3.ts` | selectedSummarySet + summaryIndexMap |
| `src/ts/plugins/pluginSafeClass.ts` | tagWhitelist, allowedEvents Set 변환 |

## How to Sync with Upstream

```bash
# 1. upstream 최신 가져오기
git fetch upstream

# 2. local main 업데이트
git checkout main
git merge upstream/main

# 3. 커스텀 브랜치에 merge (rebase 아닌 merge 사용)
git checkout stable-version-future
git merge main

# 4. 충돌 해결 후 빌드 검증
NODE_OPTIONS="--max-old-space-size=6144" pnpm run build

# 5. push
git push origin stable-version-future
```

> **Note**: `merge`를 사용하면 이전에 해결한 충돌이 다음 병합 시 다시 발생하지 않습니다.
> `rebase`는 깔끔한 히스토리를 유지하지만 매번 같은 충돌을 다시 해결해야 할 수 있습니다.

## Backup Branch

병합 전 항상 백업 브랜치를 생성하는 것을 권장합니다:
```bash
git branch stable-version-future-backup-$(date +%Y%m%d)
```
