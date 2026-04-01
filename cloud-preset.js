/**
 * GitHub 동기화 설정 (택1)
 *
 * A) 평문 — 아래 객체만 수정
 * B) 암호문 — encrypt-preset.html 로 암호문 생성 후, 아래 평문 블록은 지우고
 *    window.__TESLA_CLOUD_PRESET_ENC__ = "....JSON한줄....";
 *    만 남깁니다. 앱에서 ⚙ 로 복호화 비밀번호 입력.
 *
 * token: 비우면 GitHub PAT는 ⚙ 또는 암호문 JSON 안에만 둡니다.
 */

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

// 예: 암호화 사용 시 평문 위 블록 삭제 후 아래만 사용
// window.__TESLA_CLOUD_PRESET_ENC__ = '{"v":1,"salt":"...","iv":"...","ciphertext":"..."}';
