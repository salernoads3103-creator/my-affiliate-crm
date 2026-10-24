import type { Dispatch, SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { shippingService } from "@/services/shippingService";
import { t } from "@/lib/i18n";
import type {
  CodService,
  DeliveryPaymentMethod,
  DeliveryPayer,
  DeliveryType,
} from "@/lib/shipping/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NovaPoshtaDirectoryPicker } from "./NovaPoshtaDirectoryPicker";
import type { DeliveryDraftForm } from "@/lib/shipping/delivery-form";

export function OrderDeliveryFields({
  workspaceId,
  value,
  setValue,
  disabled = false,
}: {
  workspaceId: string;
  value: DeliveryDraftForm;
  setValue: Dispatch<SetStateAction<DeliveryDraftForm>>;
  disabled?: boolean;
}) {
  const settingsQuery = useQuery({
    queryKey: ["nova-poshta-settings", workspaceId],
    queryFn: () => shippingService.getSettings(workspaceId),
    staleTime: 60_000,
  });
  const directoriesEnabled = settingsQuery.data?.apiKeyConfigured === true;

  const update = (patch: Partial<DeliveryDraftForm>) =>
    setValue((previous) => ({ ...previous, ...patch }));

  return (
    <section className="w-full min-w-0 space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div>
        <h3 className="text-sm font-semibold">{t("Delivery")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Name and phone will be taken from the order contact.")}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label>{t("Delivery type")}</Label>
        <Select
          value={value.deliveryType}
          onValueChange={(next) => update({ deliveryType: next as DeliveryType })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("Select a delivery type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="warehouse">{t("Warehouse delivery")}</SelectItem>
            <SelectItem value="postomat">{t("Postomat delivery")}</SelectItem>
          </SelectContent>
        </Select>
        {value.deliveryType === "address" && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t("Address delivery is not supported yet. Choose a branch or parcel locker.")}
          </p>
        )}
      </div>
      {!directoriesEnabled && (
        <p className="text-xs text-muted-foreground">
          {t("Save the API key before searching Nova Poshta directories.")}
        </p>
      )}
      <div className="space-y-1.5">
        <Label>{t("Recipient city")}</Label>
        <NovaPoshtaDirectoryPicker
          workspaceId={workspaceId}
          kind="cities"
          valueRef={value.cityRef}
          valueName={value.cityName}
          placeholder={t("Search city…")}
          enabled={directoriesEnabled && !disabled}
          onSelect={(option) =>
            update({
              cityRef: option.ref,
              cityName: option.description,
              branchRef: "",
              branchName: "",
            })
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label>{t("Recipient branch or parcel locker")}</Label>
        <NovaPoshtaDirectoryPicker
          workspaceId={workspaceId}
          kind="divisions"
          valueRef={value.branchRef}
          valueName={value.branchName}
          placeholder={t("Search branch or parcel locker…")}
          enabled={directoriesEnabled && !disabled}
          cityRef={value.cityRef}
          purpose="recipient"
          onSelect={(option) => update({ branchRef: option.ref, branchName: option.description })}
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="delivery-weight">{t("Weight (grams)")}</Label>
          <Input
            id="delivery-weight"
            inputMode="numeric"
            type="number"
            min="1"
            max="30000"
            value={value.weightGrams}
            onChange={(event) => update({ weightGrams: event.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery-value">{t("Declared value (UAH)")}</Label>
          <Input
            id="delivery-value"
            inputMode="decimal"
            placeholder="1190.00"
            value={value.declaredValueUah}
            onChange={(event) => update({ declaredValueUah: event.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
        <DimensionInput
          id="delivery-length"
          label={t("Length (cm)")}
          value={value.lengthCm}
          onChange={(next) => update({ lengthCm: next })}
          disabled={disabled}
        />
        <DimensionInput
          id="delivery-width"
          label={t("Width (cm)")}
          value={value.widthCm}
          onChange={(next) => update({ widthCm: next })}
          disabled={disabled}
        />
        <DimensionInput
          id="delivery-height"
          label={t("Height (cm)")}
          value={value.heightCm}
          onChange={(next) => update({ heightCm: next })}
          disabled={disabled}
        />
      </div>
      <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
        <div className="min-w-0 space-y-1.5">
          <Label>{t("Delivery payer")}</Label>
          <Select
            value={value.payer}
            onValueChange={(next) => update({ payer: next as DeliveryPayer })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Delivery payer")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Sender">{t("Sender pays")}</SelectItem>
              <SelectItem value="Recipient">{t("Recipient pays")}</SelectItem>
              <SelectItem value="ThirdPerson">{t("Third party pays")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label>{t("Delivery payment")}</Label>
          <Select
            value={value.paymentMethod}
            onValueChange={(next) => update({ paymentMethod: next as DeliveryPaymentMethod })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Delivery payment")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Cash">{t("Cash")}</SelectItem>
              <SelectItem value="NonCash">{t("Non-cash")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="delivery-cod">{t("Cash on delivery (UAH)")}</Label>
        <Input
          id="delivery-cod"
          inputMode="decimal"
          placeholder=""
          value={value.codAmountUah}
          onChange={(event) => update({ codAmountUah: event.target.value })}
          disabled={disabled}
        />
      </div>
      {value.codAmountUah.trim() && (
        <div className="space-y-1.5">
          <Label>{t("Cash on delivery method")}</Label>
          <Select
            value={value.codService}
            onValueChange={(next) => update({ codService: next as CodService })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Choose a payment service")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="novapay">{t("NovaPay post-payment")}</SelectItem>
              <SelectItem value="payment_control">{t("Payment Control")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {value.codService === "novapay"
              ? t("NovaPay post-payment is blocked until its v2.0 API contract is verified.")
              : value.codService === "payment_control"
                ? t(
                    "Payment Control is a separate service; its v2.0 API mapping is not verified and remains blocked.",
                  )
                : t("Choose the service used for this cash-on-delivery amount.")}
          </p>
        </div>
      )}
    </section>
  );
}

function DimensionInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="w-full min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        type="number"
        min="0.1"
        step="0.1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </div>
  );
}
