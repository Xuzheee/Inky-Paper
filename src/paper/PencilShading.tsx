import { useId } from "react";

// One continuous pencil pass. Fixed irregular marks stay still after selection.
const shading = Array.from({ length: 34 }, (_, index) => {
  const x = 6 + index * 3.45;
  const edge = Math.sin((index / 33) * Math.PI);
  const top = 12 - edge * 6 + Math.sin(index * 2.4) * 1.4;
  const bottom = 32 + edge * 4 + Math.cos(index * 1.8) * 1.8;
  return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${bottom.toFixed(1)} L${(x + 9).toFixed(1)} ${top.toFixed(1)}`;
}).join(" ");

export function PencilShading() {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className="outcome-shading"
      viewBox="0 0 136 44"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id={`${id}-grain`} width="7" height="6" patternUnits="userSpaceOnUse">
          <rect width="7" height="6" fill="white" />
          <path d="M1 1l1 .4 M5 2l.8 -.3 M2 5l1 -.4" stroke="black" strokeWidth=".7" opacity=".65" />
          <circle cx="5" cy="5" r=".5" fill="black" opacity=".5" />
        </pattern>
        <mask id={`${id}-mask`}>
          <rect width="136" height="44" fill={`url(#${id}-grain)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        <path className="pencil-shade-soft" d={shading} pathLength="1" />
        <path className="pencil-shade-grain" d={shading} pathLength="1" />
      </g>
    </svg>
  );
}
