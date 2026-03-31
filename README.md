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

### 5) 앱에서 동기화 설정

상단 **클라우드** 버튼 → 아래 입력:

- Owner: GitHub 아이디(또는 org)
- Repo: 저장소 이름
- Branch: 보통 `main`
- Path: `data.json`
- Token: 만든 PAT

버튼:
- **불러오기**: GitHub의 `data.json`을 읽어 앱에 적용
- **저장(커밋)**: 현재 데이터를 `data.json`으로 커밋 업데이트
- **자동 저장**: 변경 후 2초 뒤 자동 커밋(요청/커밋이 잦아질 수 있어 주의)

### 주의(매우 중요)

- 토큰은 코드에 하드코딩하지 않습니다.
- 토큰은 현재 브라우저의 localStorage에 저장됩니다. 공용 PC에서는 사용하지 마세요.
- 저장소가 Public이면 `data.json`도 공개됩니다. 개인 데이터면 Private을 권장합니다.

