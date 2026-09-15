export function CompletionMoment({
  title,
  wholeTask,
  pet,
}: {
  title: string;
  wholeTask: boolean;
  pet: string;
}) {
  return (
    <section
      className="completion-moment"
      aria-label={wholeTask ? "任务完成庆祝" : "步骤完成庆祝"}
    >
      <div className="completion-art" aria-hidden="true">
        <svg viewBox="0 0 260 110" className="celebration-stars">
          <g className="star star-one">
            <path d="m49 33 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" />
          </g>
          <g className="star star-two">
            <path d="m207 29 2-7 3 7 7 3-7 2-3 8-2-8-8-2Z" />
          </g>
          <g className="star star-three">
            <path d="m185 81 2-5 1 5 6 2-6 1-1 6-2-6-5-1Z" />
          </g>
          <path
            className="celebration-dash"
            d="m78 17 3 7 M166 16l-3 7 M43 75l8-3 M218 62l-8-2"
          />
          <path className="celebration-ground" d="M87 98q40-3 88 0" />
        </svg>
        <img src={pet} alt="" />
      </div>
      <p className="completion-label">
        {wholeTask ? "又一件事，好好收尾了" : "一小步，也值得开心"}
      </p>
      <h1>{wholeTask ? "完成了，收好这一页。" : "这一步，做到了。"}</h1>
      <p className="crossed completion-title" title={title}>
        {title}
      </p>
      <p className="muted">
        {wholeTask
          ? "给自己一点掌声。Inky 也为你开心。"
          : "这一步已划掉。整个任务请在列表中单独完成。"}
      </p>
    </section>
  );
}
