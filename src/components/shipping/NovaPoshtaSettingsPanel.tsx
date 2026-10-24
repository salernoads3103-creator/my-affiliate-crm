import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NovaPoshtaDirectoryPicker } from "@/components/shipping/NovaPoshtaDirectoryPicker";
import { localizeError, t } from "@/lib/i18n";
import type { NovaPoshtaSettings, NovaPoshtaSettingsInput } from "@/lib/shipping/types";
import { shippingService } from "@/services/shippingService";

type SettingsForm = Omit<NovaPoshtaSettingsInput, "apiKey"> & { apiKey: string };

const EMPTY_FORM: SettingsForm = {
  apiKey: "",
  senderName: "",
  senderPhone: "",
  senderEmail: "",
  senderCompanyName: "",
  senderCompanyTin: "",
  senderCounterpartyRef: "",
  senderCounterpartyName: "",
  senderContactRef: "",
  senderContactName: "",
  senderCityRef: "",
  senderCityName: "",
  senderBranchRef: "",
  senderBranchName: "",
};

function formFromSettings(settings: NovaPoshtaSettings): SettingsForm {
  return {
    ...EMPTY_FORM,
    senderName: settings.senderName,
    senderPhone: settings.senderPhone,
    senderEmail: settings.senderEmail,
    senderCompanyName: settings.senderCompanyName,
    senderCompanyTin: settings.senderCompanyTin,
    senderCounterpartyRef: settings.senderCounterpartyRef,
    senderCounterpartyName: settings.senderCounterpartyName,
    senderContactRef: settings.senderContactRef,
    senderContactName: settings.senderContactName,
    senderCityRef: settings.senderCityRef,
    senderCityName: settings.senderCityName,
    senderBranchRef: settings.senderBranchRef,
    senderBranchName: settings.senderBranchName,
  };
}

export function NovaPoshtaSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["nova-poshta-settings", workspaceId],
    queryFn: () => shippingService.getSettings(workspaceId),
  });

  useEffect(() => {
    if (settingsQuery.data) setForm(formFromSettings(settingsQuery.data));
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => shippingService.saveSettings(workspaceId, form),
    onSuccess: async (settings) => {
      setForm(formFromSettings(settings));
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["nova-poshta-settings", workspaceId] });
      toast.success(t("Delivery settings saved"));
    },
    onError: (cause) => {
      const message = localizeError(cause, t("Could not save delivery settings."), locale);
      setError(message);
      toast.error(message);
    },
  });

  const update = (patch: Partial<SettingsForm>) => setForm((current) => ({ ...current, ...patch }));
  const directoriesEnabled = settingsQuery.data?.apiKeyConfigured === true;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    saveMutation.mutate();
  };

  return (
    <section className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h2 className="font-semibold">{t("Nova Poshta settings")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Manage workspace delivery settings and create waybills for authorized orders")}
          </p>
        </div>
      </div>

      {settingsQuery.isLoading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("Loading delivery settings…")}
        </div>
      ) : settingsQuery.error ? (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-destructive">
            {localizeError(settingsQuery.error, t("Could not load Nova Poshta settings."), locale)}
          </p>
          <Button type="button" variant="outline" onClick={() => void settingsQuery.refetch()}>
            {t("Try again")}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nova-poshta-api-key">{t("Nova Poshta API key")}</Label>
              <Input
                id="nova-poshta-api-key"
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                onChange={(event) => update({ apiKey: event.target.value })}
                placeholder={directoriesEnabled ? t("Replace API key") : t("Nova Poshta API key")}
                disabled={saveMutation.isPending}
              />
              <p className="text-xs text-muted-foreground">
                {directoriesEnabled
                  ? t("API key is stored encrypted and never returned to the browser.")
                  : t("Save the Nova Poshta API key first.")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>{t("Sender profile")}</Label>
              <NovaPoshtaDirectoryPicker
                workspaceId={workspaceId}
                kind="senderProfiles"
                valueRef={form.senderCounterpartyRef}
                valueName={form.senderCounterpartyName}
                placeholder={t("Search sender profile…")}
                enabled={directoriesEnabled && !saveMutation.isPending}
                purpose="sender"
                onSelect={(option) =>
                  update({
                    senderCounterpartyRef: option.ref,
                    senderCounterpartyName: option.description,
                    senderContactRef: "",
                    senderContactName: "",
                    senderCityRef: "",
                    senderCityName: "",
                    senderBranchRef: "",
                    senderBranchName: "",
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Sender contact")}</Label>
              <NovaPoshtaDirectoryPicker
                workspaceId={workspaceId}
                kind="senderContacts"
                valueRef={form.senderContactRef}
                valueName={form.senderContactName}
                placeholder={t("Search contact person…")}
                enabled={directoriesEnabled && !saveMutation.isPending}
                purpose="sender"
                counterpartyRef={form.senderCounterpartyRef}
                onSelect={(option) =>
                  update({
                    senderContactRef: option.ref,
                    senderContactName: option.description,
                    senderName: option.description,
                    ...(option.phone ? { senderPhone: option.phone.replace(/\D/g, "") } : {}),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nova-poshta-sender-name">{t("Sender name for waybill")}</Label>
              <Input
                id="nova-poshta-sender-name"
                value={form.senderName}
                onChange={(event) => update({ senderName: event.target.value })}
                disabled={saveMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nova-poshta-sender-phone">{t("Sender phone")}</Label>
              <Input
                id="nova-poshta-sender-phone"
                type="tel"
                autoComplete="tel"
                value={form.senderPhone}
                onChange={(event) => update({ senderPhone: event.target.value })}
                placeholder="+380…"
                disabled={saveMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nova-poshta-sender-email">{t("Sender email")}</Label>
              <Input
                id="nova-poshta-sender-email"
                type="email"
                autoComplete="email"
                value={form.senderEmail}
                onChange={(event) => update({ senderEmail: event.target.value })}
                disabled={saveMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nova-poshta-company-name">{t("Company")}</Label>
              <Input
                id="nova-poshta-company-name"
                value={form.senderCompanyName}
                onChange={(event) => update({ senderCompanyName: event.target.value })}
                disabled={saveMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nova-poshta-company-tin">{t("Company tax ID")}</Label>
              <Input
                id="nova-poshta-company-tin"
                value={form.senderCompanyTin}
                onChange={(event) => update({ senderCompanyTin: event.target.value })}
                disabled={saveMutation.isPending}
              />
            </div>

            <DirectoryField label={t("Sender city")}>
              <NovaPoshtaDirectoryPicker
                workspaceId={workspaceId}
                kind="cities"
                valueRef={form.senderCityRef}
                valueName={form.senderCityName}
                placeholder={t("Search city…")}
                enabled={directoriesEnabled && !saveMutation.isPending}
                purpose="sender"
                onSelect={(option) =>
                  update({
                    senderCityRef: option.ref,
                    senderCityName: option.description,
                    senderBranchRef: "",
                    senderBranchName: "",
                  })
                }
              />
            </DirectoryField>
            <DirectoryField label={t("Sender branch")}>
              <NovaPoshtaDirectoryPicker
                workspaceId={workspaceId}
                kind="divisions"
                valueRef={form.senderBranchRef}
                valueName={form.senderBranchName}
                placeholder={t("Search branch or parcel locker…")}
                enabled={directoriesEnabled && !saveMutation.isPending}
                cityRef={form.senderCityRef}
                purpose="sender"
                counterpartyRef={form.senderCounterpartyRef}
                onSelect={(option) =>
                  update({
                    senderBranchRef: option.ref,
                    senderBranchName: option.description,
                    ...(option.cityRef ? { senderCityRef: option.cityRef } : {}),
                    ...(option.cityName ? { senderCityName: option.cityName } : {}),
                  })
                }
              />
            </DirectoryField>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t(
                "Cash-on-delivery waybills are blocked until the exact v2.0 financial-service contract is verified.",
              )}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-xs text-muted-foreground">
              {directoriesEnabled ? t("Connection saved") : t("Connection not configured")}
            </span>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Save delivery settings")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function DirectoryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
