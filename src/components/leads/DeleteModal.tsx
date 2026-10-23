import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertTriangle } from "lucide-react";
import { useDeleteLead } from "@/hooks/useLeadsApi";
import type { Lead } from "@/lib/leads/types";
import { t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

export function DeleteModal({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  useLocale();
  const del = useDeleteLead();
  const onConfirm = async () => {
    if (!lead) return;
    await del.mutateAsync(lead.id);
    onClose();
  };
  return (
    <AnimatePresence>
      {lead && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className="fixed left-1/2 top-1/3 z-50 w-[92%] max-w-md -translate-x-1/2"
          >
            <div className="glass-strong rounded-2xl p-6 border border-border">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{t("Delete this lead?")}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("{name} will be permanently removed. This action cannot be undone.", { name: lead.name })}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm hover:bg-muted/60">{t("Cancel")}</button>
                <button
                  onClick={onConfirm}
                  disabled={del.isPending}
                  className="rounded-xl bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium flex items-center gap-2 hover:opacity-90 transition disabled:opacity-60"
                >
                  {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("Delete")}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
