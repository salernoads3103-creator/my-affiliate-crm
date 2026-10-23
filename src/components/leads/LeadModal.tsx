import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2 } from "lucide-react";
import type { Lead, LeadInput, LeadStatus } from "@/lib/leads/types";
import { LEAD_STATUSES } from "@/lib/leads/types";
import { useCreateLead, useUpdateLead } from "@/hooks/useLeadsApi";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import { normalizeUkrainianPhone } from "@/lib/leads/phone";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { OfferCatalogResponse } from "@/lib/offers/types";
import { accessApi } from "@/services/accessApi";

export function LeadModal({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
}) {
  useLocale();
  const create = useCreateLead();
  const update = useUpdateLead();
  const { workspace, permissions } = useWorkspaceAccess();
  const canAssignOffer = permissions["leads.assign_offer"] === true
    && permissions["offers.read"] === true
    && permissions["products.read"] === true;
  const offersQuery = useQuery({
    queryKey: ["workspace-offers-catalog", workspace?.id, "lead-picker"],
    queryFn: () => accessApi.get<OfferCatalogResponse>(`/api/workspaces/${workspace!.id}/offers/catalog`),
    enabled: Boolean(open && workspace?.id && canAssignOffer),
  });
  const editing = !!lead;
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<LeadInput>({
    defaultValues: { lead_status: "New" },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: lead?.name ?? "",
        email: lead?.email ?? "",
        phone: lead?.phone ?? "",
        offer_id: lead?.offer_id ?? null,
        company_name: lead?.company_name ?? "",
        lead_status: (lead?.lead_status ?? "New") as LeadStatus,
        notes: lead?.notes ?? "",
      });
    }
  }, [open, lead, reset]);

  const notesLen = (watch("notes") ?? "").length;

  const onSubmit = async (values: LeadInput) => {
    const input: LeadInput = canAssignOffer
      ? { ...values, offer_id: values.offer_id || null }
      : omitOffer(values);
    if (editing && lead) {
      await update.mutateAsync({ id: lead.id, input });
    } else {
      await create.mutateAsync(input);
    }
    onClose();
  };

  const submitting = create.isPending || update.isPending;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }}
            className="fixed left-1/2 top-[10%] z-50 w-[94%] max-w-lg -translate-x-1/2"
          >
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="glass-strong rounded-3xl p-6 sm:p-8 border border-border"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    {editing ? t("Edit lead") : t("Add new lead")}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {editing ? t("Update details for this lead.") : t("Capture a fresh opportunity.")}
                  </p>
                </div>
                <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-muted/60">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <Field label={t("Name")} error={errors.name?.message}>
                  <input
                    autoFocus
                    {...register("name", { required: t("Required"), maxLength: 120 })}
                    className="field"
                    placeholder={t("Jane Smith")}
                  />
                </Field>
                <Field label={t("Email (optional)")} error={errors.email?.message}>
                  <input
                    type="email"
                    {...register("email", {
                      pattern: { value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: t("Invalid") },
                    })}
                    className="field"
                    placeholder="name@example.com"
                  />
                </Field>
                <Field label={`${t("Phone")}${editing ? "" : " *"}`} error={errors.phone?.message}>
                  <input
                    {...register("phone", {
                      required: editing ? false : t("Required"),
                      maxLength: 40,
                      validate: (value) => !value || normalizeUkrainianPhone(value) !== null || t("Invalid phone"),
                    })}
                    className="field"
                    placeholder="+380 50 123 45 67"
                  />
                </Field>
                <Field label={t("Company")} error={errors.company_name?.message}>
                  <input
                    {...register("company_name", { maxLength: 120 })}
                    className="field"
                    placeholder={t("Company name")}
                  />
                </Field>
                <Field label={t("Status")} error={errors.lead_status?.message}>
                  <select {...register("lead_status", { required: true })} className="field">
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
                  </select>
                </Field>
                {canAssignOffer && (
                  <Field label={t("Offer")}>
                    <select
                      {...register("offer_id", { setValueAs: (value: string) => value || null })}
                      className="field"
                      disabled={offersQuery.isLoading}
                    >
                      <option value="">{t("No offer")}</option>
                      {(offersQuery.data?.offers ?? [])
                        .filter((offer) => offer.is_active || offer.id === lead?.offer_id)
                        .map((offer) => (
                          <option key={offer.id} value={offer.id}>
                            {offer.name}{offer.product_name ? ` · ${offer.product_name}` : ""}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <div className="sm:col-span-2">
                  <Field label={`${t("Notes")} (${notesLen}/2000)`} error={errors.notes?.message}>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      {...register("notes", { maxLength: 2000 })}
                      className="field resize-none"
                      placeholder={t("Context, follow-ups, next steps…")}
                    />
                  </Field>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm hover:bg-muted/60 transition">
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl gradient-brand text-primary-foreground font-medium px-5 py-2 text-sm flex items-center gap-2 hover:opacity-95 active:scale-[0.99] transition disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing ? t("Save changes") : t("Create lead")}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function omitOffer(input: LeadInput): LeadInput {
  const { offer_id: _offerId, ...rest } = input;
  return rest;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
      <style>{`.field{width:100%;border-radius:0.75rem;background:color-mix(in oklab,var(--input) 60%,transparent);border:1px solid var(--border);padding:0.55rem 0.85rem;outline:none;transition:all .15s}.field:focus{box-shadow:0 0 0 4px var(--ring);border-color:transparent}`}</style>
    </label>
  );
}
