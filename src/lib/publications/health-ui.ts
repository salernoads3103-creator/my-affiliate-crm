export const R2_DIAGNOSTICS_RENDER_HOST = "crmonia-intake-api-test.onrender.com";

export function canShowR2Diagnostics(hostname: string, canManage: boolean): boolean {
  return hostname === R2_DIAGNOSTICS_RENDER_HOST && canManage;
}
