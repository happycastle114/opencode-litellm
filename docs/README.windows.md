# Windows 설치 안내

PowerShell 또는 CMD에서 사용할 수 있습니다. Node.js 지원 버전은 `^22.22.2 || ^24.12.0 || >=26.0.0`입니다. 사용할 OpenCode / Codex CLI를 같은 Windows 환경에 먼저 설치합니다. WSL을 사용한다면 [Linux / WSL 안내](README.linux.md)를 따릅니다.

## PowerShell

실행 정책 때문에 `npx.ps1`이 차단되는 경우를 피하도록 `npm.cmd`와 `npx.cmd`를 사용합니다.

```powershell
node --version
npm.cmd --version
opencode --version
codex --version

# OpenCode
npx.cmd --yes @happycastle/opencode-litellm@latest install --base-url https://llm.soungmin.kr
npx.cmd --yes @happycastle/opencode-litellm@latest opencode

# Codex: 학생용 게이트웨이 연결
npx.cmd --yes @happycastle/codex-litellm@latest install --base-url https://llm.soungmin.kr --codex-mode gateway
npx.cmd --yes @happycastle/codex-litellm@latest codex
```

둘 다 설치하려면:

```powershell
npx.cmd --yes @happycastle/opencode-litellm@latest install --target both --base-url https://llm.soungmin.kr --codex-mode gateway
```

설치 화면에서 SSO로 로그인합니다. 키를 전달받았다면 `--auth env`를 추가하고 대화형 입력을 사용합니다. 키를 README, 배치 파일, 공유 명령에 붙여 넣지 않습니다.

## CMD / 배치 파일

위 명령의 `npx.cmd`는 CMD에서도 사용할 수 있습니다. 저장소를 내려받았다면 기존 진입점도 사용할 수 있습니다.

```bat
scripts\setup-windows.bat
```

배치 파일은 두 클라이언트의 대화형 설치를 시작합니다. 인자는 전달하지 않으므로 게이트웨이 URL은 설치 화면에서 입력합니다.

## 설정 위치와 업데이트

일반적인 사용자 프로필 기준 경로입니다. 별도 HOME / XDG 설정이나 설치 경로를 사용했다면 달라질 수 있습니다.

- OpenCode: `%USERPROFILE%\.config\opencode\opencode.jsonc` 또는 기존 `opencode.json`
- Codex: `%USERPROFILE%\.codex\config.toml`, `litellm-models.json`
- 로그인 토큰: `%USERPROFILE%\.litellm\token.json`
- 런처 설정: `%USERPROFILE%\.config\opencode-litellm\launch.json`

업데이트는 설치 명령을 다시 실행한 뒤 클라이언트를 다시 엽니다. `401`은 로그인/키 갱신, `403`은 모델 권한 확인이 필요합니다. `codex debug models --bundled`는 게이트웨이 권한 목록이 아니므로 Codex 안의 `/model`에서 확인합니다.

[공통 로그인·모델 갱신·문제 해결](client-setup.md) · [전체 README](../README.md)

공식 안내: [Codex CLI](https://developers.openai.com/codex/cli), [Codex Windows](https://developers.openai.com/codex/windows), [LiteLLM CLI](https://docs.litellm.ai/docs/proxy/cli).
