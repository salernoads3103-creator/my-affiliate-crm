import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  Eye,
  Files,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { LandingDraftDialog } from "@/components/landings/LandingCreateDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { LandingAnalysisWarning, LandingPage, LandingStatus } from "@/lib/landings/types";
import type { LandingAdapterReason, LandingAdapterStatus } from "@/lib/landings/types";
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

const ADAPTER_STATUS_LABEL: Record<LandingAdapterStatus, TranslationKey> = {
  not_connected: "Form not connected",
  needs_adaptation: "Needs adaptation",
  configuration_required: "Not ready to publish",
  prepared: "Adapted ZIP prepared",
  error: "Could not prepare the ZIP",
};

const ADAPTER_REASON_LABEL: Record<LandingAdapterReason, TranslationKey> = {
  index_missing: "The archive does not contain index.html.",
  root_ambiguous: "The site root is unclear. Keep one index.html at the archive root.",
  form_missing: "No HTML form was found in index.html.",
  multiple_forms: "More than one form was found. The target form must be selected manually.",
  name_field_missing: "Could not identify a unique name field.",
  name_field_ambiguous: "Several fields could be the customer's name.",
  phone_field_missing: "Could not identify a unique phone field.",
  phone_field_ambiguous: "Several fields could be the phone number.",
  custom_submit_handler: "The form already has JavaScript submission logic.",
  external_script_unavailable: "A script could not be reviewed, so automatic wiring is unsafe.",
  third_party_form_action: "The form is connected to an external service.",
  adapter_asset_collision: "The archive already contains the adapter script filename.",
  invalid_html_encoding: "index.html is not UTF-8 and cannot be changed safely.",
  ambiguous_markup: "The form markup is ambiguous. Review the form HTML before connecting it.",
  base_url_present: "Remove the HTML base URL element before connecting the form.",
  invalid_archive: "The saved ZIP failed archive integrity checks.",
  too_many_files: "Adding the adapter would exceed the file-count limit.",
  archive_too_large: "The adapted ZIP would exceed the 25 MB storage limit.",
  api_url_not_configured:
    "Set the public HTTPS intake URL on the CRM server, then rebuild this ZIP.",
  landing_origin_not_configured:
    "Set the landing page origin to enable submissions and publishing.",
  tiktok_pixel_conflict:
    "A TikTok Pixel or Google Tag Manager may already install tracking, but no single matching Pixel ID could be confirmed. Remove or verify the existing integration before adding this Pixel ID.",
  google_ads_configuration_invalid: "Enter a valid Google Ads Conversion ID and label.",
  google_ads_tag_conflict:
    "A Google tag or Google Tag Manager is already present. Remove it or verify the setup before enabling Google Ads here.",
};

const PIXEL_LABELS = {
  meta: "Meta Pixel",
  tiktok: "TikTok Pixel",
  google_analytics: "Google Analytics",
  google_tag_manager: "Google Tag Manager",
  google_tag: "Google tag",
  google_ads: "Google Ads tag",
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
    permissions["landing_pages.manage"] === true && permissions["offers.read"] === true;
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [analysisLanding, setAnalysisLanding] = useState<LandingPage | null>(null);
  const [editingLanding, setEditingLanding] = useState<LandingPage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LandingPage | null>(null);
  const [adapterOrigin, setAdapterOrigin] = useState("");
  const [tiktokPixelId, setTiktokPixelId] = useState("");
  const [googleAdsConversionId, setGoogleAdsConversionId] = useState("");
  const [googleAdsConversionLabel, setGoogleAdsConversionLabel] = useState("");

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
  const updateMutation = useMutation({
    mutationFn: (input: { landingId: string; name: string; offerId: string; archive?: File }) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      const { landingId, ...changes } = input;
      return landingService.updateDraft(workspaceId, landingId, changes);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LANDINGS_QUERY_KEY });
      toast.success(t("Landing draft updated"));
      setEditingLanding(null);
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not update landing draft"), locale)),
  });
  const deleteMutation = useMutation({
    mutationFn: (landingId: string) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return landingService.deleteDraft(workspaceId, landingId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LANDINGS_QUERY_KEY });
      toast.success(t("Landing draft deleted"));
      setDeleteTarget(null);
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: LANDINGS_QUERY_KEY });
      toast.error(
        localizeError(error, t("Could not finish deleting the landing draft. Try again."), locale),
      );
    },
  });
  const connectFormMutation = useMutation({
    mutationFn: (input: {
      landingId: string;
      allowedOrigin?: string;
      tiktokPixelId: string | null;
      googleAdsConversionId: string | null;
      googleAdsConversionLabel: string | null;
    }) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      const { landingId, ...config } = input;
      return landingService.connectForm(workspaceId, landingId, config);
    },
    onSuccess: async (result, input) => {
      setAnalysisLanding((current) =>
        current?.id === input.landingId ? { ...current, ...result } : current,
      );
      await queryClient.invalidateQueries({ queryKey: LANDINGS_QUERY_KEY });
      if (result.adapter_status === "needs_adaptation" && result.adapter_reason) {
        toast.error(t(ADAPTER_REASON_LABEL[result.adapter_reason]));
      } else if (result.adapter_status === "configuration_required") {
        toast.success(t("Adapted ZIP saved; configuration is still required."));
      } else {
        toast.success(t("Landing form connected"));
      }
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not connect the landing form."), locale)),
  });
  const downloadAdapterMutation = useMutation({
    mutationFn: (landingId: string) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return landingService.downloadAdaptedArchive(workspaceId, landingId);
    },
    onSuccess: (archive) => {
      downloadBlob(archive, "crmonia-landing-adapted.zip");
      toast.success(t("Adapted ZIP downloaded"));
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not download the adapted ZIP."), locale)),
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
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

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
          <div className="mt-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Landing name")}</TableHead>
                  <TableHead>{t("Offer")}</TableHead>
                  <TableHead>{t("Status and analysis")}</TableHead>
                  <TableHead>{t("Created")}</TableHead>
                  <TableHead>{t("ZIP size")}</TableHead>
                  <TableHead className="text-right">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {landings.map((landing) => {
                  const canEdit =
                    permissions["landing_pages.manage"] === true &&
                    landing.status === "draft" &&
                    !landing.deletion_started_at;
                  const canDelete =
                    permissions["landing_pages.manage"] === true && landing.status === "draft";
                  return (
                    <TableRow key={landing.id}>
                      <TableCell className="max-w-64 font-medium">
                        <span className="line-clamp-2">{landing.name}</span>
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="line-clamp-2">{landing.offer_name}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-36 flex-col items-start gap-1.5">
                          <Badge variant={statusVariant(landing.status)}>
                            {landing.deletion_started_at
                              ? t("Deletion pending")
                              : t(STATUS_LABEL[landing.status])}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {landing.deletion_started_at
                              ? t("Retry deletion to finish removing this draft.")
                              : landing.analysis.requiresAdaptation
                                ? t("Needs adaptation")
                                : t("Analysis ready")}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(landing.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {landing.source_archive_bytes === null
                          ? "—"
                          : formatBytes(landing.source_archive_bytes, locale)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("View analysis for {name}", { name: landing.name })}
                            title={t("View analysis")}
                            onClick={() => {
                              setAdapterOrigin("");
                              setTiktokPixelId(landing.tiktok_pixel_id ?? "");
                              setGoogleAdsConversionId(landing.google_ads_conversion_id ?? "");
                              setGoogleAdsConversionLabel(
                                landing.google_ads_conversion_label ?? "",
                              );
                              setAnalysisLanding(landing);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("Edit {name}", { name: landing.name })}
                              title={t("Edit")}
                              onClick={() => setEditingLanding(landing)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                landing.deletion_started_at
                                  ? t("Retry deletion for {name}", { name: landing.name })
                                  : t("Delete {name}", { name: landing.name })
                              }
                              title={
                                landing.deletion_started_at ? t("Retry deletion") : t("Delete")
                              }
                              onClick={() => setDeleteTarget(landing)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {canCreateLandings && (
        <LandingDraftDialog
          open={dialogOpen || editingLanding !== null}
          workspaceId={workspaceId}
          saving={createMutation.isPending || updateMutation.isPending}
          landing={editingLanding ?? undefined}
          onOpenChange={(open) => {
            if (!open) {
              setDialogOpen(false);
              setEditingLanding(null);
            }
          }}
          onSubmit={(input) => {
            if (editingLanding) {
              updateMutation.mutate({ landingId: editingLanding.id, ...input });
            } else if (input.archive) {
              createMutation.mutate({ ...input, archive: input.archive });
            }
          }}
        />
      )}

      <Dialog
        open={analysisLanding !== null}
        onOpenChange={(open) => {
          if (!open) setAnalysisLanding(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{analysisLanding?.name}</DialogTitle>
            <DialogDescription>
              {analysisLanding?.offer_name} · {t("ZIP size")}:{" "}
              {analysisLanding?.source_archive_bytes === null ||
              analysisLanding?.source_archive_bytes === undefined
                ? "—"
                : formatBytes(analysisLanding.source_archive_bytes, locale)}
            </DialogDescription>
          </DialogHeader>
          {analysisLanding && <LandingCard landing={analysisLanding} locale={locale} />}
          {analysisLanding &&
            canCreateLandings &&
            analysisLanding.status === "draft" &&
            !analysisLanding.deletion_started_at && (
              <section className="space-y-3 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t("Landing form connection")}</h3>
                  <Badge
                    variant={
                      analysisLanding.adapter_status === "prepared"
                        ? "default"
                        : analysisLanding.adapter_status === "needs_adaptation" ||
                            analysisLanding.adapter_status === "error"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {t(ADAPTER_STATUS_LABEL[analysisLanding.adapter_status])}
                  </Badge>
                </div>
                {analysisLanding.adapter_reason && (
                  <p className="text-sm text-muted-foreground">
                    {t(ADAPTER_REASON_LABEL[analysisLanding.adapter_reason])}
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="landing-allowed-origin">{t("Published landing origin")}</Label>
                  <Input
                    id="landing-allowed-origin"
                    type="url"
                    inputMode="url"
                    placeholder="https://shop.example.com"
                    value={adapterOrigin}
                    onChange={(event) => setAdapterOrigin(event.target.value)}
                    maxLength={255}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Optional. Enter the exact HTTPS origin when it is known; no wildcard is allowed.",
                    )}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="landing-tiktok-pixel-id">{t("TikTok Pixel ID (optional)")}</Label>
                  <Input
                    id="landing-tiktok-pixel-id"
                    autoComplete="off"
                    maxLength={64}
                    value={tiktokPixelId}
                    onChange={(event) => setTiktokPixelId(event.target.value)}
                    placeholder="CXXXXXXXXXXXXXXX"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("The Pixel ID is public and is stored with this landing.")}
                  </p>
                  {(analysisLanding.analysis.detectedPixels.includes("tiktok") ||
                    analysisLanding.analysis.detectedPixels.includes("google_tag_manager")) && (
                    <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        {t(
                          "A TikTok Pixel is already present. The adapter reuses it only when its ID matches; otherwise connection is blocked to avoid duplicate tracking.",
                        )}
                      </span>
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="landing-google-ads-conversion-id">
                    {t("Google Ads Conversion ID (optional)")}
                  </Label>
                  <Input
                    id="landing-google-ads-conversion-id"
                    autoComplete="off"
                    maxLength={23}
                    value={googleAdsConversionId}
                    onChange={(event) => setGoogleAdsConversionId(event.target.value)}
                    placeholder="AW-123456789"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="landing-google-ads-conversion-label">
                    {t("Google Ads Conversion Label (optional)")}
                  </Label>
                  <Input
                    id="landing-google-ads-conversion-label"
                    autoComplete="off"
                    maxLength={128}
                    value={googleAdsConversionLabel}
                    onChange={(event) => setGoogleAdsConversionLabel(event.target.value)}
                    placeholder="AbC-D_efG-h12_34-567"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("Use the ID and label from the Google Ads conversion tag.")}
                  </p>
                  {(analysisLanding.analysis.detectedPixels.includes("google_analytics") ||
                    analysisLanding.analysis.detectedPixels.includes("google_tag") ||
                    analysisLanding.analysis.detectedPixels.includes("google_ads") ||
                    analysisLanding.analysis.detectedPixels.includes("google_tag_manager")) && (
                    <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        {t(
                          "A Google tag is already present. Verify it before enabling Google Ads here.",
                        )}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      connectFormMutation.mutate({
                        landingId: analysisLanding.id,
                        ...(adapterOrigin.trim() ? { allowedOrigin: adapterOrigin.trim() } : {}),
                        tiktokPixelId: tiktokPixelId.trim() || null,
                        googleAdsConversionId: googleAdsConversionId.trim() || null,
                        googleAdsConversionLabel: googleAdsConversionLabel.trim() || null,
                      })
                    }
                    disabled={connectFormMutation.isPending || downloadAdapterMutation.isPending}
                  >
                    {connectFormMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    {t("Connect form")}
                  </Button>
                  {analysisLanding.has_adapted_archive &&
                    analysisLanding.adapter_status === "prepared" && (
                      <Button
                        variant="outline"
                        onClick={() => downloadAdapterMutation.mutate(analysisLanding.id)}
                        disabled={
                          downloadAdapterMutation.isPending || connectFormMutation.isPending
                        }
                      >
                        {downloadAdapterMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        {t("Download ZIP")}
                      </Button>
                    )}
                </div>
              </section>
            )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.deletion_started_at
                ? t("Finish deleting this draft?")
                : t("Delete this landing draft?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.deletion_started_at
                ? t(
                    "The previous deletion did not finish. Retry to remove the private ZIP and draft.",
                  )
                : t(
                    "This removes the draft and its private source ZIP. Published landing pages cannot be deleted here.",
                  )}
              {deleteTarget ? ` ${deleteTarget.name}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t("Cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteTarget?.deletion_started_at ? t("Retry deletion") : t("Delete draft")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
