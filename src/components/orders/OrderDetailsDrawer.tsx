import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, RefreshCw, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Order } from "@/lib/orders/types";
import { canTransitionOrderStatus } from "@/lib/orders/status";
import { formatMinorUnits } from "@/lib/products/money";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import type { NovaPoshtaSettings, OrderDelivery, OrderDeliveryInput } from "@/lib/shipping/types";
import { getWaybillMissingFields } from "@/lib/shipping/validation";
import { millimetersToCentimetersInput } from "@/lib/shipping/dimensions";
import { localizeError } from "@/lib/i18n";
import { shippingService } from "@/services/shippingService";
import { OrderDeliveryDialog } from "@/components/shipping/OrderDeliveryDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type OrderDetailsDrawerProps = {
  order: Order | null;
  canManage: boolean;
  canManageShipping: boolean;
  workspaceId: string;
  transitioning: boolean;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onTransition: (status: "confirmed" | "cancelled") => void;
};

export function OrderDetailsDrawer({
  order,
  canManage,
  canManageShipping,
  workspaceId,
  transitioning,
  onClose,
  onEdit,
  onTransition,
}: OrderDetailsDrawerProps) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [waybillReviewOpen, setWaybillReviewOpen] = useState(false);
  const deliveryQuery = useQuery({
    queryKey: ["order-delivery", workspaceId, order?.id],
    queryFn: () => shippingService.getDelivery(workspaceId, order!.id),
    enabled: Boolean(order?.id && workspaceId),
  });
  const settingsQuery = useQuery({
    queryKey: ["nova-poshta-settings", workspaceId],
    queryFn: () => shippingService.getSettings(workspaceId),
    enabled: Boolean(order?.id && canManageShipping && workspaceId),
  });
  const waybillMutation = useMutation({
    mutationFn: () => {
      if (!order) throw new Error("Order is unavailable");
      return shippingService.createWaybill(workspaceId, order.id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["order-delivery", workspaceId, order?.id] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      setWaybillReviewOpen(false);
      toast.success(t("Waybill created"));
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: ["order-delivery", workspaceId, order?.id] });
      toast.error(localizeError(error, t("Could not create the waybill."), locale));
    },
  });
  const canConfirm = order ? canTransitionOrderStatus(order.status, "confirmed") : false;
  const canCancel = order ? canTransitionOrderStatus(order.status, "cancelled") : false;
  const delivery = deliveryQuery.data ?? null;
  const missingWaybillFields = getWaybillMissingFields(
    delivery ? deliveryToInput(delivery) : EMPTY_DELIVERY_INPUT,
    { name: order?.buyer_name ?? "", phone: order?.buyer_phone ?? "" },
    settingsQuery.data ?? null,
  );

  return (
    <>
      <Sheet open={order !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          {order && (
            <>
              <div className="border-b border-border px-6 pb-5 pt-8 pr-12">
                <SheetHeader className="space-y-3 text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SheetTitle className="truncate text-lg">{order.buyer_name}</SheetTitle>
                      <SheetDescription className="mt-1">
                        {t("Created")}: {formatCreatedAt(order.created_at, locale)}
                      </SheetDescription>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>
                </SheetHeader>
              </div>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                <DetailsSection
                  title={t("Order")}
                  rows={[
                    { label: t("Product"), value: order.product_name_snapshot },
                    { label: t("Offer"), value: order.offer_name_snapshot },
                    { label: t("Quantity"), value: String(order.quantity) },
                    {
                      label: t("Unit price"),
                      value: formatMinorUnits(order.unit_price_minor, locale),
                    },
                    {
                      label: t("Total"),
                      value: formatMinorUnits(order.total_amount_minor, locale),
                    },
                    { label: t("Linked lead"), value: order.lead_id.slice(0, 8) },
                  ]}
                />
                <DetailsSection
                  title={t("Contact details")}
                  rows={[
                    { label: t("Name"), value: order.buyer_name },
                    { label: t("Phone"), value: order.buyer_phone },
                    { label: t("Email"), value: order.buyer_email },
                  ]}
                />
                <DetailsSection
                  title={t("Operator comment")}
                  rows={[{ label: t("Comment"), value: order.operator_comment }]}
                />
                <section aria-label={t("Delivery")} className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("Delivery")}
                    </h3>
                    {canManageShipping &&
                      order.status !== "cancelled" &&
                      delivery?.operation_status !== "created" &&
                      delivery?.operation_status !== "unknown" &&
                      delivery?.operation_status !== "creating" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeliveryDialogOpen(true)}
                        >
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          {t("Edit delivery")}
                        </Button>
                      )}
                  </div>
                  {delivery ? (
                    <DetailsSection
                      title=""
                      rows={[
                        {
                          label: t("Delivery type"),
                          value: deliveryTypeLabel(delivery.delivery_type),
                        },
                        { label: t("City"), value: delivery.recipient_city_name },
                        { label: t("Branch"), value: delivery.recipient_branch_name },
                        {
                          label: t("Weight (grams)"),
                          value:
                            delivery.weight_grams == null ? null : String(delivery.weight_grams),
                        },
                        { label: t("Parcel dimensions (cm)"), value: dimensionsLabel(delivery) },
                        {
                          label: t("Declared value (UAH)"),
                          value:
                            delivery.declared_value_minor == null
                              ? null
                              : formatMinorUnits(delivery.declared_value_minor, locale),
                        },
                        { label: t("Delivery payer"), value: payerLabel(delivery.delivery_payer) },
                        {
                          label: t("Delivery payment"),
                          value: paymentLabel(delivery.delivery_payment_method),
                        },
                        {
                          label: t("Cash on delivery (UAH)"),
                          value:
                            delivery.cod_amount_minor == null
                              ? null
                              : formatMinorUnits(delivery.cod_amount_minor, locale),
                        },
                        {
                          label: t("Waybill status"),
                          value: waybillStatusLabel(delivery.operation_status),
                        },
                        { label: t("Waybill number"), value: delivery.tracking_number },
                        { label: t("Waybill reference"), value: delivery.shipment_ref },
                        {
                          label: t("Waybill created"),
                          value: delivery.waybill_created_at
                            ? formatCreatedAt(delivery.waybill_created_at, locale)
                            : null,
                        },
                      ]}
                    />
                  ) : deliveryQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("Loading delivery details…")}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("Delivery details have not been entered.")}
                    </p>
                  )}
                  {delivery?.operation_status === "unknown" ||
                  delivery?.operation_status === "creating" ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">
                        {t(
                          delivery.operation_status === "unknown"
                            ? "Result unknown"
                            : "Waybill request is being processed",
                        )}
                      </p>
                      <p className="mt-1">
                        {t(
                          "The carrier result is unconfirmed. Check your Nova Poshta account before retrying; CRMONIA will not create another waybill automatically.",
                        )}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => void deliveryQuery.refetch()}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        {t("Refresh CRM state")}
                      </Button>
                      <p className="mt-2 text-xs">
                        {t("This reloads the saved attempt state; it does not search Nova Poshta.")}
                      </p>
                    </div>
                  ) : null}
                  {canManageShipping &&
                    order.status === "confirmed" &&
                    delivery?.operation_status !== "created" &&
                    delivery?.operation_status !== "unknown" &&
                    delivery?.operation_status !== "creating" && (
                      <Button
                        type="button"
                        className="w-full"
                        disabled={!delivery || waybillMutation.isPending}
                        onClick={() => setWaybillReviewOpen(true)}
                      >
                        <Truck className="mr-2 h-4 w-4" />
                        {t("Create waybill")}
                      </Button>
                    )}
                  {canManageShipping &&
                    order.status !== "confirmed" &&
                    order.status !== "cancelled" && (
                      <p className="text-xs text-muted-foreground">
                        {t("Create a waybill only after confirming the order.")}
                      </p>
                    )}
                </section>
                {order.confirmed_at && (
                  <DetailsSection
                    title={t("Confirmed")}
                    rows={[
                      { label: t("Date"), value: formatCreatedAt(order.confirmed_at, locale) },
                    ]}
                  />
                )}
                {order.cancelled_at && (
                  <DetailsSection
                    title={t("Cancelled")}
                    rows={[
                      { label: t("Date"), value: formatCreatedAt(order.cancelled_at, locale) },
                    ]}
                  />
                )}
              </div>

              {canManage && (canConfirm || canCancel) && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-border px-6 py-4">
                  {canConfirm && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={transitioning}
                        onClick={() => onEdit(order)}
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        {t("Edit draft")}
                      </Button>
                      <Button
                        type="button"
                        disabled={transitioning}
                        onClick={() => onTransition("confirmed")}
                      >
                        <Check className="mr-2 h-4 w-4" />
                        {t("Confirm order")}
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={transitioning}
                    onClick={() => setConfirmCancelOpen(true)}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {t("Cancel order")}
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {order && (
        <OrderDeliveryDialog
          open={deliveryDialogOpen}
          onOpenChange={setDeliveryDialogOpen}
          workspaceId={workspaceId}
          orderId={order.id}
          order={order}
          delivery={delivery}
          deliveryLoading={deliveryQuery.isPending || deliveryQuery.isFetching}
          deliveryError={deliveryQuery.isError}
          onSaved={() => void deliveryQuery.refetch()}
        />
      )}

      <Dialog
        open={waybillReviewOpen}
        onOpenChange={(open) => !waybillMutation.isPending && setWaybillReviewOpen(open)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Review shipment details")}</DialogTitle>
            <DialogDescription>
              {t("The waybill will be created in Nova Poshta after you confirm.")}
            </DialogDescription>
          </DialogHeader>
          {order && delivery && (
            <WaybillReview
              order={order}
              delivery={delivery}
              settings={settingsQuery.data ?? null}
              locale={locale}
            />
          )}
          {missingWaybillFields.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-sm font-medium">{t("Required fields")}</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {missingWaybillFields.map((field) => (
                  <li key={field}>{missingFieldLabel(field)}</li>
                ))}
              </ul>
              {canManageShipping && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setWaybillReviewOpen(false);
                    setDeliveryDialogOpen(true);
                  }}
                >
                  {t("Edit delivery")}
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={waybillMutation.isPending}
              onClick={() => setWaybillReviewOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={
                missingWaybillFields.length > 0 ||
                waybillMutation.isPending ||
                order?.status !== "confirmed"
              }
              onClick={() => waybillMutation.mutate()}
            >
              {waybillMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Confirm and create waybill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Cancel this order?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("The order will remain in the CRM with the cancelled status.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep order")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onTransition("cancelled");
                setConfirmCancelOpen(false);
              }}
            >
              {t("Cancel order")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OrderStatusBadge({ status }: { status: Order["status"] }) {
  const className =
    status === "confirmed"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "cancelled"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={className}>
      {t(status)}
    </Badge>
  );
}

function DetailsSection({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: string | null | undefined }[];
}) {
  const visibleRows = rows.filter(
    (row): row is { label: string; value: string } =>
      typeof row.value === "string" && row.value.trim().length > 0,
  );
  if (visibleRows.length === 0) return null;

  return (
    <section aria-label={title}>
      {title && (
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      )}
      <dl className="space-y-3">
        {visibleRows.map(({ label, value }) => (
          <div key={label} className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="break-words text-right text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const EMPTY_DELIVERY_INPUT: OrderDeliveryInput = {
  deliveryType: null,
  cityRef: null,
  cityName: null,
  branchRef: null,
  branchName: null,
  weightGrams: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  declaredValueMinor: null,
  payer: null,
  paymentMethod: null,
  codAmountMinor: null,
  codService: null,
};

function deliveryToInput(value: OrderDelivery): OrderDeliveryInput {
  return {
    deliveryType: value.delivery_type,
    cityRef: value.recipient_city_ref,
    cityName: value.recipient_city_name,
    branchRef: value.recipient_branch_ref,
    branchName: value.recipient_branch_name,
    weightGrams: value.weight_grams,
    lengthMm: value.length_mm,
    widthMm: value.width_mm,
    heightMm: value.height_mm,
    declaredValueMinor: value.declared_value_minor,
    payer: value.delivery_payer,
    paymentMethod: value.delivery_payment_method,
    codAmountMinor: value.cod_amount_minor,
    codService: value.cod_service,
  };
}

function deliveryTypeLabel(value: OrderDelivery["delivery_type"]): string | null {
  if (value === "warehouse") return t("Warehouse delivery");
  if (value === "postomat") return t("Postomat delivery");
  if (value === "address") return t("Address delivery");
  return null;
}

function payerLabel(value: OrderDelivery["delivery_payer"]): string | null {
  if (value === "Sender") return t("Sender pays");
  if (value === "Recipient") return t("Recipient pays");
  if (value === "ThirdPerson") return t("Third party pays");
  return null;
}

function paymentLabel(value: OrderDelivery["delivery_payment_method"]): string | null {
  if (value === "Cash") return t("Cash");
  if (value === "NonCash") return t("Non-cash");
  return null;
}

function waybillStatusLabel(value: OrderDelivery["operation_status"]): string {
  if (value === "created") return t("Waybill created");
  if (value === "creating") return t("Waybill request is being processed");
  if (value === "unknown") return t("Result unknown");
  if (value === "failed") return t("Waybill creation failed. Review the details and try again.");
  return t("Not created");
}

function missingFieldLabel(field: string): string {
  const labels = {
    apiKey: "API key",
    senderProfile: "Sender profile",
    senderContact: "Sender contact",
    senderName: "Sender contact name is required",
    senderCity: "Sender city is required",
    senderBranch: "Sender branch is required",
    senderPhone: "Sender phone is required",
    recipientName: "Customer name",
    recipientPhone: "Phone",
    deliveryType: "Select a delivery type",
    unsupportedDeliveryType: "Address delivery is not supported yet",
    city: "Recipient city",
    branch: "Recipient branch or parcel locker",
    weightGrams: "Weight is required",
    lengthMm: "Length is required",
    widthMm: "Width is required",
    heightMm: "Height is required",
    declaredValueMinor: "Declared value is required",
    payer: "Delivery payer",
    paymentMethod: "Delivery payment",
    codAmountMinor: "Cash on delivery must use whole UAH amounts",
    thirdPartyPayerNotSupported: "Third-party delivery payer is not supported yet",
    novaPayPostPaymentUnverified:
      "NovaPay post-payment is blocked until its v2.0 API contract is verified",
    paymentControlUnverified: "Payment Control is blocked until its v2.0 API contract is verified",
  } as const;
  return t(labels[field as keyof typeof labels] ?? "Required");
}

function WaybillReview({
  order,
  delivery,
  settings,
  locale,
}: {
  order: Order;
  delivery: OrderDelivery;
  settings: NovaPoshtaSettings | null;
  locale: "uk" | "en";
}) {
  return (
    <div className="space-y-5">
      {settings && (
        <DetailsSection
          title={t("Sender")}
          rows={[
            { label: t("Sender contact"), value: settings.senderName },
            { label: t("City"), value: settings.senderCityName },
            { label: t("Branch"), value: settings.senderBranchName },
            { label: t("Phone"), value: settings.senderPhone },
            { label: t("Email"), value: settings.senderEmail },
            { label: t("Company"), value: settings.senderCompanyName },
          ]}
        />
      )}
      <DetailsSection
        title={t("Recipient")}
        rows={[
          { label: t("Name"), value: order.buyer_name },
          { label: t("Phone"), value: order.buyer_phone },
          { label: t("Email"), value: order.buyer_email },
          { label: t("City"), value: delivery.recipient_city_name },
          { label: t("Branch"), value: delivery.recipient_branch_name },
        ]}
      />
      <DetailsSection
        title={t("Shipment")}
        rows={[
          { label: t("Product"), value: order.product_name_snapshot },
          { label: t("Delivery type"), value: deliveryTypeLabel(delivery.delivery_type) },
          {
            label: t("Weight (grams)"),
            value: delivery.weight_grams == null ? null : String(delivery.weight_grams),
          },
          { label: t("Parcel dimensions (cm)"), value: dimensionsLabel(delivery) },
          {
            label: t("Declared value (UAH)"),
            value:
              delivery.declared_value_minor == null
                ? null
                : formatMinorUnits(delivery.declared_value_minor, locale),
          },
          { label: t("Delivery payer"), value: payerLabel(delivery.delivery_payer) },
          { label: t("Delivery payment"), value: paymentLabel(delivery.delivery_payment_method) },
          {
            label: t("Cash on delivery (UAH)"),
            value:
              delivery.cod_amount_minor == null
                ? null
                : formatMinorUnits(delivery.cod_amount_minor, locale),
          },
          {
            label: t("Cash on delivery method"),
            value:
              delivery.cod_service === "novapay"
                ? t("NovaPay post-payment")
                : delivery.cod_service === "payment_control"
                  ? t("Payment Control")
                  : null,
          },
        ]}
      />
    </div>
  );
}

function formatCreatedAt(value: string, locale: "uk" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dimensionsLabel(delivery: OrderDelivery): string | null {
  if (delivery.length_mm == null || delivery.width_mm == null || delivery.height_mm == null)
    return null;
  return `${millimetersToCentimetersInput(delivery.length_mm)} × ${millimetersToCentimetersInput(delivery.width_mm)} × ${millimetersToCentimetersInput(delivery.height_mm)}`;
}
