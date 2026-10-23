import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Search, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OfferCatalogItem, OfferWriteRequest } from "@/lib/offers/types";
import { OfferWriteSchema } from "@/lib/offers/validation";
import { localizeError, t } from "@/lib/i18n";
import { formatMinorUnitsInput } from "@/lib/products/money";
import { productService } from "@/services/productService";
import { offerService } from "@/services/offerService";
import { LandingOriginSchema } from "@/lib/intake/validation";

type OfferFormValues = OfferWriteRequest;

function buildLandingSnippet(publicId: string, endpoint: string, locale: "uk" | "en"): string {
  const copy =
    locale === "uk"
      ? {
          name: "Ім'я",
          phone: "Телефон",
          submit: "Замовити",
          sent: "Дякуємо! Заявку прийнято.",
          failed: "Не вдалося надіслати заявку. Спробуйте ще раз.",
        }
      : {
          name: "Name",
          phone: "Phone",
          submit: "Order",
          sent: "Thank you! Your request was received.",
          failed: "Could not send your request. Please try again.",
        };
  return `<form id="crmonia-lead-form">
  <label>${copy.name} <input name="name" required maxlength="120"></label>
  <label>${copy.phone} <input name="phone" type="tel" required maxlength="40"></label>
  <label aria-hidden="true" style="position:absolute;left:-10000px" tabindex="-1">Website <input name="website" tabindex="-1" autocomplete="off"></label>
  <button type="submit">${copy.submit}</button>
  <p id="crmonia-form-message" role="status"></p>
</form>
<script>
document.querySelector("#crmonia-lead-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const query = new URLSearchParams(window.location.search);
  const message = document.querySelector("#crmonia-form-message");
  try {
    const response = await fetch(${JSON.stringify(endpoint)}, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        formId: ${JSON.stringify(publicId)},
        name: values.get("name"),
        phone: values.get("phone"),
        website: values.get("website"),
        utmSource: query.get("utm_source") || undefined,
        utmMedium: query.get("utm_medium") || undefined,
        utmCampaign: query.get("utm_campaign") || undefined,
        utmContent: query.get("utm_content") || undefined,
        utmTerm: query.get("utm_term") || undefined,
        ttclid: query.get("ttclid") || undefined,
        subId: query.get("sub_id") || undefined
      })
    });
    if (!response.ok) throw new Error("Submission failed");
    message.textContent = ${JSON.stringify(copy.sent)};
    form.reset();
  } catch {
    message.textContent = ${JSON.stringify(copy.failed)};
  }
});
</script>`;
}

const emptyValues: OfferFormValues = {
  productId: "",
  name: "",
  priceUah: "",
  landingUrl: "",
  isActive: true,
};

export function OfferModal({
  open,
  workspaceId,
  offer,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  workspaceId: string;
  offer: OfferCatalogItem | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: OfferWriteRequest) => Promise<void>;
}) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<OfferFormValues>(emptyValues);
  const [productSearch, setProductSearch] = useState("");
  const [allowedOrigin, setAllowedOrigin] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const productsQuery = useQuery({
    queryKey: ["products", workspaceId, "offer-picker"],
    queryFn: () => productService.list(workspaceId, ""),
    enabled: open && Boolean(workspaceId),
  });
  const landingFormQuery = useQuery({
    queryKey: ["landing-form", workspaceId, offer?.id],
    queryFn: () => offerService.getLandingForm(workspaceId, offer!.id),
    enabled: open && Boolean(offer && workspaceId),
  });

  useEffect(() => {
    if (!open) return;
    setValues({
      productId: offer?.product_id ?? "",
      name: offer?.name ?? "",
      priceUah: formatMinorUnitsInput(offer?.offer_price_minor),
      landingUrl: offer?.landing_url ?? "",
      isActive: offer?.is_active ?? true,
    });
    setProductSearch("");
    setConfirmDeactivate(false);
    if (offer?.landing_url) {
      try {
        setAllowedOrigin(new URL(offer.landing_url).origin);
      } catch {
        setAllowedOrigin("");
      }
    } else {
      setAllowedOrigin("");
    }
  }, [open, offer]);

  useEffect(() => {
    if (landingFormQuery.data?.allowedOrigin) {
      setAllowedOrigin(landingFormQuery.data.allowedOrigin);
    }
  }, [landingFormQuery.data?.allowedOrigin]);

  const refreshLandingForm = async () => {
    await queryClient.invalidateQueries({ queryKey: ["landing-form", workspaceId, offer?.id] });
  };

  const createLandingForm = async () => {
    const parsedOrigin = LandingOriginSchema.safeParse(allowedOrigin);
    if (!parsedOrigin.success || !offer) {
      toast.error(t("Enter one exact HTTPS origin"));
      return;
    }
    setFormBusy(true);
    try {
      await offerService.createLandingForm(workspaceId, offer.id, parsedOrigin.data);
      await refreshLandingForm();
      toast.success(t("Landing form connected"));
      setConfirmDeactivate(false);
    } catch (error) {
      toast.error(localizeError(error, t("Could not update landing connection."), locale));
    } finally {
      setFormBusy(false);
    }
  };

  const deactivateLandingForm = async () => {
    if (!offer) return;
    setFormBusy(true);
    try {
      await offerService.deactivateLandingForm(workspaceId, offer.id);
      await refreshLandingForm();
      toast.success(t("Landing form deactivated"));
      setConfirmDeactivate(false);
    } catch (error) {
      toast.error(localizeError(error, t("Could not update landing connection."), locale));
    } finally {
      setFormBusy(false);
    }
  };

  const copyLandingSnippet = async () => {
    const config = landingFormQuery.data;
    if (!config || !config.isActive || typeof window === "undefined") return;
    const endpoint = `${window.location.origin}/api/v1/intake/leads`;
    const snippet = buildLandingSnippet(config.publicId, endpoint, locale);
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success(t("Integration example copied"));
    } catch {
      toast.error(t("Could not access the clipboard. Select and copy the integration example."));
    }
  };

  const setField = <K extends keyof OfferFormValues>(key: K, value: OfferFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = OfferWriteSchema.safeParse(values);
    if (!result.success) {
      toast.error(
        localizeError(new Error(result.error.issues[0]?.message), t("Failed to save offer")),
      );
      return;
    }
    await onSave(values);
  };

  const products = productsQuery.data?.products ?? [];
  const selectedProduct = products.find((product) => product.id === values.productId);
  const searchTerm = productSearch.trim().toLocaleLowerCase();
  const filteredProducts = searchTerm
    ? products.filter((product) =>
        `${product.name} ${product.sku ?? ""}`.toLocaleLowerCase().includes(searchTerm),
      )
    : products;
  const pickerProducts =
    selectedProduct && !filteredProducts.some((product) => product.id === selectedProduct.id)
      ? [selectedProduct, ...filteredProducts]
      : filteredProducts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{offer ? t("Edit offer") : t("Create offer")}</DialogTitle>
          <DialogDescription>{t("Offer details")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="offer-product-search">{t("Product")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="offer-product-search"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder={t("Search products by name or SKU…")}
                className="pl-9"
              />
            </div>
            <Select
              value={values.productId || undefined}
              onValueChange={(productId) => {
                setField("productId", productId);
                const product = products.find((item) => item.id === productId);
                if (product) setField("priceUah", formatMinorUnitsInput(product.sale_price_minor));
              }}
            >
              <SelectTrigger aria-label={t("Choose a product")}>
                <SelectValue placeholder={t("Choose a product")} />
              </SelectTrigger>
              <SelectContent>
                {pickerProducts.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name}
                    {product.sku ? ` · ${product.sku}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {productsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">{t("Loading products…")}</p>
            )}
            {productsQuery.isError && (
              <p className="text-xs text-destructive">
                {localizeError(productsQuery.error, t("Could not load products."), locale)}
              </p>
            )}
            {selectedProduct && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
                {selectedProduct.photo_url ? (
                  <img
                    src={selectedProduct.photo_url}
                    alt=""
                    className="h-12 w-12 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-muted" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{selectedProduct.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("Sale price")}:{" "}
                    {new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", {
                      style: "currency",
                      currency: "UAH",
                    }).format(selectedProduct.sale_price_minor / 100)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="offer-name">{t("Offer name")}</Label>
              <Input
                id="offer-name"
                autoFocus
                required
                maxLength={120}
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-price">{t("Offer price")} (UAH)</Label>
              <Input
                id="offer-price"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={values.priceUah}
                onChange={(event) => setField("priceUah", event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer-landing-url">{t("Landing page URL (optional)")}</Label>
            <Input
              id="offer-landing-url"
              type="url"
              maxLength={2048}
              value={values.landingUrl}
              onChange={(event) => setField("landingUrl", event.target.value)}
              placeholder="https://example.com"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <Label htmlFor="offer-active">{t("Active")}</Label>
            <Switch
              id="offer-active"
              checked={values.isActive}
              onCheckedChange={(checked) => setField("isActive", checked)}
            />
          </div>

          {offer && (
            <section
              className="space-y-3 rounded-xl border border-border p-4"
              aria-labelledby="landing-connection-title"
            >
              <div>
                <h3 id="landing-connection-title" className="text-sm font-semibold">
                  {t("Landing page connection")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("Allow one exact origin to submit leads for this offer.")}
                </p>
              </div>
              {landingFormQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">{t("Loading connection…")}</p>
              ) : landingFormQuery.isError ? (
                <p className="text-xs text-destructive">
                  {localizeError(
                    landingFormQuery.error,
                    t("Could not load landing connection."),
                    locale,
                  )}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="landing-origin">{t("Allowed website origin")}</Label>
                    <Input
                      id="landing-origin"
                      type="url"
                      maxLength={255}
                      placeholder="https://shop.example.com"
                      value={allowedOrigin}
                      onChange={(event) => setAllowedOrigin(event.target.value)}
                      disabled={formBusy || Boolean(landingFormQuery.data?.isActive)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "Use the exact website origin, without a page path. HTTPS is required except on localhost.",
                      )}
                    </p>
                  </div>
                  {landingFormQuery.data?.isActive ? (
                    <>
                      <div className="rounded-lg bg-muted/40 p-3 text-xs">
                        <div className="font-medium">{t("Public form ID")}</div>
                        <code className="mt-1 block break-all text-muted-foreground">
                          {landingFormQuery.data.publicId}
                        </code>
                        <div className="mt-2 text-muted-foreground">
                          {t("Allowed origin")}: {landingFormQuery.data.allowedOrigin}
                        </div>
                      </div>
                      <Textarea
                        aria-label={t("Integration example")}
                        readOnly
                        rows={8}
                        className="font-mono text-xs"
                        value={buildLandingSnippet(
                          landingFormQuery.data.publicId,
                          typeof window === "undefined"
                            ? "/api/v1/intake/leads"
                            : `${window.location.origin}/api/v1/intake/leads`,
                          locale,
                        )}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void copyLandingSnippet()}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          {t("Copy integration")}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={formBusy}
                          onClick={() => setConfirmDeactivate(true)}
                        >
                          <X className="mr-2 h-4 w-4" />
                          {t("Deactivate connection")}
                        </Button>
                      </div>
                      {confirmDeactivate && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                          <p className="text-xs">{t("Stop accepting leads from this form?")}</p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDeactivate(false)}
                            >
                              {t("Keep active")}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={formBusy}
                              onClick={() => void deactivateLandingForm()}
                            >
                              {t("Deactivate")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      {landingFormQuery.data && (
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "This connection is inactive. Reactivating creates a new form ID; update the landing page code.",
                          )}
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={formBusy || !allowedOrigin.trim()}
                        onClick={() => void createLandingForm()}
                      >
                        {formBusy ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        {landingFormQuery.data
                          ? t("Reactivate connection")
                          : t("Connect landing page")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={saving || productsQuery.isLoading || !values.productId}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {offer ? t("Save changes") : t("Create offer")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
