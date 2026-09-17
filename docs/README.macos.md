# macOS 설치 안내

Terminal의 zsh 또는 bash에서 실행합니다. Node.js 지원 버전은 `^22.22.2 || ^24.12.0 || >=26.0.0`입니다. 사용할 OpenCode / Codex CLI도 먼저 설치하고 확인합니다.

```sh
node --version
npm --version
opencode --version
codex --version
```

SSO는 Python 기반 공식 LiteLLM CLI를 사용합니다. [uv를 설치](https://docs.astral.sh/uv/getting-started/installation/)한 뒤 다음 명령을 실행합니다.

```sh
uv tool install 'litellm[cli]==1.101.0'
lite --version
```

`lite`를 찾지 못하면 `uv tool update-shell`을 실행하고 터미널을 다시 엽니다. 공식 CLI가 macOS 키체인에 비밀 정보를 저장하고 `~/.litellm/token.json`으로 메타데이터를 관리합니다. 키체인을 사용할 수 없을 때는 공식 CLI가 안내하는 사용자 전용 파일 저장을 사용합니다.

Codex 데스크톱에서 사용할 경우에도 게이트웨이 모델 목록을 만들려면 `codex` CLI가 PATH에 있어야 합니다. `codex --version`을 확인한 뒤 설치하고, 이후 데스크톱 앱으로 실행할 수 있습니다.

## 설치와 실행

```sh
# OpenCode
npx --yes @happycastle/opencode-litellm@latest install --base-url https://llm.soungmin.kr
npx --yes @happycastle/opencode-litellm@latest opencode

# Codex: 학생용 게이트웨이 연결
npx --yes @happycastle/codex-litellm@latest install --base-url https://llm.soungmin.kr --codex-mode gateway
npx --yes @happycastle/codex-litellm@latest codex
```

두 클라이언트를 한 번에 설정하려면 다음 명령을 사용합니다. 설치 화면에서 SSO로 로그인하고 필요한 검색/MCP 항목을 선택합니다.

```sh
npx --yes @happycastle/opencode-litellm@latest install --target both --base-url https://llm.soungmin.kr --codex-mode gateway
```

Codex 데스크톱은 설치 후 완전히 종료하고 다시 엽니다. CLI 런처와 앱 아이콘으로 실행하는 경로는 다릅니다. 기본 설치 대상은 `~/.codex/config.toml`이므로 기존 개인 Codex 설정이 있다면 설치 대상과 변경 내용을 확인합니다.

OAuth 프록시와 인증이 필요한 MCP는 위 툴킷 런처를 사용합니다. `both` 모드에서는 `npx --yes @happycastle/codex-litellm@latest codex --profile codex-oauth`로 OAuth를 선택합니다. 입장 키는 자식 프로세스에만 전달되며 macOS `launchctl setenv`를 사용하지 않습니다. 앱 아이콘 실행은 이 환경변수 전달이나 모델 목록 갱신을 수행하지 않습니다. SSO용 `lite` 실행 파일은 데스크톱 앱에서도 접근할 수 있어야 합니다.

0.8.0 릴리스 대상은 Codex CLI `0.154.0`과 OpenCode SDK/plugin `1.18.31`입니다. Codex gateway 런처는 현재 허용 목록과 네이티브 모델 필드를 조회할 수 없으면 실행을 중단하며 오래된 목록으로 대체하지 않습니다.

## 설정 위치와 업데이트

- OpenCode: `~/.config/opencode/opencode.jsonc` 또는 기존 `opencode.json`
- Codex: `~/.codex/config.toml`, `~/.codex/litellm-models.json`
- 공식 SSO 메타데이터: `~/.litellm/token.json` (비밀 정보는 사용 가능한 OS 키체인에 저장)
- 수동 API 키: `~/.config/opencode-litellm/api-key.json` (`XDG_CONFIG_HOME`을 지정하면 그 아래 `opencode-litellm/api-key.json`)
- 런처 설정: `~/.config/opencode-litellm/launch.json`

`XDG_CONFIG_HOME`이나 별도 설치 경로를 사용했다면 기본 경로와 다를 수 있습니다. 업데이트는 위 설치 명령을 다시 실행합니다. 터미널 별칭이나 별도 래퍼에서 버전을 고정했다면 그 버전도 확인합니다.

이전 버전에서 수동 입력한 키는 `install --auth env`로 다시 입력합니다. 기존 SSO 파일에서 수동 키를 자동 추정·복사하지 않습니다. SSO 로그인은 공식 `lite login --pkce`를 통해 새로 진행합니다. Codex SSO는 `lite auth print-token`을 네이티브 명령 인증으로 직접 호출하며 별도 리더는 수동 키 모드에만 설치합니다. 자세한 로그인·로그아웃 절차는 공통 안내를 따릅니다.

[공통 로그인·모델 갱신·문제 해결](client-setup.md) · [전체 README](../README.md)
