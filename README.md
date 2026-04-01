## Tesla Model Y 차계부 (GitHub 파일을 DB처럼)

이 앱은 정적(HTML/CSS/JS)으로 배포하고, 데이터는 GitHub 저장소의 `data.json`에 커밋하여 동기화합니다.

### 1) GitHub에 올리기

Windows PowerShell:

```powershell
cd "C:\Users\경남교육청\Desktop\테슬라이프"
git init
git add .
git commit -m "Initial commit"
```

GitHub에서 새 저장소를 만든 뒤(Private 권장), 안내대로 push:

```powershell
git branch -M main
git remote add origin https://github.com/<YOUR_ID>/<REPO>.git
git push -u origin main
```

### 2) GitHub Pages로 배포(선택)

GitHub 저장소 → Settings → Pages → Branch `main` / folder `/ (root)` → Save  
생성된 Pages 주소로 어디서든 접속 가능합니다.

### 3) Vercel로 배포(선택)

Vercel에서 GitHub 저장소를 Import해서 바로 Deploy 하면 됩니다.

### 4) GitHub 토큰(PAT) 만들기 (필수: 저장/커밋)

이 방식은 브라우저에서 GitHub API로 `data.json`을 업데이트(커밋)해야 하므로 토큰이 필요합니다.

권장: Fine-grained token

- Repository access: 이 저장소만 선택
- Permissions: **Contents = Read and write**

### 5) 저장소에 `cloud-preset.js` 넣기 (한 번만 설정)

프로젝트 루트의 **`cloud-preset.js`**를 열어 아래를 본인 저장소에 맞게 수정한 뒤 커밋합니다.

- `owner`, `repo`: GitHub 사용자명과 저장소 이름
- `branch`, `path`: 보통 `main`, `data.json`
- `token`: (선택) 여기에 PAT를 넣으면 **어느 기기에서도** 추가 입력 없이 불러오기/저장 가능.  
  비워 두면 **⚙** 메뉴에서 한 번 입력하면 그 브라우저의 localStorage에만 저장됩니다.

#### 암호화해서 넣고 싶을 때 (선택)

1. 로컬에서 **`encrypt-preset.html`**을 브라우저로 연다.
2. JSON·비밀번호 입력 후 **암호문 생성** → 출력을 복사한다.
3. `cloud-preset.js`에서 평문 `__TESLA_CLOUD_PRESET__` 블록은 **삭제**하고, 생성된 `__TESLA_CLOUD_PRESET_ENC__` 한 줄만 넣는다.
4. 앱 **⚙**에서 같은 비밀번호로 **프리셋 비밀번호 적용** (또는 「이 브라우저에 비밀번호 저장」).

> 브라우저에만 복호화 코드가 있어도, **비밀번호는 저장소에 올리지 않으면** 저장소에는 암호문만 남습니다. (완전한 보안은 아님: 복호화 로직은 공개됨.)

상단 버튼:

- **클라우드에서 불러오기**: GitHub의 `data.json` → 앱
- **클라우드 저장**: 앱 데이터 → `data.json` 커밋
- **⚙**: 토큰 입력(선택) · 자동 저장(변경 후 2초마다 커밋)

### 주의

- 저장소가 **Public**이면 `cloud-preset.js`에 넣은 **토큰이 그대로 노출**됩니다. 토큰을 파일에 넣을 때는 **Private 저장소**를 권장합니다.
- `data.json`도 Public 저장소면 누구나 읽을 수 있습니다.

