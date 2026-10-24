import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { ORDER_KEYS } from "@/hooks/useOrdersApi";
import type { Order } from "@/lib/orders/types";
import { CreateOrderRequestSchema, UpdateOrderDraftRequestSchema } from "@/lib/orders/validation";
import { formatMinorUnitsInput } from "@/lib/products/money";
import { localizeError, t } from "@/lib/i18n";
import { orderService } from "@/services/orderService";

type FormValues = {
  quantity: string;
  unitPriceUah: string;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  operatorComment: string;
};

const blankValues: FormValues = {
  quantity: "1",
  unitPriceUah: "",
  buyerName: "",
  buyerPhone: "",
  buyerEmail: "",
  operatorComment: "",
};

export function OrderFormDialog({
  open,
  onOpenChange,
  workspaceId,
  leadId,
  order,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  leadId?: string;
  order?: Order | null;
  onSaved: (orderId: string) => void;
}) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(blankValues);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const idempotencyKey = useRef<{ leadId: string; key: string } | null>(null);
  const isEditing = Boolean(order);
  const contextQuery = useQuery({
    queryKey: ORDER_KEYS.context(workspaceId, leadId ?? ""),
    queryFn: () => orderService.getLeadContext(workspaceId, leadId!),
    enabled: open && !order && Boolean(workspaceId && leadId),
  });
  const context = contextQuery.data;
  const contextPrice = context?.offer_price_minor ?? context?.product_sale_price_minor ?? null;
  const canCreateFromLead = Boolean(context?.offer_id && context?.product_id && contextPrice);

  useEffect(() => {
    if (!open) return;
    submissionLock.current = false;
    setErrorMessage(null);
    if (order) {
      setValues({
        quantity: String(order.quantity),
        unitPriceUah: formatMinorUnitsInput(order.unit_price_minor),
        buyerName: order.buyer_name,
        buyerPhone: order.buyer_phone,
        buyerEmail: order.buyer_email ?? "",
        operatorComment: order.operator_comment ?? "",
      });
      return;
    }
    setValues(blankValues);
  }, [open, order]);

  useEffect(() => {
    if (!open || order || !context) return;
    setValues({
      quantity: "1",
      unitPriceUah: formatMinorUnitsInput(contextPrice),
      buyerName: context.lead_name,
      buyerPhone: context.buyer_phone ?? "",
      buyerEmail: context.buyer_email ?? "",
      operatorComment: "",
    });
  }, [open, order, context, contextPrice]);

  const change =
    (field: keyof FormValues) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((previous) => ({ ...previous, [field]: event.target.value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionLock.current || saving) return;
    submissionLock.current = true;
    setErrorMessage(null);
    setSaving(true);

    try {
      let orderId: string;
      if (order) {
        const parsed = UpdateOrderDraftRequestSchema.parse({
          ...values,
          quantity: Number(values.quantity),
        });
        const result = await orderService.updateDraft(workspaceId, order.id, parsed);
        orderId = result.id;
      } else {
        if (!leadId || !canCreateFromLead) {
          throw new Error("The lead needs an offer linked to a product with a price.");
        }
        if (!idempotencyKey.current || idempotencyKey.current.leadId !== leadId) {
          idempotencyKey.current = { leadId, key: crypto.randomUUID() };
        }
        const parsed = CreateOrderRequestSchema.parse({
          ...values,
          quantity: Number(values.quantity),
          leadId,
          idempotencyKey: idempotencyKey.current.key,
        });
        const result = await orderService.create(workspaceId, parsed);
        orderId = result.id;
        idempotencyKey.current = null;
      }

      await queryClient.invalidateQueries({ queryKey: ORDER_KEYS.all });
      toast.success(isEditing ? t("Draft order updated") : t("Order draft created"));
      onSaved(orderId);
      onOpenChange(false);
    } catch (error) {
      const fallback = isEditing
        ? t("Could not update the order.")
        : t("Could not create the order.");
      const message = localizeError(error, fallback, locale);
      setErrorMessage(message);
      toast.error(message);
    } finally {
      submissionLock.current = false;
      setSaving(false);
    }
  };

  const noOfferMessage =
    !contextQuery.isLoading && !contextQuery.isError && !canCreateFromLead
      ? t("Link an offer with a product and price to this lead before creating an order.")
      : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("Edit draft order") : t("Create order")}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("Update the order details while it is still a draft.")
              : t("Review the lead details and save a draft order.")}
          </DialogDescription>
        </DialogHeader>

        {!isEditing && contextQuery.isLoading ? (
          <div className="flex min-h-36 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !isEditing && contextQuery.isError ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {localizeError(contextQuery.error, t("Could not load order details."), locale)}
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            {!isEditing && context && (
              <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm">
                <p className="font-medium">{context.product_name ?? t("Product not linked")}</p>
                {context.offer_name && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{context.offer_name}</p>
                )}
              </div>
            )}

            {noOfferMessage && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                {noOfferMessage}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="order-quantity">{t("Quantity")}</Label>
                <Input
                  id="order-quantity"
                  type="number"
                  min="1"
                  max="9999"
                  step="1"
                  required
                  value={values.quantity}
                  onChange={change("quantity")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-price">{t("Unit price (UAH)")}</Label>
                <Input
                  id="order-price"
                  inputMode="decimal"
                  required
                  value={values.unitPriceUah}
                  onChange={change("unitPriceUah")}
                  placeholder="1190.00"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="order-buyer-name">{t("Customer name")}</Label>
              <Input
                id="order-buyer-name"
                autoComplete="name"
                maxLength={120}
                required
                value={values.buyerName}
                onChange={change("buyerName")}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="order-buyer-phone">{t("Phone")}</Label>
                <Input
                  id="order-buyer-phone"
                  type="tel"
                  autoComplete="tel"
                  maxLength={40}
                  required
                  value={values.buyerPhone}
                  onChange={change("buyerPhone")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-buyer-email">{t("Email (optional)")}</Label>
                <Input
                  id="order-buyer-email"
                  type="email"
                  autoComplete="email"
                  maxLength={255}
                  value={values.buyerEmail}
                  onChange={change("buyerEmail")}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-comment">{t("Operator comment (optional)")}</Label>
              <Textarea
                id="order-comment"
                maxLength={2000}
                rows={3}
                value={values.operatorComment}
                onChange={change("operatorComment")}
              />
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                {t("Cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  saving ||
                  (!isEditing &&
                    (contextQuery.isLoading || Boolean(contextQuery.isError) || !canCreateFromLead))
                }
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? t("Save changes") : t("Create draft")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
