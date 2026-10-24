import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Radio, ToggleLeft } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
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
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { localizeError, t } from "@/lib/i18n";
import type {
  TrackingPlatform,
  TrackingProfile,
  TrackingProfileWriteInput,
} from "@/lib/tracking-profiles/types";
import { trackingProfileService } from "@/services/trackingProfileService";

export const Route = createFileRoute("/_authenticated/pixels")({ component: PixelsPage });

const PROFILES_QUERY_KEY = ["tracking-profiles"] as const;

function platformLabel(platform: TrackingPlatform): string {
  return platform === "tiktok" ? "TikTok Ads" : "Google Ads";
}

function profileValue(profile: TrackingProfile): string {
  return profile.platform === "tiktok"
    ? (profile.tiktok_pixel_id ?? "")
    : `${profile.google_ads_conversion_id ?? ""} · ${profile.google_ads_conversion_label ?? ""}`;
}

function PixelsPage() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { workspace, permissions, isLoading: accessLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canRead =
    permissions["landing_pages.read"] === true || permissions["landing_pages.manage"] === true;
  const canManage = permissions["landing_pages.manage"] === true;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<TrackingProfile | null>(null);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<TrackingPlatform>("tiktok");
  const [tiktokPixelId, setTiktokPixelId] = useState("");
  const [googleAdsConversionId, setGoogleAdsConversionId] = useState("");
  const [googleAdsConversionLabel, setGoogleAdsConversionLabel] = useState("");
  const [isActive, setIsActive] = useState(true);

  const profilesQuery = useQuery({
    queryKey: [...PROFILES_QUERY_KEY, workspaceId],
    queryFn: () => trackingProfileService.list(workspaceId!),
    enabled: Boolean(workspaceId && canRead),
  });

  const saveMutation = useMutation({
    mutationFn: (input: TrackingProfileWriteInput) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return editingProfile
        ? trackingProfileService.update(workspaceId, editingProfile.id, input)
        : trackingProfileService.create(workspaceId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["landing-tracking-config"] });
      toast.success(editingProfile ? t("Tracking profile updated") : t("Tracking profile created"));
      setDialogOpen(false);
      setEditingProfile(null);
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not save tracking profile"), locale)),
  });

  const openCreate = () => {
    setEditingProfile(null);
    setName("");
    setPlatform("tiktok");
    setTiktokPixelId("");
    setGoogleAdsConversionId("");
    setGoogleAdsConversionLabel("");
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (profile: TrackingProfile) => {
    setEditingProfile(profile);
    setName(profile.name);
    setPlatform(profile.platform);
    setTiktokPixelId(profile.tiktok_pixel_id ?? "");
    setGoogleAdsConversionId(profile.google_ads_conversion_id ?? "");
    setGoogleAdsConversionLabel(profile.google_ads_conversion_label ?? "");
    setIsActive(profile.is_active);
    setDialogOpen(true);
  };

  const submit = () => {
    const common = { name: name.trim(), platform, isActive };
    saveMutation.mutate(
      platform === "tiktok"
        ? { ...common, platform, tiktokPixelId: tiktokPixelId.trim() }
        : {
            ...common,
            platform,
            googleAdsConversionId: googleAdsConversionId.trim(),
            googleAdsConversionLabel: googleAdsConversionLabel.trim(),
          },
    );
  };

  const toggleActive = (profile: TrackingProfile) => {
    if (!workspaceId) return;
    const input: TrackingProfileWriteInput =
      profile.platform === "tiktok"
        ? {
            name: profile.name,
            platform: "tiktok",
            tiktokPixelId: profile.tiktok_pixel_id ?? "",
            isActive: !profile.is_active,
          }
        : {
            name: profile.name,
            platform: "google_ads",
            googleAdsConversionId: profile.google_ads_conversion_id ?? "",
            googleAdsConversionLabel: profile.google_ads_conversion_label ?? "",
            isActive: !profile.is_active,
          };
    trackingProfileService
      .update(workspaceId, profile.id, input)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
        toast.success(
          profile.is_active ? t("Tracking profile disabled") : t("Tracking profile enabled"),
        );
      })
      .catch((error: unknown) =>
        toast.error(localizeError(error, t("Could not save tracking profile"), locale)),
      );
  };

  if (accessLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!workspaceId || !canRead) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Pixels")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view tracking profiles.")}
        </p>
      </section>
    );
  }

  const profiles = profilesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("Tracking profiles")}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{t("Pixels")}</h1>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("Add profile")}
          </Button>
        )}
      </header>

      <section className="glass overflow-hidden rounded-2xl border border-border">
        {profilesQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : profilesQuery.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(profilesQuery.error, t("Could not load tracking profiles."), locale)}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void profilesQuery.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        ) : profiles.length === 0 ? (
          <div className="py-14 text-center">
            <Radio className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">{t("No tracking profiles yet")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Save tracking IDs once and select them when preparing a landing.")}
            </p>
            {canManage && (
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {t("Add profile")}
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{t("Profile")}</th>
                  <th className="px-4 py-3">{t("Platform")}</th>
                  <th className="px-4 py-3">{t("Tracking ID")}</th>
                  <th className="px-4 py-3">{t("Status")}</th>
                  {canManage && <th className="px-4 py-3 text-right">{t("Actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-medium">{profile.name}</td>
                    <td className="px-4 py-3">{platformLabel(profile.platform)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {profileValue(profile)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={profile.is_active ? "default" : "secondary"}>
                        {profile.is_active ? t("Active") : t("Disabled")}
                      </Badge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("Edit tracking profile {name}", { name: profile.name })}
                            onClick={() => openEdit(profile)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={
                              profile.is_active
                                ? t("Disable tracking profile {name}", { name: profile.name })
                                : t("Enable tracking profile {name}", { name: profile.name })
                            }
                            onClick={() => toggleActive(profile)}
                          >
                            <ToggleLeft
                              className={`h-4 w-4 ${profile.is_active ? "" : "text-muted-foreground"}`}
                            />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingProfile ? t("Edit tracking profile") : t("New tracking profile")}
            </DialogTitle>
            <DialogDescription>
              {t("Tracking IDs are public identifiers, not API secrets.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tracking-profile-name">{t("Profile name")}</Label>
              <Input
                id="tracking-profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracking-profile-platform">{t("Platform")}</Label>
              <Select
                value={platform}
                disabled={Boolean(editingProfile)}
                onValueChange={(value) => setPlatform(value as TrackingPlatform)}
              >
                <SelectTrigger id="tracking-profile-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tiktok">TikTok Ads</SelectItem>
                  <SelectItem value="google_ads">Google Ads</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {platform === "tiktok" ? (
              <div className="space-y-2">
                <Label htmlFor="tracking-tiktok-id">{t("TikTok Pixel ID")}</Label>
                <Input
                  id="tracking-tiktok-id"
                  value={tiktokPixelId}
                  onChange={(event) => setTiktokPixelId(event.target.value)}
                  maxLength={64}
                  autoComplete="off"
                  placeholder="CXXXXXXXXXXXXXXX"
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="tracking-google-id">{t("Google Ads Conversion ID")}</Label>
                  <Input
                    id="tracking-google-id"
                    value={googleAdsConversionId}
                    onChange={(event) => setGoogleAdsConversionId(event.target.value)}
                    maxLength={23}
                    autoComplete="off"
                    placeholder="AW-123456789"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tracking-google-label">{t("Google Ads Conversion Label")}</Label>
                  <Input
                    id="tracking-google-label"
                    value={googleAdsConversionLabel}
                    onChange={(event) => setGoogleAdsConversionLabel(event.target.value)}
                    maxLength={128}
                    autoComplete="off"
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-between rounded-xl border border-border p-3">
              <Label htmlFor="tracking-profile-active">{t("Active profile")}</Label>
              <Switch
                id="tracking-profile-active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={submit}
              disabled={
                saveMutation.isPending ||
                !name.trim() ||
                (platform === "tiktok"
                  ? !tiktokPixelId.trim()
                  : !googleAdsConversionId.trim() || !googleAdsConversionLabel.trim())
              }
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Save profile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
