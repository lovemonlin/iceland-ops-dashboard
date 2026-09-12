import { levelOf } from "@/lib/auroraVisibility";
import {
  BRIEFING_MAP_HEIGHT,
  BRIEFING_MAP_LAND_PATH,
  BRIEFING_MAP_SHAPES,
  BRIEFING_MAP_WIDTH,
} from "@/lib/briefingIcelandMap";
import type { BriefingMapRegion } from "@/lib/auroraBriefing";

const LAND_FILL = "rgba(30, 39, 64, 0.72)";
const SEA_FILL = "#141B2D";
const COAST = "#9CB1BF";

function scorePaint(score: number | undefined) {
  if (score === undefined) {
    return { fill: LAND_FILL, label: "—" };
  }
  return {
    fill: levelOf(score).color,
    label: `${Math.round(score)}`,
  };
}

export function AuroraBriefingMap({
  regions,
  hourIndex,
  hourLabel,
}: {
  regions: BriefingMapRegion[];
  hourIndex: number;
  hourLabel: string;
}) {
  const byId = new Map(regions.map((region) => [region.region, region]));

  return (
    <div className="aurora-briefing-map">
      <svg
        viewBox={`0 0 ${BRIEFING_MAP_WIDTH} ${BRIEFING_MAP_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${hourLabel} 各區平均極光分數示意圖`}
      >
        <rect width={BRIEFING_MAP_WIDTH} height={BRIEFING_MAP_HEIGHT} fill={SEA_FILL} />
        <defs>
          <clipPath id="aurora-briefing-land">
            <path d={BRIEFING_MAP_LAND_PATH} />
          </clipPath>
        </defs>
        <g clipPath="url(#aurora-briefing-land)">
          <path d={BRIEFING_MAP_LAND_PATH} fill={LAND_FILL} />
          {BRIEFING_MAP_SHAPES.map((shape) => {
            const score = byId.get(shape.region)?.scores[hourIndex];
            return (
              <path
                key={shape.region}
                d={shape.path}
                fill={scorePaint(score).fill}
                opacity={score === undefined ? 0.35 : 0.92}
              />
            );
          })}
        </g>
        <path d={BRIEFING_MAP_LAND_PATH} fill="none" stroke={COAST} strokeWidth="3" />
        {BRIEFING_MAP_SHAPES.map((shape) => {
          const score = byId.get(shape.region)?.scores[hourIndex];
          const paint = scorePaint(score);
          return (
            <text
              key={`${shape.region}-label`}
              x={shape.labelAt.x}
              y={shape.labelAt.y}
              textAnchor="middle"
              fill="#F8FAFC"
              stroke={SEA_FILL}
              strokeWidth="7"
              paintOrder="stroke"
              fontSize={shape.region === "SNAEFELLSNES" ? 22 : 24}
              fontWeight={700}
            >
              <tspan x={shape.labelAt.x} dy="0">
                {shape.label}
              </tspan>
              <tspan x={shape.labelAt.x} dy="28" fontSize="22">
                {paint.label}
              </tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}
