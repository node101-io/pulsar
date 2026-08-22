import { cn } from "@/lib/utils";

/**
 * The app's busy indicator. Inherits currentColor, so it takes the color of
 * whatever it sits in.
 *
 * Reserved for work that is actually in flight. A spinner promises an answer
 * is coming, so it must never stand in for a read that already failed —
 * spinning forever tells the user to keep waiting for something that will not
 * arrive, which is the same kind of lie as showing a stale zero.
 */
export const Spinner = ({ className }: { className?: string }) => (
  <svg
    className={cn("size-4 animate-spin", className)}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);
