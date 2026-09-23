/** Official IMO warning colour only. Never inferred from wind speed or event text. */

export type ImoWarningRank = "green" | "yellow" | "orange" | "red" | "unknown";

/** Lower number is more severe. Green is not an active hazard rank. */
export const IMO_ACTIVE_RANK_ORDER: Record<Exclude<ImoWarningRank, "green">, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
  unknown: 3,
};

export const IMO_RANK_ORDER: Record<ImoWarningRank, number> = {
  ...IMO_ACTIVE_RANK_ORDER,
  green: 4,
};

export const IMO_RANK_CODE: Record<ImoWarningRank, string> = {
  red: "RED",
  orange: "ORANGE",
  yellow: "YELLOW",
  green: "GREEN",
  unknown: "UNKNOWN",
};

export const IMO_RANK_LABEL: Record<ImoWarningRank, string> = {
  red: "紅色警報",
  orange: "橙色警報",
  yellow: "黃色警報",
  green: "已解除",
  unknown: "等級未知",
};

const RANK_MARK: Record<ImoWarningRank, string> = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
  green: "🟢",
  unknown: "⚠️",
};

export function imoWarningRank(color: string | undefined): ImoWarningRank {
  const key = color?.trim().toLowerCase();
  if (key === "red") return "red";
  if (key === "orange" || key === "amber") return "orange";
  if (key === "yellow") return "yellow";
  if (key === "green") return "green";
  return "unknown";
}

export function isImoActiveHazardRank(rank: ImoWarningRank): boolean {
  return rank === "red" || rank === "orange" || rank === "yellow" || rank === "unknown";
}

export function imoLevelLabel(rank: ImoWarningRank): string {
  return `${RANK_MARK[rank]} ${IMO_RANK_LABEL[rank]}`;
}

export function higherImoRank(left: ImoWarningRank, right: ImoWarningRank): ImoWarningRank {
  if (left === "green") return right;
  if (right === "green") return left;
  return IMO_ACTIVE_RANK_ORDER[left] < IMO_ACTIVE_RANK_ORDER[right] ? left : right;
}
