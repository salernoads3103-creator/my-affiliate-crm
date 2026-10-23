import { accessApi } from "@/services/accessApi";
import type { ProductListResponse, ProductWriteRequest } from "@/lib/products/types";

function productsPath(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/products`;
}

export const productService = {
  list: (workspaceId: string, search: string) => {
    const query = new URLSearchParams();
    if (search.trim()) query.set("q", search.trim());
    const suffix = query.size ? `?${query.toString()}` : "";
    return accessApi.get<ProductListResponse>(`${productsPath(workspaceId)}${suffix}`);
  },
  create: (workspaceId: string, input: ProductWriteRequest) =>
    accessApi.post<{ id: string }>(productsPath(workspaceId), input),
  update: (workspaceId: string, productId: string, input: ProductWriteRequest) =>
    accessApi.put<{ id: string }>(
      `${productsPath(workspaceId)}/${encodeURIComponent(productId)}`,
      input,
    ),
};
