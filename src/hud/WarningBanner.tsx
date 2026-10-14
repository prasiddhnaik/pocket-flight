import { warningText, type WarningId } from "./warnings";

export function WarningBanner({ warning }: { warning: WarningId | null }) {
  if (!warning) return null;
  return (
    <>
      <div className="hud-warning-edge" aria-hidden="true" />
      <div key={warning} className={`hud-warning hud-warning-${warning}`} role="alert">
        {warningText[warning]}
      </div>
    </>
  );
}
