import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
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

type OfferFormValues = OfferWriteRequest;

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
  const [values, setValues] = useState<OfferFormValues>(emptyValues);
  const [productSearch, setProductSearch] = useState("");
  const productsQuery = useQuery({
    queryKey: ["products", workspaceId, "offer-picker"],
    queryFn: () => productService.list(workspaceId, ""),
    enabled: open && Boolean(workspaceId),
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
  }, [open, offer]);

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
