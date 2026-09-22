/** The light/dark switch, as Atlas draws it: one icon button in the
 * topbar showing the theme you would switch TO — a moon in light, a sun in
 * dark.
 *
 * It owns no state and no storage. The driver decides what "remembered"
 * means (Studio's own origin, `localStorage`), for the same reason the
 * store owns no storage medium: a component that reaches for
 * `localStorage` cannot be rendered on a server or asserted on in node. */
import type { StudioTheme } from "../theme";

interface Props {
  readonly theme: StudioTheme;
  readonly onChange: (theme: StudioTheme) => void;
}

export function ThemeToggle({ theme, onChange }: Props) {
  const next: StudioTheme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} theme`;
  return (
    <button type="button" className="fd-themetoggle" aria-label={label} title={label} onClick={() => onChange(next)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </>
        ) : (
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        )}
      </svg>
    </button>
  );
}
