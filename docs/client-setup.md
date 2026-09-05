# 공통 로그인·모델 갱신·문제 해결

먼저 환경별 안내를 선택합니다: [Windows](README.windows.md) · [macOS](README.macos.md) · [Linux / WSL](README.linux.md).

아래 명령은 macOS/Linux 셸 기준입니다. PowerShell에서는 `npx` 대신 `npx.cmd`를 사용하면 됩니다. 예시 URL은 Happycastle 게이트웨이이며 다른 서버를 사용한다면 URL을 바꿉니다.

## 로그인과 설치

```sh
npx --yes @happycastle/opencode-litellm@latest login --base-url https://llm.soungmin.kr
npx --yes @happycastle/opencode-litellm@latest whoami --base-url https://llm.soungmin.kr
npx --yes @happycastle/opencode-litellm@latest install --target both --base-url https://llm.soungmin.kr --codex-mode gateway
```

SSO는 해당 게이트웨이에 로그인할 권한이 있어야 합니다. 기존 키가 폐기되었다면 이전 키가 포함된 배치 파일을 다시 실행해도 복구되지 않습니다. 다시 로그인하거나 새 키로 대화형 설치를 진행합니다.

환경변수로 키를 공급한 설치는 실행 때도 해당 환경변수가 필요합니다. 대화형으로 입력한 키와 SSO 토큰은 사용자 토큰 파일을 사용합니다. 토큰 파일을 다른 학생에게 복사하지 않습니다.

## 모델 목록과 자동 라우팅

모델 선택지는 로그인한 사용자의 `GET /v1/models` 결과를 기준으로 합니다. 학생 정책이 적용된 계정에서는 다음 네 모델을 기대합니다.

| 모델 | 용도 |
|---|---|
| `student-auto` | 기본 선택. 서버가 요청 난이도에 따라 모델 결정 |
| `gpt-5.6-luna` | 간단한 질문과 일상적인 작업 |
| `gpt-5.6-terra` | 복잡한 구현과 문제 해결 |
| `gpt-6-astra` | 깊은 추론이 필요한 작업 |

학생용 네 모델이 확인되면 제목·요약 등에 쓰는 OpenCode의 `small_model`은 `gpt-5.6-luna`로 설정합니다. OMO 에이전트와 작업 카테고리의 모델 배정은 아래 중앙 정책으로 별도 관리합니다.

실제 허용 목록과 자동 라우팅 정책은 서버 관리자가 관리합니다. 로컬 목록에 모델을 수동 추가해도 서버 접근 권한이 생기지 않습니다.

OpenCode 플러그인은 시작 시 모델을 조회합니다. 0.7.15부터 `codex-litellm` CLI 런처는 gateway 모드 실행마다 서버의 허용 모델을 조회해 로컬 카탈로그를 갱신한 뒤 Codex를 시작합니다. 권한이 사라진 모델은 목록에서 제거하며, 현재 선택이 계속 허용되면 유지합니다. 현재 선택이 허용되지 않고 학생용 네 모델이 반환되면 `student-auto`를 기본값으로 사용합니다. 인증 거절(HTTP 401/403)이나 비어 있거나 잘못된 응답이면 실행을 중단합니다. 일시적인 연결 오류나 HTTP 429/5xx에서는 기존의 검증된 카탈로그가 있을 때만 경고 후 실행합니다. OAuth 전용 모드는 내장 카탈로그를 사용합니다.

이 갱신은 툴킷 CLI 런처를 실행할 때 적용됩니다. Codex 데스크톱 앱 아이콘으로 열면 런처를 거치지 않으므로 서버 카탈로그를 자동 갱신하지 않습니다. 이미 실행 중인 Codex의 `/model` 목록도 자동으로 갱신되지 않으므로, 변경된 권한을 반영하려면 런처로 새로 실행하세요.

```sh
npx --yes @happycastle/opencode-litellm@latest doctor --target both --json
opencode models litellm
```

Codex 안에서는 `/model`을 확인합니다. `codex debug models --bundled`는 Codex에 내장된 참조 카탈로그를 보여주며 서버의 허용 모델 확인용이 아닙니다. `doctor`도 실제 생성 성공을 대신하지 않으므로, 모델 선택 후 짧은 질문을 보내 응답까지 확인합니다.

## OMO 에이전트·카테고리 모델 중앙 관리

OMO의 `agents`와 `categories`에 배정할 모델은 서버 정책으로 관리합니다. 관리자는 GitOps 저장소에서 `student-auto`의 `model_info.metadata.omo`를 수정하고 배포합니다. 정책은 기존 물리 모델인 `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-6-astra`를 역할별로 지정합니다. 역할마다 새로운 모델 별칭을 만들 필요는 없습니다.

학생은 최신 툴킷으로 설치한 뒤 OpenCode를 다시 시작하면 됩니다. OpenChamber를 사용한다면 실행 중인 OpenCode 백엔드도 다시 시작해야 합니다. LiteLLM 플러그인이 서버의 허용 모델과 OMO 정책을 읽고 로컬 OMO 설정에 반영한 다음 OMO가 초기화됩니다. 설치 프로그램이 이 순서를 맞추므로 학생이 로컬 역할별 모델을 직접 편집할 필요는 없습니다. 이미 실행 중인 세션에는 재시작 전 정책이 남을 수 있습니다.

서버 정책에 포함된 LiteLLM 역할의 모델과 대체 모델 목록을 갱신하므로, 그 역할에 남아 있던 Qwen/ZAI 대체 모델도 새 정책으로 교체됩니다. 프롬프트 등 모델과 무관한 로컬 설정은 유지합니다. 다른 공급자의 모델을 명시적으로 지정한 역할은 그대로 두므로, 그런 역할까지 중앙 정책으로 전환하려면 관리자가 기존 설정을 확인해야 합니다.

서버 정책에서 대체 모델을 비워 두면 로컬 OMO 설정에는 같은 기본 모델을 대체 항목으로 기록해 OMO 내장 설정이 다른 공급자로 넘어가지 않도록 합니다. 이전 로컬 스트리밍 복구 코드의 Sol/Luna 자동 전환은 사용하지 않으며, 실제 모델 fallback은 게이트웨이 정책이 담당합니다.

서버 정책의 모델은 해당 학생에게 허용된 목록 안에 있어야 합니다. 역할 모델이 예전 값이라면 설치한 툴킷 버전, LiteLLM 플러그인 순서, OpenCode 백엔드 재시작 여부를 먼저 확인합니다. 이 OMO 설정은 OpenCode용이며 Codex의 모델 선택이나 제목·요약용 `small_model`과는 별개입니다.

## 문제 해결

| 증상 | 확인할 내용 |
|---|---|
| `401 Unauthorized` | 폐기/만료된 키인지 확인하고 다시 로그인 또는 키 갱신 |
| `403` / 모델 접근 거절 | 서버의 학생 팀·키 권한 확인. 모델 이름은 위의 정확한 이름 사용 |
| 모델이 안 보임 | 설치 명령 재실행 후 재시작. 다른 계정/게이트웨이 설정인지 확인 |
| 실행 파일을 찾지 못함 | 같은 터미널에서 `opencode --version`, `codex --version` 확인 |
| 설치 후에도 이전 설정 사용 | 설치 대상과 실행 환경, 별칭/고정 버전 래퍼 확인 |
| 네트워크 오류 | 게이트웨이 접속과 서버 상태 확인. 반복 로그인으로 해결되지 않을 수 있음 |

업데이트할 때는 환경별 설치 명령을 다시 실행합니다. 새 설치 결과를 확인한 뒤 클라이언트를 다시 엽니다. 오류를 공유할 때 키, 토큰 파일 내용, 개인정보는 제외합니다.
