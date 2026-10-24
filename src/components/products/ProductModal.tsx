import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Product, ProductWriteRequest } from "@/lib/products/types";
import { formatMinorUnitsInput } from "@/lib/products/money";
import { centimetersToMillimeters, millimetersToCentimetersInput } from "@/lib/shipping/dimensions";
import { localizeError, t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { CreateProductSchema } from "@/lib/products/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ProductFormValues = Omit<
  ProductWriteRequest,
  "costPrice" | "lengthMm" | "widthMm" | "heightMm"
> & {
  costPrice: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

const emptyValues: ProductFormValues = {
  name: "",
  sku: "",
  salePrice: "",
  costPrice: "",
  photoUrl: "",
  weightGrams: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  supplierName: "",
  isActive: true,
};

export function ProductModal({
  open,
  product,
  canReadCost,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  product: Product | null;
  canReadCost: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: ProductWriteRequest) => Promise<void>;
}) {
  const { locale } = useLocale();
  const [values, setValues] = useState<ProductFormValues>(emptyValues);

  useEffect(() => {
    if (!open) return;
    setValues({
      name: product?.name ?? "",
      sku: product?.sku ?? "",
      salePrice: formatMinorUnitsInput(product?.sale_price_minor),
      costPrice: formatMinorUnitsInput(product?.cost_price_minor),
      photoUrl: product?.photo_url ?? "",
      weightGrams: product?.weight_grams == null ? "" : String(product.weight_grams),
      lengthCm: millimetersToCentimetersInput(product?.length_mm),
      widthCm: millimetersToCentimetersInput(product?.width_mm),
      heightCm: millimetersToCentimetersInput(product?.height_mm),
      supplierName: product?.supplier_name ?? "",
      isActive: product?.is_active ?? true,
    });
  }, [open, product]);

  const setField = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let lengthMm: number | null;
    let widthMm: number | null;
    let heightMm: number | null;
    try {
      lengthMm = centimetersToMillimeters(values.lengthCm);
      widthMm = centimetersToMillimeters(values.widthCm);
      heightMm = centimetersToMillimeters(values.heightCm);
    } catch (error) {
      toast.error(localizeError(error, t("Failed to save product"), locale));
      return;
    }
    const request: ProductWriteRequest = {
      name: values.name,
      sku: values.sku,
      salePrice: values.salePrice,
      photoUrl: values.photoUrl,
      weightGrams: values.weightGrams,
      lengthMm: lengthMm === null ? "" : String(lengthMm),
      widthMm: widthMm === null ? "" : String(widthMm),
      heightMm: heightMm === null ? "" : String(heightMm),
      supplierName: values.supplierName,
      isActive: values.isActive,
      ...(canReadCost ? { costPrice: values.costPrice } : {}),
    };
    const validation = CreateProductSchema.safeParse(request);
    if (!validation.success) {
      toast.error(
        localizeError(new Error(validation.error.issues[0]?.message), t("Failed to save product")),
      );
      return;
    }
    await onSave(request);
  };

  const editing = product !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("Edit product") : t("Add product")}</DialogTitle>
          <DialogDescription>{t("Product catalog")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="w-full min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("Product name")} required>
              <Input
                autoFocus
                required
                maxLength={200}
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
              />
            </Field>
            <Field label={t("SKU / product code")}>
              <Input
                maxLength={100}
                value={values.sku}
                onChange={(event) => setField("sku", event.target.value)}
              />
            </Field>
            <Field label={`${t("Sale price")} (UAH)`} required>
              <Input
                required
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={values.salePrice}
                onChange={(event) => setField("salePrice", event.target.value)}
              />
            </Field>
            {canReadCost && (
              <Field label={`${t("Cost price")} (UAH)`}>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={values.costPrice}
                  onChange={(event) => setField("costPrice", event.target.value)}
                />
              </Field>
            )}
            <Field label={t("Image URL")}>
              <Input
                type="url"
                maxLength={2048}
                value={values.photoUrl}
                onChange={(event) => setField("photoUrl", event.target.value)}
              />
            </Field>
            <Field label={t("Weight (g)")}>
              <Input
                type="number"
                min={1}
                step={1}
                value={values.weightGrams}
                onChange={(event) => setField("weightGrams", event.target.value)}
              />
            </Field>
            <Field label={t("Length (cm)")}>
              <Input
                type="number"
                min={0.1}
                step={0.1}
                value={values.lengthCm}
                onChange={(event) => setField("lengthCm", event.target.value)}
              />
            </Field>
            <Field label={t("Width (cm)")}>
              <Input
                type="number"
                min={0.1}
                step={0.1}
                value={values.widthCm}
                onChange={(event) => setField("widthCm", event.target.value)}
              />
            </Field>
            <Field label={t("Height (cm)")}>
              <Input
                type="number"
                min={0.1}
                step={0.1}
                value={values.heightCm}
                onChange={(event) => setField("heightCm", event.target.value)}
              />
            </Field>
            <Field label={t("Supplier")}>
              <Input
                maxLength={200}
                value={values.supplierName}
                onChange={(event) => setField("supplierName", event.target.value)}
              />
            </Field>
            <div className="flex items-center gap-3 self-end pb-2">
              <Switch
                id="product-active"
                checked={values.isActive}
                onCheckedChange={(checked) => setField("isActive", checked)}
              />
              <Label htmlFor="product-active">
                {values.isActive ? t("Active") : t("Inactive")}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? t("Save changes") : t("Create product")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="block text-sm font-medium leading-none">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
