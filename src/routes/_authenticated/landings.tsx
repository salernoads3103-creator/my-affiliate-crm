import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Files, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { LandingCreateDialog } from "@/components/landings/LandingCreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { LandingAnalysisWarning, LandingPage, LandingStatus } from "@/lib/landings/types";
import { localizeError, t, type TranslationKey } from "@/lib/i18n";
import { landingService } from "@/services/landingService";

export const Route = createFileRoute("/_authenticated/landings")({ component: LandingsPage });

const LANDINGS_QUERY_KEY = ["workspace-landings"] as const;

const STATUS_LABEL: Record<LandingStatus, TranslationKey> = {
  draft: "Draft",
  ready: "Ready",
  published: "Published",
  error: "Error",
};

const WARNING_LABEL: Record<LandingAnalysisWarning, TranslationKey> = {
  index_missing: "No index.html found in the archive.",
  root_ambiguous: "Could not determine a single site root. Review the archive structure.",
  form_missing: "No standard HTML form was detected.",
  name_field_missing: "Could not identify a name field.",
  phone_field_missing: "Could not identify a phone field.",
  javascript_present: "JavaScript is present; review it before publishing.",
  scripts_not_scanned: "Standalone JavaScript files are not scanned.",
};

const PIXEL_LABELS = {
  meta: "Meta Pixel",
  tiktok: "TikTok Pixel",
  google_analytics: "Google Analytics",
  google_tag_manager: "Google Tag Manager",
} as const satisfies Record<LandingPage["analysis"]["detectedPixels"][number], TranslationKey>;

function formatBytes(bytes: number, locale: "uk" | "en"): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", {
    maximumFractionDigits: 1,
  }).format(size)} ${units[unitIndex]}`;
}

function statusVariant(status: LandingStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "published") return "default";
  if (status === "ready") return "outline";
  return "secondary";
}

function fieldLabel(field: { name: string | null; id: string | null; placeholder: string | null }) {
  return field.name ?? field.id ?? field.placeholder ?? "—";
}

function LandingCard({ landing, locale }: { landing: LandingPage; locale: "uk" | "en" }) {
  const date = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(landing.created_at));
  const analysis = landing.analysis;

  return (
    <article className="glass space-y-4 rounded-2xl border border-border p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold">{landing.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Offer")}: <span className="text-foreground/85">{landing.offer_name}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {analysis.requiresAdaptation && (
            <Badge
              variant="outline"
              className="border-amber-500/50 text-amber-700 dark:text-amber-300"
            >
              {t("Needs adaptation")}
            </Badge>
          )}
          <Badge variant={statusVariant(landing.status)}>{t(STATUS_LABEL[landing.status])}</Badge>
        </div>
      </header>

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">{t("Site root")}</p>
          <p className="mt-1 break-all font-medium">
            {analysis.siteRootPath === null
              ? t("Not determined")
              : analysis.siteRootPath || t("Archive root")}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">{t("index.html found")}</p>
          <p className="mt-1 font-medium">
            {analysis.hasIndexHtml ? t("Yes") : t("index.html not found")}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">{t("File count")}</p>
          <p className="mt-1 font-medium">{analysis.fileCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">{t("Unpacked size")}</p>
          <p className="mt-1 font-medium">{formatBytes(analysis.uncompressedBytes, locale)}</p>
        </div>
        <div className="rounded-xl border border-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">{t("ZIP saved privately")}</p>
          <p className="mt-1 font-medium">{date}</p>
        </div>
      </div>

      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("Landing analysis")}</h3>
          <span className="text-xs text-muted-foreground">
            {analysis.requiresAdaptation
              ? t("Needs adaptation")
              : t("Structure looks recognizable")}
          </span>
        </div>
        {analysis.forms.length > 0 ? (
          <div className="space-y-2">
            {analysis.forms.map((form) => (
              <div
                key={form.index}
                className="grid gap-2 rounded-lg border border-border/70 bg-background/30 p-3 text-xs sm:grid-cols-3"
              >
                <span className="font-medium">{t("Form {number}", { number: form.index })}</span>
                <span>
                  {t("Name field")}:{" "}
                  {fieldLabel(
                    form.fields.find((field) => field.isNameCandidate) ?? {
                      name: null,
                      id: null,
                      placeholder: null,
                    },
                  )}
                </span>
                <span>
                  {t("Phone field")}:{" "}
                  {fieldLabel(
                    form.fields.find((field) => field.isPhoneCandidate) ?? {
                      name: null,
                      id: null,
                      placeholder: null,
                    },
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {analysis.siteRootPath === null
              ? t("Form analysis is unavailable until a single site root can be identified.")
              : t("No forms detected")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("Detected pixels")}:</span>
          {analysis.detectedPixels.length > 0 ? (
            analysis.detectedPixels.map((pixel) => (
              <Badge key={pixel} variant="secondary">
                {t(PIXEL_LABELS[pixel])}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">{t("No known pixels detected")}</span>
          )}
        </div>

        {analysis.warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
            {analysis.warnings.map((warning) => (
              <li key={warning} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t(WARNING_LABEL[warning])}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

function LandingsPage() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { workspace, permissions, isLoading: accessLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canReadLandings =
    permissions["landing_pages.read"] === true || permissions["landing_pages.manage"] === true;
  const canCreateLandings =
    permissions["landing_pages.manage"] === true &&
    permissions["offers.read"] === true &&
    permissions["products.read"] === true;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const landingsQuery = useQuery({
    queryKey: [...LANDINGS_QUERY_KEY, workspaceId, search.trim()],
    queryFn: () => landingService.list(workspaceId!, search.trim()),
    enabled: Boolean(workspaceId && canReadLandings),
  });
  const createMutation = useMutation({
    mutationFn: (input: { name: string; offerId: string; archive: File }) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return landingService.createDraft(workspaceId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LANDINGS_QUERY_KEY });
      toast.success(t("Landing draft created"));
      setDialogOpen(false);
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not create landing draft"), locale)),
  });

  if (accessLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspaceId || !canReadLandings) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Landing pages")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view landing pages.")}
        </p>
      </section>
    );
  }

  const landings = landingsQuery.data?.landings ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("Landing analysis")}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            {t("Landing pages")}
          </h1>
        </div>
        {canCreateLandings && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("New landing page")}
          </Button>
        )}
      </header>

      <div className="glass rounded-2xl border border-border p-4 sm:p-5">
        <div className="relative max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("Search landing pages…")}
            placeholder={t("Search landing pages…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        {landingsQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : landingsQuery.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(landingsQuery.error, t("Could not load landing pages."), locale)}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void landingsQuery.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        ) : landings.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Files className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-semibold">
              {search.trim() ? t("No landing pages match your search.") : t("No landing pages yet")}
            </h2>
            {!search.trim() && canCreateLandings && (
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("New landing page")}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {landings.map((landing) => (
              <LandingCard key={landing.id} landing={landing} locale={locale} />
            ))}
          </div>
        )}
      </div>

      {canCreateLandings && (
        <LandingCreateDialog
          open={dialogOpen}
          workspaceId={workspaceId}
          saving={createMutation.isPending}
          onOpenChange={setDialogOpen}
          onCreate={(input) => createMutation.mutate(input)}
        />
      )}
    </div>
  );
}
