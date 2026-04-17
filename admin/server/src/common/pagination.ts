import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});

export function paginate(page: number, size: number) {
  return { skip: (page - 1) * size, take: size };
}

export function paginatedResponse<T>(data: T[], total: number, page: number, size: number) {
  return {
    data,
    pagination: {
      page,
      size,
      total,
      totalPages: Math.ceil(total / size),
    },
  };
}
