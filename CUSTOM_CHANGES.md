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

## Conflict-Prone Files

향후 `upstream/main`과 병합 시 충돌 가능성이 높은 파일:

| File | Reason |
|------|--------|
| `server/node/server.cjs` | keepalive, stream 관련 커스텀 로직 |
| `src/ts/process/request/google.ts` | SSE parser 구조 변경 (parseLines/flush) |
| `src/ts/process/request/openAI/requests.ts` | SSE parser 구조 변경 (parseLines/flush) |
| `src/ts/plugins/plugins.svelte.ts` | API v2.0 지원 추가 |
| `src/ts/process/index.svelte.ts` | stream truncation fix + final chunk persistence |
| `src/ts/process/request/anthropic.ts` | SSE parser deferred event fix |

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
