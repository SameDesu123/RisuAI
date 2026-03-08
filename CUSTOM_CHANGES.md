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

## Conflict-Prone Files

향후 `upstream/main`과 병합 시 충돌 가능성이 높은 파일:

| File | Reason |
|------|--------|
| `server/node/server.cjs` | keepalive, stream 관련 커스텀 로직 |
| `src/ts/process/request/google.ts` | SSE parser 구조 변경 (parseLines/flush) |
| `src/ts/process/request/openAI/requests.ts` | SSE parser 구조 변경 (parseLines/flush) |
| `src/ts/plugins/plugins.svelte.ts` | API v2.0 지원 추가 |
| `src/ts/process/index.svelte.ts` | stream truncation fix |

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
