import { useEffect, useRef, useState, type FormEvent } from "react";
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
import type { OrderDelivery } from "@/lib/shipping/types";
import type { Order } from "@/lib/orders/types";
import { localizeError, t } from "@/lib/i18n";
import { shippingService } from "@/services/shippingService";
import { OrderDeliveryFields } from "./OrderDeliveryFields";
import { deliveryFormFromRow, toOrderDeliveryInput } from "@/lib/shipping/delivery-form";

export function OrderDeliveryDialog({
  open,
  onOpenChange,
  workspaceId,
  orderId,
  order,
  delivery,
  deliveryLoading,
  deliveryError,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  orderId: string;
  order: Order;
  delivery: OrderDelivery | null | undefined;
  deliveryLoading: boolean;
  deliveryError: boolean;
  onSaved: () => void;
}) {
  const { locale } = useLocale();
  const [value, setValue] = useState(() => deliveryFormFromRow(delivery ?? null, order));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedOrderId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedOrderId.current = null;
      return;
    }
    if (deliveryLoading || deliveryError || initializedOrderId.current === orderId) return;
    initializedOrderId.current = orderId;
    setValue(deliveryFormFromRow(delivery ?? null, order));
    setError(null);
  }, [open, orderId, order, delivery, deliveryLoading, deliveryError]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await shippingService.saveDelivery(workspaceId, orderId, toOrderDeliveryInput(value));
      toast.success(t("Delivery details saved"));
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      const message = localizeError(cause, t("Could not save delivery details."), locale);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deliveryUnavailable =
    initializedOrderId.current !== orderId && (deliveryLoading || deliveryError);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}>
      <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Edit delivery")}</DialogTitle>
          <DialogDescription>
            {t("Choose a city and branch from the Nova Poshta directory.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="w-full min-w-0 space-y-4">
          {deliveryUnavailable && (
            <p className="text-sm text-muted-foreground">
              {deliveryError
                ? t("Could not load delivery details.")
                : t("Loading delivery details…")}
            </p>
          )}
          <OrderDeliveryFields
            workspaceId={workspaceId}
            value={value}
            setValue={setValue}
            disabled={saving || deliveryUnavailable}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              disabled={saving || deliveryUnavailable}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Save delivery")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
