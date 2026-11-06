import type { SVGProps } from "react";
import { NEURAL_BOOK, nodeById, type NeuralBook } from "../brand/neuralBook";

interface Props extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  book?: NeuralBook;
  /** Draw the soft crimson light behind the core node. */
  glow?: boolean;
  title?: string;
}

/** Static SVG of the neural-book mark. Colours come from the product tokens. */
export function AstraLogo({ book = NEURAL_BOOK, glow = true, title = "Astra AI", ...rest }: Props) {
  const byId = nodeById(book);
  const core = book.nodes.find((n) => n.role === "core");
  return (
    <svg viewBox={book.viewBox} role="img" aria-label={title} {...rest}>
      <defs>
        <radialGradient id="astra-core-glow">
          <stop offset="0" stopColor="#b52d58" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#681b3a" stopOpacity="0.35" />
          <stop offset="1" stopColor="#3d1028" stopOpacity="0" />
        </radialGradient>
      </defs>
      {glow && core && <circle cx={core.x} cy={core.y} r={34} fill="url(#astra-core-glow)" />}
      <g fill="none" stroke="#e6a1b4" strokeWidth="0.8" opacity="0.22">
        {book.pagePaths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g stroke="rgba(230,161,180,0.38)" strokeWidth="0.7" strokeLinecap="round">
        {book.edges.map(([a, b]) => {
          const na = byId.get(a);
          const nb = byId.get(b);
          if (!na || !nb) return null;
          return <line key={`${a}-${b}`} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} />;
        })}
      </g>
      <g>
        {book.nodes.map((n) => (
          <circle
            key={n.id}
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={
              n.role === "core"
                ? "#f2bfcd"
                : n.role === "spine"
                  ? "#b52d58"
                  : n.role === "halo"
                    ? "#c9728f"
                    : "#e6a1b4"
            }
          />
        ))}
      </g>
    </svg>
  );
}
