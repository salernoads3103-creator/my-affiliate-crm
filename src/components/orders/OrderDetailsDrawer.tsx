import { useState } from "react";
import { Check, Pencil, XCircle } from "lucide-react";
import type { Order } from "@/lib/orders/types";
import { canTransitionOrderStatus } from "@/lib/orders/status";
import { formatMinorUnits } from "@/lib/products/money";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  transitioning: boolean;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onTransition: (status: "confirmed" | "cancelled") => void;
};

export function OrderDetailsDrawer({
  order,
  canManage,
  transitioning,
  onClose,
  onEdit,
  onTransition,
}: OrderDetailsDrawerProps) {
  const { locale } = useLocale();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const canConfirm = order ? canTransitionOrderStatus(order.status, "confirmed") : false;
  const canCancel = order ? canTransitionOrderStatus(order.status, "cancelled") : false;

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
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
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

function formatCreatedAt(value: string, locale: "uk" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
