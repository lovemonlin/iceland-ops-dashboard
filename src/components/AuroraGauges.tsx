"use client";

import { useEffect, useRef, useState } from "react";
import {
  GAUGE_COLORS,
  GAUGE_START_ANGLE,
  GAUGE_STYLE,
  GAUGE_SWEEP_ANGLE,
  gaugeAngle,
  readGauges,
  zoneColorFor,
  type GaugeReading,
} from "@/lib/auroraGauge";

/**
 * The app's space-weather instrument panel.
 *
 * Ported from `ui/home/GaugeDial.kt` in its `auroraRealtimeStyle` form, which is the one all of
 * the app's dials use: a 270° arc open at the bottom, a 24-module LED data ring coloured by the
 * value's zone, 31 ticks, a radar recess with concentric grid and crosshair, a tapered needle on
 * a machined hub, and a glass readout panel at the bottom of the face.
 *
 * Geometry is expressed as fractions of the dial's diameter exactly as the app expresses it, so
 * the proportions hold at any size.
 */

/** The app's default dial is 108dp; dp and CSS px agree at scale 1. */
const DIAMETER = 108;
/** GaugeDial.kt:243-245. */
const STROKE = DIAMETER * GAUGE_STYLE.ringWidth;
const RADIUS = DIAMETER * 0.38;
const CENTRE = DIAMETER / 2;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const pointOn = (radius: number, degrees: number) => ({
  x: CENTRE + radius * Math.cos(radians(degrees)),
  y: CENTRE + radius * Math.sin(radians(degrees)),
});

/** An SVG arc stroked the way Compose's drawArc strokes one. */
function arcPath(radius: number, startAngle: number, sweep: number) {
  const from = pointOn(radius, startAngle);
  const to = pointOn(radius, startAngle + sweep);
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  return `M${from.x} ${from.y} A${radius} ${radius} 0 ${largeArc} ${sweep >= 0 ? 1 : 0} ${to.x} ${to.y}`;
}

/**
 * Eases a value towards its target the way the app does — `tween(FastOutSlowInEasing)` over
 * 850 ms on first appearance, 600 ms afterwards (AuroraGaugeStyle.animationDuration).
 */
function useAnimatedValue(target: number | undefined, start: number, delayMs: number) {
  const [displayed, setDisplayed] = useState(start);
  const played = useRef(false);
  const frame = useRef(0);
  const timer = useRef(0);

  useEffect(() => {
    const stop = () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
    };

    if (target === undefined) {
      // Parked at the minimum, on a timer rather than during the effect so this never becomes a
      // render-phase update.
      played.current = false;
      timer.current = window.setTimeout(() => setDisplayed(start), 0);
      return stop;
    }

    // The app checks ValueAnimator.areAnimatorsEnabled() and snaps when animations are off; the
    // web equivalent is the reduced-motion preference.
    const reducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      played.current = true;
      timer.current = window.setTimeout(() => setDisplayed(target), 0);
      return stop;
    }

    const from = played.current ? displayed : start;
    const first = !played.current;
    const duration = first ? 850 : 600;
    const begin = performance.now() + (first ? delayMs : 0);
    played.current = true;

    const step = (now: number) => {
      if (now < begin) {
        frame.current = requestAnimationFrame(step);
        return;
      }
      const t = Math.min(1, (now - begin) / duration);
      // FastOutSlowInEasing is a cubic-bezier(0.4, 0, 0.2, 1); this is its close scalar analogue.
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      setDisplayed(from + (target - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    // A browser that is not painting delivers no animation frames, and a dial left mid-sweep
    // would be showing the bottom of its range as if it were the reading. The timer guarantees
    // the true value arrives whether or not the sweep to it was ever drawn.
    timer.current = window.setTimeout(() => setDisplayed(target), delayMs + duration + 80);
    return stop;
    // Re-runs only when the reading itself changes; `displayed` is read as the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, start, delayMs]);

  return displayed;
}

function Dial({ reading, delayMs }: { reading: GaugeReading; delayMs: number }) {
  const { spec, value } = reading;
  const clamped =
    value === undefined ? spec.range.start : Math.min(spec.range.end, Math.max(spec.range.start, value));
  const animated = useAnimatedValue(value === undefined ? undefined : clamped, spec.range.start, delayMs);
  const hasValue = value !== undefined;

  const span = spec.range.end - spec.range.start || 1;
  const fraction = Math.min(1, Math.max(0, (animated - spec.range.start) / span));
  const activeSegment = Math.min(
    GAUGE_STYLE.segmentCount - 1,
    Math.max(0, Math.floor(fraction * GAUGE_STYLE.segmentCount)),
  );
  const segmentStep = GAUGE_SWEEP_ANGLE / GAUGE_STYLE.segmentCount;

  const needleAngle = gaugeAngle(animated, spec.range);
  const needleTip = pointOn(RADIUS * 0.86, needleAngle);
  const needleTail = pointOn(-RADIUS * 0.08, needleAngle);
  // A tapered blade: 2.7px at the root, 0.7px at the tip (AuroraGaugeStyle.needleWidth).
  const perpendicular = { x: -Math.sin(radians(needleAngle)), y: Math.cos(radians(needleAngle)) };
  const root = 2.7 / 2;
  const tip = 0.7 / 2;
  const needlePath = [
    `M${needleTail.x + perpendicular.x * root} ${needleTail.y + perpendicular.y * root}`,
    `L${needleTip.x + perpendicular.x * tip} ${needleTip.y + perpendicular.y * tip}`,
    `L${needleTip.x - perpendicular.x * tip} ${needleTip.y - perpendicular.y * tip}`,
    `L${needleTail.x - perpendicular.x * root} ${needleTail.y - perpendicular.y * root}`,
    "Z",
  ].join(" ");

  const statusText = spec.status?.(value);
  const statusColor = zoneColorFor(spec.zones, clamped);
  const gradientId = `gauge-${spec.key}`;

  return (
    <div className="gauge">
      <div className="gauge-face" style={{ width: DIAMETER, height: DIAMETER }}>
        <svg width={DIAMETER} height={DIAMETER} role="img" aria-label={`${spec.label} ${spec.format(value)}`}>
          <defs>
            <radialGradient id={`${gradientId}-radar`}>
              <stop offset="0%" stopColor={GAUGE_COLORS.radarCenter} />
              <stop offset="100%" stopColor={GAUGE_COLORS.radarEdge} />
            </radialGradient>
            <linearGradient id={`${gradientId}-metal`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GAUGE_COLORS.outerMetalHighlight} />
              <stop offset="50%" stopColor={GAUGE_COLORS.outerMetalDark} />
              <stop offset="100%" stopColor={GAUGE_COLORS.innerMetalShadow} />
            </linearGradient>
            <linearGradient
              id={`${gradientId}-needle`}
              x1={needleTail.x}
              y1={needleTail.y}
              x2={needleTip.x}
              y2={needleTip.y}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={GAUGE_COLORS.needleBase} />
              <stop offset="100%" stopColor={GAUGE_COLORS.needleHighlight} />
            </linearGradient>
          </defs>

          {/* The recessed radar face the dial is sunk into. */}
          <circle cx={CENTRE} cy={CENTRE} r={RADIUS * 0.84} fill={`url(#${gradientId}-radar)`} />

          {/* Three metal rings: dark shell, a highlight pass, then the inner shadow. */}
          <path
            d={arcPath(RADIUS, GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE)}
            fill="none"
            stroke={GAUGE_COLORS.outerMetalDark}
            strokeWidth={STROKE * GAUGE_STYLE.outerRingWidth}
          />
          <path
            d={arcPath(RADIUS, GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE)}
            fill="none"
            stroke={`url(#${gradientId}-metal)`}
            strokeWidth={STROKE * GAUGE_STYLE.metalRingWidth}
          />
          <path
            d={arcPath(RADIUS - STROKE * 0.5, GAUGE_START_ANGLE, GAUGE_SWEEP_ANGLE)}
            fill="none"
            stroke={GAUGE_COLORS.innerMetalShadow}
            strokeOpacity={0.7}
            strokeWidth={STROKE * GAUGE_STYLE.radarRecessWidth}
          />

          {/* The data ring as 24 separate LED modules: a dim wide body and a bright core. */}
          {Array.from({ length: GAUGE_STYLE.segmentCount }, (_, index) => {
            const middle = (index + 0.5) / GAUGE_STYLE.segmentCount;
            const color = zoneColorFor(spec.zones, spec.range.start + span * middle);
            const start = GAUGE_START_ANGLE + segmentStep * index + GAUGE_STYLE.segmentGap / 2;
            const sweep = segmentStep - GAUGE_STYLE.segmentGap;
            const active = hasValue && index === activeSegment;
            return (
              <g key={index}>
                <path
                  d={arcPath(RADIUS, start, sweep)}
                  fill="none"
                  stroke={color}
                  strokeOpacity={active ? 0.78 : 0.62}
                  strokeWidth={STROKE * GAUGE_STYLE.segmentWidth}
                />
                <path
                  d={arcPath(RADIUS, start, sweep)}
                  fill="none"
                  stroke={color}
                  strokeOpacity={active ? 1 : 0.9}
                  strokeWidth={STROKE * (active ? GAUGE_STYLE.activeSegmentWidth : GAUGE_STYLE.segmentCoreWidth)}
                />
              </g>
            );
          })}

          {/* Bz alone marks where it crosses zero, which is the line that decides favourability. */}
          {spec.emphasizedBoundary !== undefined && (
            <line
              {...(() => {
                const angle = gaugeAngle(spec.emphasizedBoundary, spec.range);
                const inner = pointOn(RADIUS - STROKE * 0.46, angle);
                const outer = pointOn(RADIUS + STROKE * 0.44, angle);
                return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
              })()}
              stroke={GAUGE_COLORS.boundaryMarker}
              strokeWidth={STROKE * GAUGE_STYLE.boundaryMarkerWidth}
              strokeLinecap="round"
            />
          )}

          {/* 31 ticks, every fifth longer and brighter — polar navigation instrument, not a bar. */}
          {Array.from({ length: 31 }, (_, index) => {
            const angle = GAUGE_START_ANGLE + (GAUGE_SWEEP_ANGLE * index) / 30;
            const major = index % 5 === 0;
            const outerRadius = RADIUS + STROKE * GAUGE_STYLE.tickOuterOffset;
            const innerRadius =
              outerRadius - STROKE * (major ? GAUGE_STYLE.majorTickLength : GAUGE_STYLE.minorTickLength);
            const from = pointOn(innerRadius, angle);
            const to = pointOn(outerRadius, angle);
            return (
              <line
                key={index}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={major ? GAUGE_COLORS.majorTick : GAUGE_COLORS.minorTick}
                strokeWidth={STROKE * (major ? 0.15 : 0.09)}
                strokeLinecap="round"
              />
            );
          })}

          {/* Concentric radar grid and centre crosshair, both barely there. */}
          {[0.22, 0.42, 0.62].map((scale) => (
            <circle
              key={scale}
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS * scale}
              fill="none"
              stroke={GAUGE_COLORS.innerRing}
              strokeOpacity={GAUGE_STYLE.radarGridAlpha / 0.3}
              strokeWidth={STROKE * GAUGE_STYLE.innerRingWidth}
            />
          ))}
          {(() => {
            const reach = RADIUS * 0.58;
            const gap = STROKE * 0.72;
            const lines: [number, number, number, number][] = [
              [CENTRE - reach, CENTRE, CENTRE - gap, CENTRE],
              [CENTRE + gap, CENTRE, CENTRE + reach, CENTRE],
              [CENTRE, CENTRE - reach, CENTRE, CENTRE - gap],
              [CENTRE, CENTRE + gap, CENTRE, CENTRE + reach],
            ];
            return lines.map(([x1, y1, x2, y2], index) => (
              <line
                key={index}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={GAUGE_COLORS.crosshair}
                strokeOpacity={GAUGE_STYLE.crosshairAlpha / 0.32}
                strokeWidth={STROKE * 0.075}
              />
            ));
          })()}

          {/* With no reading the needle rests at the minimum, greyed, so it never reads as data. */}
          {hasValue && (
            <line
              x1={needleTail.x}
              y1={needleTail.y}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke={GAUGE_COLORS.needleGlow}
              strokeWidth={4}
              strokeLinecap="round"
            />
          )}
          {hasValue ? (
            <path d={needlePath} fill={`url(#${gradientId}-needle)`} />
          ) : (
            <line
              x1={needleTail.x}
              y1={needleTail.y}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke={GAUGE_COLORS.needleMuted}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          )}
          <circle
            cx={needleTip.x}
            cy={needleTip.y}
            r={1.45}
            fill={hasValue ? GAUGE_COLORS.needleHighlight : GAUGE_COLORS.needleMuted}
          />

          {/* The machined hub the needle turns on. */}
          <circle cx={CENTRE} cy={CENTRE} r={9} fill={GAUGE_COLORS.hubSensor} fillOpacity={0.1} />
          <circle cx={CENTRE} cy={CENTRE} r={6} fill={GAUGE_COLORS.hubOuterMetal} />
          <circle cx={CENTRE} cy={CENTRE} r={4} fill={GAUGE_COLORS.hubInnerMetal} />
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={3.4}
            fill="none"
            stroke={GAUGE_COLORS.innerMetalShadow}
            strokeOpacity={0.78}
            strokeWidth={0.7}
          />
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={4.5}
            fill="none"
            stroke={GAUGE_COLORS.outerMetalHighlight}
            strokeOpacity={0.34}
            strokeWidth={0.55}
          />
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={1.5}
            fill={hasValue ? GAUGE_COLORS.hubSensor : GAUGE_COLORS.needleMuted}
          />
          <circle cx={CENTRE - 0.55} cy={CENTRE - 0.55} r={0.55} fill={GAUGE_COLORS.needleHighlight} fillOpacity={0.62} />
        </svg>

        {/* The glass readout sits at the bottom of the face, as it does in the app. */}
        <div className="gauge-readout">
          <strong>{hasValue ? spec.format(animated) : spec.format(undefined)}</strong>
          <span>{spec.label}</span>
        </div>
      </div>

      {statusText && (
        <span className="gauge-status" style={{ color: statusColor, borderColor: `${statusColor}38` }}>
          {statusText}
        </span>
      )}
    </div>
  );
}

/**
 * The panel of dials.
 *
 * The app shows five; this shows four. Its 功率（GW）dial is fed by SWPC's hemispheric-power text
 * feed, which this dashboard does not monitor — adding it would change a production monitor's
 * output, so the dial is left out rather than filled with a stand-in.
 */
export function AuroraGauges({
  kpData,
  windData,
}: {
  kpData: Record<string, unknown>;
  windData: Record<string, unknown>;
}) {
  const readings = readGauges(kpData, windData);
  return (
    <div className="gauges">
      {readings.map((reading, index) => (
        // AuroraGaugeStyle.animationStaggerDelay: each dial starts 50 ms after the one before it.
        <Dial key={reading.spec.key} reading={reading} delayMs={index * 50} />
      ))}
    </div>
  );
}
