import { formatImoWindGust, formatImoWindSpan, presentImoWindImpact } from "./imoWindImpact";
import { IMO_RANK_LABEL, type ImoWarningRank } from "./imoWarningLevel";
import { IMO_PHASE_LABEL, type ImoWarningPhase } from "./imoWarningPresentation";

const MAX_CHARS = 300;

function firstClause(source?: string) {
  const text = source?.replace(/\s+/g, " ").trim();
  if (!text || !/[\u4e00-\u9fff]/.test(text)) return "";
  const match = text.match(/^.{8,90}?[。！？]/u);
  return (match ? match[0] : text.slice(0, 72)).trim();
}

function clip(text: string) {
  const chars = [...text];
  if (chars.length <= MAX_CHARS) return text;
  return `${chars.slice(0, MAX_CHARS - 1).join("")}…`;
}

export function presentImoWarningTextReport(input: {
  rank: ImoWarningRank;
  phase: ImoWarningPhase;
  areaZh: string;
  eventZh: string;
  windowLabel: string;
  headlineZh?: string;
  instructionZh?: string;
  eventEn?: string;
  headlineEn?: string;
  descriptionEn?: string;
  descriptionIs?: string;
  descriptionZh?: string;
}): string {
  const phase = IMO_PHASE_LABEL[input.phase].replace(/^[●○✓]\s*/, "");
  const parts = [
    `${IMO_RANK_LABEL[input.rank]}｜${input.areaZh || "區域未提供"}｜${input.eventZh || "事件未提供"}。`,
    `狀態：${phase}。`,
    input.windowLabel ? `時間窗：${input.windowLabel}（冰島時間）。` : "",
  ];
  const wind = presentImoWindImpact({
    eventEn: input.eventEn,
    headlineEn: input.headlineEn,
    descriptionEn: input.descriptionEn,
    descriptionIs: input.descriptionIs,
    descriptionZh: input.descriptionZh,
  });
  if (wind) {
    const gust = wind.gust ? `，局部陣風 ${formatImoWindGust(wind.gust)}` : "";
    parts.push(`平均風速 ${formatImoWindSpan(wind.sustained)}${gust}。`);
  }
  const action = firstClause(input.instructionZh) || firstClause(input.headlineZh);
  if (action) parts.push(action.endsWith("。") || action.endsWith("！") || action.endsWith("？") ? action : `${action}。`);
  return clip(parts.filter(Boolean).join(""));
}
