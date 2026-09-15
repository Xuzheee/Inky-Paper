import { useId } from "react";

/** The stroke follows recorded elapsed time; the pencil motion is decorative. */
export function PencilProgress({
  elapsed,
  total,
  running,
}: {
  elapsed: number;
  total: number;
  running: boolean;
}) {
  const clip = useId().replace(/:/g, "");
  const ratio = Math.max(0, Math.min(1, elapsed / Math.max(1, total)));
  const x = 8 + ratio * 272;
  const grain = `${clip}-grain`;
  const mask = `${clip}-mask`;
  // Fixed marks keep the graphite texture still as time reveals the line.
  const hatching = Array.from({ length: 68 }, (_, i) => {
    const at = 9 + i * 4;
    const y = 15.2 + Math.sin(i * 2.3) * 0.6;
    return `M${at} ${y + 3.5}l2.8 -${2.7 + (i % 3) * 0.4}`;
  }).join(" ");
  return (
    <div
      className={`pencil-progress ${running ? "is-drawing" : ""}`}
      role="progressbar"
      aria-label="本轮计时进度"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.round(elapsed)}
    >
      <svg viewBox="0 0 296 24" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect className="pencil-reveal" style={{ width: x }} height="24" />
          </clipPath>
          <pattern
            id={grain}
            width="9"
            height="7"
            patternUnits="userSpaceOnUse"
          >
            <rect width="9" height="7" fill="white" />
            <path
              d="M1 1l1.3 .3 M5 3l1 -.4 M2 5l.8 .5 M7 6l1 -.2"
              stroke="black"
              strokeWidth=".7"
              opacity=".65"
            />
            <circle cx="4" cy=".7" r=".45" fill="black" opacity=".5" />
          </pattern>
          <mask
            id={mask}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="296"
            height="24"
          >
            <rect width="296" height="24" fill={`url(#${grain})`} />
          </mask>
        </defs>
        <g className="pencil-track">
          <path d="m8 17 19-.4 13 .6 21-.8 17 .5 22-.2 18 .8 22-.4 19 .2 19-.8 23 .5 20-.4 19 .8 20-.5 21 .2" />
          <path
            className="pencil-track-echo"
            d="m9 18.5 24-.5 32 .4 27-.5 28 .8 26-.4 30-.2 28 .5 25-.7 27 .6 23-.3"
          />
        </g>
        <g clipPath={`url(#${clip})`}>
          <g className="pencil-ink" mask={`url(#${mask})`}>
            <path
              className="pencil-body"
              d="m8 17 12-.4 10 .5 9-.5 12 .2 11-.4 10 .5 10-.3 13 .6 9-.4 11 .5 10-.2 11 .3 13-.6 9 .3 11-.7 12 .4 10-.2 12 .5 10-.4 11 .1 10-.4 12 .6 13-.2 11 .1"
            />
            <path
              className="pencil-overdraw"
              d="m8 15.9 23 .2 17-.7 28 .4 20 .1 22 .5 25-.4 23-.3 20 .3 22-.4 27 .6 24-.3 20 .1"
            />
            <path
              className="pencil-overdraw pencil-understroke"
              d="m9 19 20-.3 25 .5 23-.6 21 .4 24-.1 25 .4 23-.6 25 .2 22-.3 23 .4 20-.5 19 .2"
            />
            <path className="pencil-hatching" d={hatching} />
          </g>
        </g>
        <g
          style={{ transform: `translateX(${x}px)` }}
          className="pencil-position"
        >
          <g className="pencil-tip">
            <path
              d="M0 17 L3 10 L13 0 Q15 -2 17 0 L18 1 Q19 2 17 4 L7 14 Z"
              fill="#f6f1df"
            />
            <path d="M3 10 L7 14 M5 11 L15 1 M0 17 L2 13 L4 15 Z" />
          </g>
        </g>
      </svg>
    </div>
  );
}
