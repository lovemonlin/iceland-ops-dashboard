"use client";

import { useEffect, useRef } from "react";
import { levelOf } from "@/lib/auroraVisibility";

const LEVELS = [
  { range: "0～4", ...levelOf(0) },
  { range: "5～19", ...levelOf(5) },
  { range: "20～39", ...levelOf(20) },
  { range: "40～64", ...levelOf(40) },
  { range: "65～100", ...levelOf(65) },
];

export function AuroraScoreExplanationDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="aurora-score-dialog"
      aria-labelledby="aurora-score-dialog-title"
      aria-describedby="aurora-score-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="aurora-score-dialog-head">
        <div>
          <h2 id="aurora-score-dialog-title">極光預測分數怎麼算？</h2>
          <p id="aurora-score-dialog-description">
            這個 0～100 分是極光可見條件的綜合評分，不是看到極光的機率百分比。
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={close} aria-label="關閉分數說明">×</button>
      </div>

      <div className="aurora-score-dialog-body">
        <section>
          <h3>核心公式</h3>
          <p className="aurora-score-formula">
            極光分數 ＝ 極光強度 × 雲層因子 × 黑暗因子 × 月光因子 × 地點因子
          </p>
          <p>最後結果限制在 0～100，再四捨五入成整數。</p>
        </section>

        <section>
          <h3>1. 極光強度</h3>
          <p>目前時刻（第 0 小時）使用 OVATION 極光機率，並依 Bz 南向磁場給予加成。</p>
          <table>
            <thead><tr><th>Bz 條件</th><th>加成</th></tr></thead>
            <tbody>
              <tr><td>Bz &lt; 0 nT</td><td>+3</td></tr>
              <tr><td>Bz ≤ -5 nT</td><td>+8</td></tr>
              <tr><td>Bz ≤ -10 nT</td><td>+15</td></tr>
              <tr><td>Bz ≤ -15 nT</td><td>+25</td></tr>
            </tbody>
          </table>
          <p className="muted-line">符合多個門檻時套用最大的加成；極光強度最高限制為 100。</p>
          <p>
            未來第 1～47 小時沒有未來 OVATION 與未來 Bz，因此改用 NOAA Kp Forecast：
            <strong> 極光強度 = Kp ÷ 9 × 100</strong>。
          </p>
          <div className="aurora-score-examples" aria-label="Kp 換算範例">
            <span>Kp 1 ≈ 11</span><span>Kp 3 ≈ 33</span><span>Kp 5 ≈ 56</span>
            <span>Kp 7 ≈ 78</span><span>Kp 9 = 100</span>
          </div>
        </section>

        <section>
          <h3>2. 雲層因子</h3>
          <p>低雲權重 100%、中雲權重 70%、高雲權重 35%。</p>
          <p className="aurora-score-formula">
            透光率 ＝ (1 - 低雲比例 × 1.00) × (1 - 中雲比例 × 0.70) × (1 - 高雲比例 × 0.35)
          </p>
          <p><strong>雲層因子 = 1 - 有效遮蔽率</strong>（也就是上述透光率）。</p>
          <p>低雲對觀測影響最大，高雲影響較小；三層雲量不是直接相加，而是以透光率組合。</p>
        </section>

        <section>
          <h3>3. 黑暗因子</h3>
          <table>
            <thead><tr><th>太陽高度</th><th>黑暗因子</th></tr></thead>
            <tbody>
              <tr><td>≥ -6°</td><td>0</td></tr>
              <tr><td>-6° ～ -12°</td><td>0 ～ 0.6</td></tr>
              <tr><td>-12° ～ -18°</td><td>0.6 ～ 1.0</td></tr>
              <tr><td>≤ -18°</td><td>1.0</td></tr>
            </tbody>
          </table>
          <p>太陽低於地平線不代表立刻完全適合觀測；直到太陽高度低於 -18°，才視為完整黑夜條件。</p>
        </section>

        <section>
          <h3>4. 月光因子</h3>
          <p>系統依月相亮度、月亮是否在地平線以上，以及月亮高度計算月光干擾。</p>
          <p className="aurora-score-formula">月光因子 = 1 - 月光干擾 × 0.5</p>
          <p>月光會降低極光辨識度，但不會單獨把分數降到 0。</p>
        </section>

        <section>
          <h3>5. 地點因子</h3>
          <p className="aurora-score-formula">地點因子 ＝ 地磁位置優勢 × 光害係數</p>
          <table>
            <thead><tr><th>光害分類</th><th>係數</th></tr></thead>
            <tbody>
              <tr><td>DARK（低光害）</td><td>1.00</td></tr>
              <tr><td>MODERATE（中等光害）</td><td>0.85</td></tr>
              <tr><td>BRIGHT（高光害）</td><td>0.60</td></tr>
            </tbody>
          </table>
          <p>系統依觀測地點的修正地磁緯度，以及當時 Kp 判斷該位置是否接近極光帶。</p>
          <p className="aurora-score-formula">極光帶邊界緯度 = 66 - 2 × Kp</p>
          <p>Kp 越高，極光帶通常能往較低緯度擴展，因此同一個地點在不同 Kp 下，地點因子也會不同。</p>
        </section>

        <section>
          <h3>分數等級</h3>
          <div className="aurora-score-levels">
            {LEVELS.map((level) => (
              <div key={level.range}>
                <i style={{ backgroundColor: level.color }} aria-hidden="true" />
                <span>{level.range}</span>
                <strong style={{ color: level.color }}>{level.levelLabel}</strong>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3>計算示例</h3>
          <p>假設極光強度 25、雲層因子 0.70、黑暗因子 0.92、月光因子 0.90、地點因子 0.90：</p>
          <p className="aurora-score-formula">25 × 0.70 × 0.92 × 0.90 × 0.90 ≈ 13</p>
          <p><strong>所以：13 分 → 不佳</strong></p>
          <p className="muted-line">以上數值僅為計算示例，不代表目前選取地點或時段的實際數據。</p>
        </section>

        <aside className="aurora-score-warning">
          <p>高 Kp 不代表一定看得到極光。即使太陽活動很強，如果天空太亮、雲層太厚、月光干擾高或觀測位置不佳，最終分數仍可能偏低。</p>
          <p>此分數用於比較觀測條件，不應解讀為「13 分 = 13% 機率」。</p>
        </aside>
      </div>

      <div className="aurora-score-dialog-actions">
        <button type="button" onClick={close}>關閉</button>
      </div>
    </dialog>
  );
}
