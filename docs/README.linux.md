# Linux / WSL 설치 안내

bash 또는 zsh에서 실행합니다. Node.js 지원 버전은 `^22.22.2 || ^24.12.0 || >=26.0.0`입니다. 사용할 OpenCode / Codex CLI를 같은 환경에 설치합니다. Ubuntu는 이 저장소의 CI 대상입니다.

WSL에서는 Node.js와 클라이언트도 WSL 안에 설치합니다. Windows와 WSL의 홈 디렉터리, 로그인 파일, 실행 파일은 별개입니다.

SSO에는 Python 기반 공식 LiteLLM CLI가 필요합니다. [uv](https://docs.astral.sh/uv/getting-started/installation/)를 설치한 뒤 아래 명령으로 도구 환경을 준비합니다.

```sh
uv tool install 'litellm[cli]==1.101.0'
lite --version
node --version
npm --version
opencode --version
codex --version

# 두 클라이언트 설치
npx --yes @happycastle/opencode-litellm@latest install --target both --base-url https://llm.soungmin.kr --codex-mode gateway

# 사용할 클라이언트 실행
npx --yes @happycastle/opencode-litellm@latest opencode
npx --yes @happycastle/codex-litellm@latest codex
```

OpenCode만 필요하면 `--target opencode`, Codex만 필요하면 `--target codex`를 사용합니다. 설치 화면에서 SSO와 검색/MCP 항목을 선택합니다.

SSH 등 브라우저를 자동으로 열 수 없는 환경에서는 로그인 화면에 표시된 안내를 따릅니다. 게이트웨이가 제공하는 인증 방식에 따라 로그인이 완료되지 않을 수 있으며, 그 경우 관리자가 발급한 키를 `--auth env` 대화형 설치로 입력합니다. 실제 키를 셸 명령이나 공유 파일에 기록하지 않습니다.

SSO는 공식 `lite login --pkce`의 브라우저·루프백 로그인 흐름을 사용합니다. 공식 CLI가 OS 키링과 토큰 갱신을 관리하며, 사용할 수 있는 키링이 없는 SSH/WSL 환경에서는 사용자 전용 파일 저장을 안내할 수 있습니다. `lite`를 찾지 못하면 `uv tool update-shell` 후 셸을 다시 시작합니다.

이전 버전에서 수동 입력한 키는 `install --auth env`로 다시 입력합니다. 공식 SSO 저장소에서 수동 키를 자동 추정·복사하지 않습니다. Codex SSO는 `lite auth print-token`을 네이티브 명령 인증으로 직접 호출합니다. OAuth 프록시와 인증이 필요한 MCP는 위 툴킷 런처를 통해 실행합니다. `both` 모드의 OAuth는 `npx --yes @happycastle/codex-litellm@latest codex --profile codex-oauth`로 선택하며 입장 키는 해당 프로세스에만 전달합니다.

## 설정 위치와 업데이트

- OpenCode: `$XDG_CONFIG_HOME/opencode/` 또는 `~/.config/opencode/`
- Codex: `~/.codex/config.toml`, `~/.codex/litellm-models.json`
- 공식 SSO 메타데이터: `~/.litellm/token.json`
- 수동 API 키: `$XDG_CONFIG_HOME/opencode-litellm/api-key.json` 또는 `~/.config/opencode-litellm/api-key.json`
- 런처 설정: `$XDG_CONFIG_HOME/opencode-litellm/launch.json` 또는 `~/.config/opencode-litellm/launch.json`

기존 `opencode.jsonc` / `opencode.json`과 지정한 설치 경로에 따라 파일이 결정됩니다. 업데이트는 설치 명령을 다시 실행하고 클라이언트를 다시 엽니다. GUI 앱의 설정은 그 앱이 실행되는 환경에서 설치해야 합니다.

릴리스 대상은 Codex CLI `0.154.0`과 OpenCode SDK/plugin `1.18.31`입니다. Codex gateway 런처는 현재 허용 목록과 네이티브 모델 필드를 갱신하지 못하면 실행을 중단합니다. GUI 앱 아이콘 실행은 툴킷의 모델 갱신과 환경변수 전달을 수행하지 않습니다.

[공통 로그인·모델 갱신·문제 해결](client-setup.md) · [전체 README](../README.md)
