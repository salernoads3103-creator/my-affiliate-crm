import { cn } from "@/lib/utils";

type CrmoniaWordmarkProps = {
  className?: string;
  size?: "compact" | "default" | "sidebar";
  inverse?: boolean;
  showMark?: boolean;
};

export function CrmoniaWordmark({
  className,
  size = "default",
  inverse = false,
  showMark = false,
}: CrmoniaWordmarkProps) {
  return (
    <span
      role="img"
      aria-label="CRMONIA"
      className={cn(
        "inline-flex items-center whitespace-nowrap font-sans font-semibold uppercase leading-none tracking-[0.12em]",
        size === "compact" ? "text-[15px]" : size === "sidebar" ? "text-[20px]" : "text-lg",
        className,
      )}
    >
      {showMark && (
        <svg
          aria-hidden="true"
          viewBox="0 0 28 32"
          className={cn("mr-2.5 shrink-0", size === "compact" ? "h-5 w-[18px]" : "h-7 w-6")}
          fill="none"
        >
          <path
            d="M17.5 2.5h9L10.5 29.5h-9l16-27Z"
            fill="currentColor"
            className="text-brand-logo"
          />
          <path d="M17.6 2.5h8.9l-4.1 6.9h-9l4.2-6.9Z" fill="white" fillOpacity=".48" />
        </svg>
      )}
      <span className={inverse ? "text-white" : "text-foreground"}>CRM</span>
      <span
        aria-hidden="true"
        className={cn(
          "px-[0.2em] font-light tracking-[0.04em]",
          inverse ? "text-white/55" : "text-muted-foreground/70",
        )}
      >
        /
      </span>
      <span className="text-brand-logo">ONIA</span>
    </span>
  );
}
