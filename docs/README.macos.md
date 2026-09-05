# macOS 설치 안내

Terminal의 zsh 또는 bash에서 실행합니다. Node.js 지원 버전은 `^22.22.2 || ^24.12.0 || >=26.0.0`입니다. 사용할 OpenCode / Codex CLI도 먼저 설치하고 확인합니다.

```sh
node --version
npm --version
opencode --version
codex --version
```

Codex 데스크톱만 설정한다면 `codex --version`과 CLI 실행 단계는 생략할 수 있습니다.

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

## 설정 위치와 업데이트

- OpenCode: `~/.config/opencode/opencode.jsonc` 또는 기존 `opencode.json`
- Codex: `~/.codex/config.toml`, `~/.codex/litellm-models.json`
- 로그인 토큰: `~/.litellm/token.json`
- 런처 설정: `~/.config/opencode-litellm/launch.json`

`XDG_CONFIG_HOME`이나 별도 설치 경로를 사용했다면 기본 경로와 다를 수 있습니다. 업데이트는 위 설치 명령을 다시 실행합니다. 터미널 별칭이나 별도 래퍼에서 버전을 고정했다면 그 버전도 확인합니다.


[공통 로그인·모델 갱신·문제 해결](client-setup.md) · [전체 README](../README.md)
