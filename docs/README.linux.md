# Linux / WSL 설치 안내

bash 또는 zsh에서 실행합니다. Node.js 지원 버전은 `^22.22.2 || ^24.12.0 || >=26.0.0`입니다. 사용할 OpenCode / Codex CLI를 같은 환경에 설치합니다. Ubuntu는 이 저장소의 CI 대상입니다.

WSL에서는 Node.js와 클라이언트도 WSL 안에 설치합니다. Windows와 WSL의 홈 디렉터리, 로그인 파일, 실행 파일은 별개입니다.

```sh
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

## 설정 위치와 업데이트

- OpenCode: `$XDG_CONFIG_HOME/opencode/` 또는 `~/.config/opencode/`
- Codex: `~/.codex/config.toml`, `~/.codex/litellm-models.json`
- 로그인 토큰: `~/.litellm/token.json`
- 런처 설정: `$XDG_CONFIG_HOME/opencode-litellm/launch.json` 또는 `~/.config/opencode-litellm/launch.json`

기존 `opencode.jsonc` / `opencode.json`과 지정한 설치 경로에 따라 파일이 결정됩니다. 업데이트는 설치 명령을 다시 실행하고 클라이언트를 다시 엽니다. GUI 앱의 설정은 그 앱이 실행되는 환경에서 설치해야 합니다.

[공통 로그인·모델 갱신·문제 해결](client-setup.md) · [전체 README](../README.md)
