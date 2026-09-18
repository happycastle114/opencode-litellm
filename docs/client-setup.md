# 공통 로그인·모델 갱신·문제 해결

먼저 환경별 안내를 선택합니다: [Windows](README.windows.md) · [macOS](README.macos.md) · [Linux / WSL](README.linux.md).

아래 명령은 macOS/Linux 셸 기준입니다. PowerShell에서는 `npx` 대신 `npx.cmd`를 사용하면 됩니다. 특정 서비스 가입은 필요하지 않습니다. 예시의 `https://your-gateway.example`은 관리자가 알려 준 LiteLLM 서버 주소로 바꿉니다.

## 처음 사용하는 경우

Node.js와 Codex를 설치하고 게이트웨이 주소·API 키를 준비합니다. API 키 방식은 Python이나 `lite` 설치가 필요 없습니다.

```sh
npx --yes @happycastle/codex-litellm@latest install --auth env --codex-mode gateway
npx --yes @happycastle/codex-litellm@latest codex
```

설치 화면에서 주소와 키를 입력하고 계획을 확인합니다. 실행 후 `/model`에서 해당 계정에 허용된 모델을 고릅니다.

개인 구독을 먼저 쓰고 소진 시 LiteLLM으로 전환하려면 설치 명령의 모드를 `--codex-mode hybrid-client`로 바꿉니다. 설치 화면에서 **추가 과금에 사용할 모델을 직접 선택**합니다. Codex 실행 후 요청하는 ChatGPT 로그인은 게이트웨이 로그인과 별개입니다.

| 모드 | 사용할 환경 |
|---|---|
| `gateway` | 일반 LiteLLM 서버의 모델만 사용 |
| `hybrid-client` | 일반 서버에서 구독+LiteLLM 통합. 위 실행 명령으로 로컬 프록시를 유지 |
| `hybrid-server` | 관리자가 `/codex-hybrid` 확장을 설치한 서버에서 전환 |
| `oauth` / `both` | `/codex-oauth` 확장이 있는 서버. `both`는 프로필을 수동으로 전환 |

통합 모드의 기본 선택인 **Auto**는 구독 한도 소진이 확인되고 아직 출력이 없을 때 선택한 LiteLLM 모델로 전환하며 추가 과금될 수 있습니다. **Subscription**은 구독만, **LiteLLM**은 게이트웨이를 바로 사용합니다. 전환 모델을 바꾸려면 설치를 다시 실행합니다. 앱 아이콘으로 열면 `hybrid-client` 프록시가 시작되지 않으므로 위 런처 명령으로 실행합니다. 비대화형 설치에는 `--codex-fallback-model <모델ID>`도 명시해야 합니다.

일반 서버는 `GET /v1/models`와 `POST /v1/responses`를 지원해야 합니다. 검색·MCP 기능은 선택 사항입니다. 공식 [`lite codex`](https://docs.litellm.ai/docs/proxy/management_cli)와 같은 custom provider·HTTP/SSE Responses 연동 방식을 사용하지만, 툴킷이 Codex를 직접 실행합니다. `lite codex`를 감싼 프로그램은 아니며 통합 목록과 구독 전환은 툴킷이 추가한 기능입니다.

## 로그인과 설치

```sh
uv tool install 'litellm[cli]==1.101.0'
lite --version
npx --yes @happycastle/opencode-litellm@latest login --base-url https://your-gateway.example
npx --yes @happycastle/opencode-litellm@latest whoami --base-url https://your-gateway.example
npx --yes @happycastle/opencode-litellm@latest install --target both --base-url https://your-gateway.example --codex-mode gateway
```

SSO는 해당 게이트웨이에 로그인할 권한이 있어야 합니다. 기존 키가 폐기되었다면 이전 키가 포함된 배치 파일을 다시 실행해도 복구되지 않습니다. 다시 로그인하거나 새 키로 대화형 설치를 진행합니다.

0.8.0의 SSO는 공식 LiteLLM CLI에 위임합니다. 로그인은 `lite --base-url <url> login --pkce`, 토큰 조회·갱신은 `lite --base-url <url> auth print-token`, 로그아웃은 `lite --base-url <url> logout`을 사용합니다. Python이 필요하며 [uv](https://docs.astral.sh/uv/guides/tools/)로 별도 도구 환경을 관리할 수 있습니다. `auth print-token`은 실제 토큰을 출력하므로 툴킷이 내부에서 결과를 받아 사용합니다. 로그인 상태 확인에는 위의 `whoami`를 사용합니다.

툴킷은 공식 CLI를 실행할 때 `LITELLM_CLI_DISABLE_KEYRING=1`을 강제하고 `~/.litellm/token.json`의 사용자 전용 파일 저장을 사용합니다. Codex 로그인과 MCP OAuth 저장소도 파일로 설정합니다. 기존 OS 키링 항목을 읽거나 이전·삭제하지 않습니다. 로그인·로그아웃은 툴킷 명령으로 진행합니다.

환경변수로 키를 공급한 설치는 실행 때도 해당 환경변수가 필요하며 `--auth env`에서 저장된 키보다 우선합니다. 대화형으로 입력한 키는 별도 파일 `~/.config/opencode-litellm/api-key.json`에 `base_url`과 `key`로 저장됩니다. `XDG_CONFIG_HOME`을 지정했다면 `$XDG_CONFIG_HOME/opencode-litellm/api-key.json`을 사용하며 POSIX 권한은 `0600`입니다. 공식 CLI의 SSO 파일과 키링은 건드리지 않습니다. 이전 버전에서 수동 입력한 키는 `install --auth env`로 다시 입력해야 하며 기존 SSO 파일에서 자동 추정·복사하지 않습니다.

Codex gateway SSO는 키링 사용을 차단하는 전용 인증 헬퍼를 통해 `lite --base-url <origin> auth print-token`을 호출합니다. 수동 API 키는 별도 파일 전용 리더를 사용합니다. 이전에 설치한 설정은 다시 설치하여 직접 `lite`를 호출하던 인증 명령을 교체합니다.

OAuth 프록시와 인증이 필요한 MCP는 툴킷 런처를 통해 실행합니다. `both` 모드의 OAuth는 `npx --yes @happycastle/codex-litellm@latest codex --profile codex-oauth`로 선택합니다. 게이트웨이 입장 키는 해당 자식 프로세스에만 전달하며 `launchctl setenv`로 로그인 세션 전체에 내보내지 않습니다. 로그아웃은 이전 버전이 남긴 launchd 변수를 정리하지만 이미 실행 중인 앱은 다시 시작해야 합니다.

## 모델 목록과 자동 라우팅

모델 선택지는 로그인한 사용자의 `GET /v1/models` 결과를 기준으로 하며 임의의 대화용 모델 별칭도 사용할 수 있습니다. 아래 학생 정책은 해당 서버가 정확히 이 네 모델을 반환할 때만 적용되는 별도 설정입니다. 일반 사용자의 필수 모델 목록이 아닙니다.

| 모델 | 용도 |
|---|---|
| `student-auto` | 기본 선택. 서버가 요청 난이도에 따라 모델 결정 |
| `gpt-5.6-luna` | 간단한 질문과 일상적인 작업 |
| `gpt-5.6-terra` | 복잡한 구현과 문제 해결 |
| `gpt-6-astra` | 깊은 추론이 필요한 작업 |

학생용 네 모델이 확인되면 LiteLLM 기본 설정의 제목·요약용 `small_model`은 `gpt-5.6-luna`를 사용합니다. 다른 공급자의 명시적 기본값과 자동 선택은 덮어쓰지 않습니다. OMO 에이전트와 작업 카테고리의 모델 배정은 아래 중앙 정책으로 별도 관리합니다.

실제 허용 목록과 자동 라우팅 정책은 서버 관리자가 관리합니다. 로컬 목록에 모델을 수동 추가해도 서버 접근 권한이 생기지 않습니다.

OpenCode 플러그인은 시작 시 모델을 조회합니다. `codex-litellm` CLI 런처는 gateway 모드 실행마다 서버의 허용 모델과 현재 설치된 Codex의 네이티브 카탈로그를 읽어 목록을 갱신한 뒤 Codex를 시작합니다. 일치하는 모델은 해당 모델의 최신 네이티브 기능 필드를 사용합니다. 권한이 사라진 모델은 제거하고 허용된 기존 선택은 유지합니다. 현재 선택이 허용되지 않고 학생용 네 모델이 반환되면 `student-auto`를 기본값으로 사용합니다.

0.8.0에서는 인증 거절, 빈 목록, 잘못된 응답, 연결 오류, HTTP 429/5xx 또는 네이티브 카탈로그 조회 실패 시 실행을 중단합니다. 이전 계정의 목록을 사용할 수 있으므로 저장된 목록으로 계속 실행하지 않습니다. OAuth 전용 모드는 내장 카탈로그를 사용합니다. 릴리스 검증 대상은 Codex CLI `0.154.0`, OpenCode SDK/plugin `1.18.31`입니다.

이 갱신은 툴킷 CLI 런처를 실행할 때 적용됩니다. Codex 데스크톱 앱 아이콘으로 열면 런처를 거치지 않으므로 서버 카탈로그를 자동 갱신하지 않습니다. 이미 실행 중인 Codex의 `/model` 목록도 자동으로 갱신되지 않으므로, 변경된 권한을 반영하려면 런처로 새로 실행하세요.

```sh
npx --yes @happycastle/opencode-litellm@latest doctor --target both --json
opencode models litellm
```

Codex 안에서는 `/model`을 확인합니다. `codex debug models --bundled`는 Codex에 내장된 참조 카탈로그를 보여주며 서버의 허용 모델 확인용이 아닙니다. `doctor`도 실제 생성 성공을 대신하지 않으므로, 모델 선택 후 짧은 질문을 보내 응답까지 확인합니다.

## OMO 에이전트·카테고리 모델 중앙 관리

OpenCode 연동은 검증된 호환 버전 `oh-my-openagent@4.19.0`을 사용합니다. Codex에 별도로 설치된 OMO 버전은 변경하지 않습니다. 학생은 설치 프로그램이 관리하는 OpenCode용 `oh-my-openagent.jsonc` / `oh-my-openagent.json` 설정을 그대로 사용하면 됩니다. 기존 `oh-my-opencode` 설정 파일이 선택된 경우에도 설치 프로그램이 해당 파일을 갱신합니다.

OpenCode `1.18.31`에서 OMO `4.19.4`를 검증했으나 서버의 에이전트 모델 배정이 적용되지 않아 버전 고정을 유지합니다. 검증 결과와 공식 소스는 [호환성 기록](official-sources.md#oh-my-openagent-consumer-contract)에 정리했습니다.

OMO의 `agents`와 `categories`에 배정할 모델은 서버 정책으로 관리합니다. 관리자는 GitOps 저장소에서 `student-auto`의 `model_info.metadata.omo`를 수정하고 배포합니다. 정책은 기존 물리 모델인 `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-6-astra`를 역할별로 지정합니다. 역할마다 새로운 모델 별칭을 만들 필요는 없습니다.

학생은 최신 툴킷으로 설치한 뒤 OpenCode를 다시 시작하면 됩니다. OpenChamber를 사용한다면 실행 중인 OpenCode 백엔드도 다시 시작해야 합니다. LiteLLM 플러그인이 서버의 허용 모델과 OMO 정책을 읽고 로컬 OMO 설정에 반영한 다음 OMO가 초기화됩니다. 설치 프로그램이 이 순서를 맞추므로 학생이 로컬 역할별 모델을 직접 편집할 필요는 없습니다. 이미 실행 중인 세션에는 재시작 전 정책이 남을 수 있습니다.

서버 정책에 포함된 LiteLLM 역할의 모델과 대체 모델 목록을 갱신하므로, 그 역할에 남아 있던 Qwen/ZAI 대체 모델도 새 정책으로 교체됩니다. 프롬프트 등 모델과 무관한 로컬 설정은 유지합니다. 다른 공급자의 모델을 명시적으로 지정한 역할은 그대로 두므로, 그런 역할까지 중앙 정책으로 전환하려면 관리자가 기존 설정을 확인해야 합니다.

서버 정책에서 대체 모델을 비워 두면 로컬 OMO 설정에는 같은 기본 모델을 대체 항목으로 기록해 OMO 내장 설정이 다른 공급자로 넘어가지 않도록 합니다. 이전 로컬 스트리밍 복구 코드의 Sol/Luna 자동 전환은 사용하지 않으며, 실제 모델 fallback은 게이트웨이 정책이 담당합니다.

서버 정책의 모델은 해당 학생에게 허용된 목록 안에 있어야 합니다. 역할 모델이 예전 값이라면 설치한 툴킷 버전, LiteLLM 플러그인 순서, OpenCode 백엔드 재시작 여부를 먼저 확인합니다. 이 OMO 설정은 OpenCode용이며 Codex의 모델 선택이나 제목·요약용 `small_model`과는 별개입니다.

기존 OMO 파일에는 자동 생성 필드의 출처 표시가 없어, 정책이 사라졌다는 이유만으로 과거 설정을 자동 삭제하지 않습니다. 권한 변경 후 남은 LiteLLM 역할 설정은 작성 주체를 확인해 정리하고 수동 지정은 보존해야 합니다.

## 문제 해결

| 증상 | 확인할 내용 |
|---|---|
| `401 Unauthorized` | 폐기/만료된 키인지 확인하고 다시 로그인 또는 키 갱신 |
| `403` / 모델 접근 거절 | 서버의 학생 팀·키 권한 확인. 모델 이름은 위의 정확한 이름 사용 |
| 모델이 안 보임 | 설치 명령 재실행 후 재시작. 다른 계정/게이트웨이 설정인지 확인 |
| 실행 파일을 찾지 못함 | 같은 터미널에서 `opencode --version`, `codex --version` 확인 |
| 공식 LiteLLM CLI를 찾지 못함 | `lite --version`과 PATH 확인. uv 설치 후 필요하면 `uv tool update-shell` 실행 및 터미널 재시작 |
| 키링 관련 창이 표시됨 | 최신 툴킷으로 다시 설치하고 앱을 재시작. 툴킷은 파일 저장만 사용하므로 이전 인증 명령이나 별도로 실행한 CLI도 확인 |
| 설치 후에도 이전 설정 사용 | 설치 대상과 실행 환경, 별칭/고정 버전 래퍼 확인 |
| 네트워크 오류 | 게이트웨이 접속과 서버 상태 확인. 반복 로그인으로 해결되지 않을 수 있음 |

업데이트할 때는 환경별 설치 명령을 다시 실행합니다. 새 설치 결과를 확인한 뒤 클라이언트를 다시 엽니다. 오류를 공유할 때 키, 토큰 파일 내용, 개인정보는 제외합니다.
