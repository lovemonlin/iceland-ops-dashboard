import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { levelOf } from "../src/lib/auroraVisibility";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const forecast = read("src/components/AuroraForecast.tsx");
const dialog = read("src/components/AuroraScoreExplanationDialog.tsx");

test("the forecast opens its score explanation from one nearby button", () => {
  assert.match(forecast, /ⓘ 分數怎麼算？/);
  assert.match(forecast, /setScoreExplanationOpen\(true\)/);
  assert.match(forecast, /scoreExplanationOpen &&/);
  assert.match(forecast, /<AuroraScoreExplanationDialog onClose=\{\(\) => setScoreExplanationOpen\(false\)\}/);
  assert.match(
    forecast,
    /未來 48 小時逐時預測（時間軸為冰島時間）；可橫向捲動並點選任一小時查看細節。/,
  );
});

test("the native modal is labelled and closes by button, Escape, or backdrop", () => {
  assert.match(dialog, /<dialog/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /aria-labelledby="aurora-score-dialog-title"/);
  assert.match(dialog, /aria-describedby="aurora-score-dialog-description"/);
  assert.match(dialog, /onCancel=\{\(event\) =>/);
  assert.match(dialog, /event\.target === event\.currentTarget/);
  assert.match(dialog, /aria-label="關閉分數說明"/);
  assert.match(dialog, />關閉<\/button>/);
  assert.match(dialog, /closeRef\.current\?\.focus\(\)/);

  const css = read("src/app/globals.css");
  assert.match(css, /\.aurora-score-dialog::backdrop/);
  assert.match(css, /\.aurora-score-dialog-body[\s\S]*overflow-y: auto/);
  assert.match(css, /max-height: 92dvh/);
});

test("the dialog states the five-factor score and that it is not a probability", () => {
  assert.match(dialog, /極光分數 ＝ 極光強度 × 雲層因子 × 黑暗因子 × 月光因子 × 地點因子/);
  assert.match(dialog, /最後結果限制在 0～100，再四捨五入成整數/);
  assert.match(dialog, /不是看到極光的機率百分比/);
  assert.match(dialog, /不應解讀為「13 分 = 13% 機率」/);
});

test("the current-hour Bz bonuses and future Kp conversion are all explained", () => {
  for (const rule of ["Bz &lt; 0 nT", "Bz ≤ -5 nT", "Bz ≤ -10 nT", "Bz ≤ -15 nT", "+3", "+8", "+15", "+25"]) {
    assert.equal(dialog.includes(rule), true, `${rule} missing`);
  }
  assert.match(dialog, /極光強度 = Kp ÷ 9 × 100/);
  for (const example of ["Kp 1 ≈ 11", "Kp 3 ≈ 33", "Kp 5 ≈ 56", "Kp 7 ≈ 78", "Kp 9 = 100"]) {
    assert.equal(dialog.includes(example), true, `${example} missing`);
  }
});

test("cloud, darkness, moon, and location formulas match their current descriptions", () => {
  assert.match(dialog, /低雲比例 × 1\.00/);
  assert.match(dialog, /中雲比例 × 0\.70/);
  assert.match(dialog, /高雲比例 × 0\.35/);
  assert.match(dialog, /雲層因子 = 1 - 有效遮蔽率/);
  for (const threshold of ["≥ -6°", "-6° ～ -12°", "-12° ～ -18°", "≤ -18°"]) {
    assert.equal(dialog.includes(threshold), true, `${threshold} missing`);
  }
  assert.match(dialog, /月光因子 = 1 - 月光干擾 × 0\.5/);
  assert.match(dialog, /地點因子 ＝ 地磁位置優勢 × 光害係數/);
  assert.match(dialog, /極光帶邊界緯度 = 66 - 2 × Kp/);
  for (const rule of ["DARK（低光害）", "1.00", "MODERATE（中等光害）", "0.85", "BRIGHT（高光害）", "0.60"]) {
    assert.equal(dialog.includes(rule), true, `${rule} missing`);
  }
});

test("all five displayed score bands take their names and colours from levelOf", () => {
  for (const range of ["0～4", "5～19", "20～39", "40～64", "65～100"]) {
    assert.equal(dialog.includes(range), true, `${range} missing`);
  }
  assert.match(dialog, /\.\.\.levelOf\(0\)/);
  assert.match(dialog, /\.\.\.levelOf\(65\)/);
  assert.deepEqual([0, 5, 20, 40, 65].map((score) => levelOf(score).color), [
    "#64748B",
    "#FB923C",
    "#FDE047",
    "#86EFAC",
    "#4ADE80",
  ]);
});

test("the explanation is static UI and introduces no network request", () => {
  assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//i.test(dialog), false);
  assert.equal(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\//i.test(forecast), false);
});
