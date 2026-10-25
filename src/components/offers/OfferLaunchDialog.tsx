"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { domainService } from "@/services/domainService";
import { productService } from "@/services/productService";
import { trackingProfileService } from "@/services/trackingProfileService";
import { offerLaunchService, type OfferLaunchStatus } from "@/services/offerLaunchService";
import { formatMinorUnits, formatMinorUnitsInput } from "@/lib/products/money";
import { localizeError, t, type TranslationKey } from "@/lib/i18n";
import type { DomainAddress } from "@/lib/domains/types";

type Props = {
  open: boolean;
  workspaceId: string;
  onOpenChange: (open: boolean) => void;
};

const OFFERS_QUERY_KEY = ["workspace-offers-catalog"] as const;
const EMPTY_DOMAIN_ADDRESSES: DomainAddress[] = [];

function progressFor(status: OfferLaunchStatus): number {
  if (status.stage === "published") return 100;
  if (status.stage === "adapter_prepared") return 75;
  if (status.stage === "landing_created") return 50;
  return 25;
}

function stepFor(status: OfferLaunchStatus): TranslationKey {
  if (status.stage === "published") return "Launch complete";
  if (status.stage === "adapter_prepared") return "Publishing landing";
  if (status.stage === "landing_created") return "Connecting form";
  return "Offer created";
}

function errorCopy(code: OfferLaunchStatus["lastErrorCode"]): TranslationKey | null {
  switch (code) {
    case "LANDING_ADAPTATION_REQUIRED":
      return "This ZIP needs adaptation before it can be launched.";
    case "INTAKE_API_NOT_CONFIGURED":
      return "The public Intake API is not configured.";
    case "DOMAIN_CONFLICT":
      return "The selected address is no longer free. Choose another verified address.";
    case "DOMAIN_NOT_READY":
      return "The selected address needs a fresh DNS and HTTPS check.";
    case "PUBLICATION_CONFLICT":
    case "PUBLICATION_FAILED":
      return "Publication is still being confirmed. Retry to safely continue.";
    case "LANDING_ARCHIVE_UNAVAILABLE":
    case "INTERNAL_ERROR":
      return "Preparing the launch failed. Your progress is saved.";
    default:
      return null;
  }
}

export function OfferLaunchDialog({ open, workspaceId, onOpenChange }: Props) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const storageKey = `crmonia:offer-launch:${workspaceId}`;
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<OfferLaunchStatus | null>(null);
  const [productId, setProductId] = useState("");
  const [offerName, setOfferName] = useState("");
  const [priceUah, setPriceUah] = useState("");
  const [hostId, setHostId] = useState("");
  const [tiktokProfileId, setTiktokProfileId] = useState("none");
  const [googleProfileId, setGoogleProfileId] = useState("none");
  const [archive, setArchive] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const stored = window.localStorage.getItem(storageKey);
    setLaunchId(stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : null);
    setRunStatus(null);
    setFormError(null);
  }, [open, storageKey]);

  const productsQuery = useQuery({
    queryKey: ["products", workspaceId, "offer-launch"],
    queryFn: () => productService.list(workspaceId, ""),
    enabled: open && Boolean(workspaceId),
  });
  const domainsQuery = useQuery({
    queryKey: ["available-domain-hosts", workspaceId, "offer-launch"],
    queryFn: () => domainService.listAvailable(workspaceId),
    enabled: open && Boolean(workspaceId),
  });
  const profilesQuery = useQuery({
    queryKey: ["tracking-profiles", workspaceId, "offer-launch"],
    queryFn: () => trackingProfileService.list(workspaceId),
    enabled: open && Boolean(workspaceId),
  });
  const statusQuery = useQuery({
    queryKey: ["offer-launch", workspaceId, launchId],
    queryFn: () => offerLaunchService.get(workspaceId, launchId!),
    enabled: open && Boolean(launchId),
    refetchInterval: (query) => (query.state.data?.isProcessing ? 2000 : false),
    retry: false,
  });

  const startMutation = useMutation({
    mutationFn: (input: { id: string; file: File }) =>
      offerLaunchService.start(workspaceId, {
        launchId: input.id,
        productId,
        offerName,
        priceUah,
        hostId,
        tiktokProfileId: tiktokProfileId === "none" ? null : tiktokProfileId,
        googleAdsProfileId: googleProfileId === "none" ? null : googleProfileId,
        archive: input.file,
      }),
    onSuccess: async (status) => {
      setRunStatus(status);
      await queryClient.invalidateQueries({ queryKey: OFFERS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["offer-launch", workspaceId] });
    },
    onError: async (error) => {
      setFormError(
        localizeError(error, t("Preparing the launch failed. Your progress is saved."), locale),
      );
      await queryClient.invalidateQueries({ queryKey: ["offer-launch", workspaceId] });
      await Promise.all([
        statusQuery.refetch().catch(() => undefined),
        domainsQuery.refetch().catch(() => undefined),
      ]);
    },
  });
  const resumeMutation = useMutation({
    mutationFn: (nextHostId?: string) => {
      if (!launchId) throw new Error("Launch is unavailable");
      return offerLaunchService.resume(workspaceId, launchId, nextHostId);
    },
    onSuccess: async (status) => {
      setRunStatus(status);
      await queryClient.invalidateQueries({ queryKey: OFFERS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["offer-launch", workspaceId, launchId] });
      await domainsQuery.refetch();
    },
    onError: async (error) => {
      toast.error(
        localizeError(error, t("Preparing the launch failed. Your progress is saved."), locale),
      );
      await Promise.all([
        statusQuery.refetch().catch(() => undefined),
        domainsQuery.refetch().catch(() => undefined),
      ]);
    },
  });

  const status = statusQuery.data !== undefined ? statusQuery.data : runStatus;
  const products = productsQuery.data?.products.filter((product) => product.is_active) ?? [];
  const addresses = domainsQuery.data ?? EMPTY_DOMAIN_ADDRESSES;
  const profiles = profilesQuery.data?.filter((profile) => profile.is_active) ?? [];
  const selectedProduct = products.find((product) => product.id === productId);
  const tiktokProfiles = profiles.filter((profile) => profile.platform === "tiktok");
  const googleProfiles = profiles.filter((profile) => profile.platform === "google_ads");
  const unavailable = productsQuery.isError || domainsQuery.isError || profilesQuery.isError;
  const isRestoring = Boolean(launchId && !statusQuery.isFetched);
  const isBusy =
    startMutation.isPending || resumeMutation.isPending || Boolean(status?.isProcessing);
  const message = status?.lastErrorCode ? errorCopy(status.lastErrorCode) : null;

  useEffect(() => {
    if (status?.hostId && addresses.some((address) => address.id === status.hostId)) {
      setHostId(status.hostId);
    }
  }, [status?.hostId, addresses]);

  const canStart = Boolean(productId && offerName.trim() && priceUah.trim() && hostId && archive);
  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canStart || !archive) {
      setFormError(t("Choose an active product, a free verified hostname, and a ZIP."));
      return;
    }
    let id = launchId;
    if (!id || (status && status.stage === "published")) id = crypto.randomUUID();
    setLaunchId(id);
    window.localStorage.setItem(storageKey, id);
    setFormError(null);
    await startMutation.mutateAsync({ id, file: archive });
  };

  const startAnother = () => {
    window.localStorage.removeItem(storageKey);
    setLaunchId(null);
    setRunStatus(null);
    setProductId("");
    setOfferName("");
    setPriceUah("");
    setHostId("");
    setTiktokProfileId("none");
    setGoogleProfileId("none");
    setArchive(null);
    setFormError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Launch offer")}</DialogTitle>
          <DialogDescription>
            {t("Choose an active product, a free verified hostname, and a ZIP.")}
          </DialogDescription>
        </DialogHeader>

        {isRestoring ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("Recovering saved launch…")}
          </div>
        ) : launchId && statusQuery.isError ? (
          <div className="space-y-4 py-4">
            <p role="alert" className="text-sm text-destructive">
              {t("Could not recover the saved launch. Retry loading its state before continuing.")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void statusQuery.refetch()}
            >
              {t("Retry safely")}
            </Button>
          </div>
        ) : status ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{status.offerName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status.hostname ??
                    addresses.find((address) => address.id === status.hostId)?.hostname ??
                    "—"}
                </p>
              </div>
              {status.stage === "published" && (
                <Check className="h-5 w-5 shrink-0 text-emerald-500" />
              )}
            </div>
            <Progress value={progressFor(status)} aria-label={t(stepFor(status))} />
            <p className="text-sm font-medium">{t(stepFor(status))}</p>

            {status.stage === "published" && status.url ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <p className="text-sm text-muted-foreground">{t("The HTTPS link is available.")}</p>
                <a
                  href={status.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex max-w-full items-center gap-2 break-all font-medium text-primary hover:underline"
                >
                  {status.url}
                  <ExternalLink className="h-4 w-4 shrink-0" />
                </a>
              </div>
            ) : (
              <>
                {message && (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {t(message)}
                  </p>
                )}
                {status.isProcessing && (
                  <p className="text-sm text-muted-foreground">
                    {t("Another request is processing this launch.")}
                  </p>
                )}
                {status.lastErrorCode === "DOMAIN_CONFLICT" &&
                  status.stage !== "adapter_prepared" && (
                    <div className="space-y-2">
                      <Label>{t("Select another verified hostname")}</Label>
                      <Select value={hostId} onValueChange={setHostId}>
                        <SelectTrigger>
                          <SelectValue placeholder={t("Available hostname")} />
                        </SelectTrigger>
                        <SelectContent>
                          {addresses.map((address) => (
                            <SelectItem key={address.id} value={address.id}>
                              {address.hostname}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                <Button
                  onClick={() =>
                    void resumeMutation.mutateAsync(
                      status.lastErrorCode === "DOMAIN_CONFLICT" && hostId !== status.hostId
                        ? hostId
                        : undefined,
                    )
                  }
                  disabled={isBusy}
                  className="w-full"
                >
                  {isBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="mr-2 h-4 w-4" />
                  )}
                  {status.lastErrorCode ? t("Retry safely") : t("Continue launch")}
                </Button>
              </>
            )}
            {status.stage === "published" && (
              <Button variant="outline" className="w-full" onClick={startAnother}>
                {t("Start another launch")}
              </Button>
            )}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void start(event)}>
            {unavailable && (
              <div
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {t("Could not load launch options.")}
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("Choose a product")}</Label>
              <Select
                value={productId}
                onValueChange={(value) => {
                  setProductId(value);
                  const product = products.find((item) => item.id === value);
                  if (product) {
                    setOfferName(product.name);
                    setPriceUah(formatMinorUnitsInput(product.sale_price_minor));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("Choose a product")} />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} · {formatMinorUnits(product.sale_price_minor, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="offer-launch-name">{t("Offer name")}</Label>
                <Input
                  id="offer-launch-name"
                  value={offerName}
                  maxLength={120}
                  onChange={(event) => setOfferName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-launch-price">{t("Offer price (UAH)")}</Label>
                <Input
                  id="offer-launch-price"
                  type="text"
                  inputMode="decimal"
                  value={priceUah}
                  onChange={(event) => setPriceUah(event.target.value)}
                  required
                />
              </div>
            </div>
            {selectedProduct && (
              <p className="-mt-2 text-xs text-muted-foreground">
                {selectedProduct.name} ·{" "}
                {formatMinorUnits(selectedProduct.sale_price_minor, locale)}
              </p>
            )}

            <div className="space-y-2">
              <Label>{t("Available hostname")}</Label>
              {addresses.length ? (
                <Select value={hostId} onValueChange={setHostId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("Available hostname")} />
                  </SelectTrigger>
                  <SelectContent>
                    {addresses.map((address) => (
                      <SelectItem key={address.id} value={address.id}>
                        {address.hostname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
                  {t("No verified free addresses")}. {t("Manage domains before launch.")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("Tracking pixels (optional)")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("Tracking profiles are optional.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select value={tiktokProfileId} onValueChange={setTiktokProfileId}>
                  <SelectTrigger aria-label="TikTok">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">TikTok · {t("No tracking")}</SelectItem>
                    {tiktokProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        TikTok · {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={googleProfileId} onValueChange={setGoogleProfileId}>
                  <SelectTrigger aria-label="Google Ads">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Google Ads · {t("No tracking")}</SelectItem>
                    {googleProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        Google Ads · {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="offer-launch-zip">{t("Landing ZIP")}</Label>
              <Input
                id="offer-launch-zip"
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
                required
              />
              {archive && (
                <p className="text-xs text-muted-foreground">
                  {archive.name} · {(archive.size / 1024 / 1024).toFixed(1)} MB
                </p>
              )}
            </div>

            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("Close")}
              </Button>
              <Button
                type="submit"
                disabled={!canStart || isBusy || domainsQuery.isLoading || productsQuery.isLoading}
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-4 w-4" />
                )}
                {t("Create and get link")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
